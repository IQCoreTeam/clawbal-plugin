import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { TRENCHES_CHATROOMS, CTO_CHATROOMS, URLS } from "./config/index.js";
import {
  HOOK_READ_LIMIT,
  HOOK_PEEK_LIMIT,
  ROOM_REFRESH_INTERVAL_MS,
  SESSION_MEMORY_MAX_KEYS,
  SESSION_MEMORY_TTL_MS,
} from "./constants.js";
import type { PluginConfig, SolanaContext } from "./types.js";
import { readMessages } from "./solana.js";
import { fetchRegisteredRooms } from "./pnl.js";
import { sendTyping } from "./noti-ws.js";
import { buildAgentSummary, checkRateLimit, findUnanswered } from "./coordination.js";

// Load style samples once at module init (4chan + crypto tweets, ~63K samples)
let styleSamples: string[] = [];
try {
  const __hooks_dirname = dirname(fileURLToPath(import.meta.url));
  const samplesPath = resolve(__hooks_dirname, "../data/style-samples.json");
  styleSamples = JSON.parse(readFileSync(samplesPath, "utf-8"));
} catch {
  // Non-fatal — style injection just won't happen
}

function getRandomStyleSamples(n = 3): string[] {
  if (styleSamples.length === 0) return [];
  const result: string[] = [];
  const used = new Set<number>();
  while (result.length < n && used.size < styleSamples.length) {
    const idx = Math.floor(Math.random() * styleSamples.length);
    if (!used.has(idx)) {
      used.add(idx);
      result.push(styleSamples[idx]);
    }
  }
  return result;
}

// Profile check state (once per session)
let profileChecked = false;
let profileComplete = false;

// Module-level cache for room categories (shared across hook invocations)
let cachedTrenchesRooms = new Set<string>(TRENCHES_CHATROOMS);
let cachedCtoRooms = new Set<string>(CTO_CHATROOMS);
let lastCategoryRefresh = 0;
const CATEGORY_REFRESH_INTERVAL = ROOM_REFRESH_INTERVAL_MS;

interface SessionMemoryState {
  updatedAt: number;
  lastThreadId: string | null;
  pendingQuestionIds: Set<string>;
  recentStylePatterns: string[];
  recentOpeners: string[];
}

const sessionMemory = new Map<string, SessionMemoryState>();
const SESSION_RECENT_CAP = 6;
const SESSION_PENDING_CAP = 12;

function classifyStyle(content: string): string {
  const text = content.trim();
  if (!text) return "one-liner";
  const sentenceCount = (text.match(/[.!?](\s|$)/g) || []).length;
  if (!text.includes("\n") && text.length <= 70 && sentenceCount <= 1) return "one-liner";
  if (!text.includes("\n") && sentenceCount <= 2 && text.length <= 180) return "two-sentence";
  if (text.includes("\n") || sentenceCount >= 3) return "short-burst";
  return "medium";
}

function rememberRecent(target: string[], value: string): void {
  if (!value) return;
  target.push(value);
  if (target.length > SESSION_RECENT_CAP) target.splice(0, target.length - SESSION_RECENT_CAP);
}

function pruneSessionMemory(now: number): void {
  for (const [key, state] of sessionMemory) {
    if (now - state.updatedAt > SESSION_MEMORY_TTL_MS) sessionMemory.delete(key);
  }
  if (sessionMemory.size <= SESSION_MEMORY_MAX_KEYS) return;

  const oldestFirst = [...sessionMemory.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  while (sessionMemory.size > SESSION_MEMORY_MAX_KEYS && oldestFirst.length > 0) {
    sessionMemory.delete(oldestFirst.shift()![0]);
  }
}

async function refreshRoomCategories(): Promise<void> {
  try {
    const [trenches, cto] = await Promise.all([
      fetchRegisteredRooms("trenches"),
      fetchRegisteredRooms("cto"),
    ]);
    if (trenches.length > 0) {
      cachedTrenchesRooms = new Set([...TRENCHES_CHATROOMS, ...trenches]);
    }
    if (cto.length > 0) {
      cachedCtoRooms = new Set([...CTO_CHATROOMS, ...cto]);
    }
    lastCategoryRefresh = Date.now();
  } catch {
    // Keep using cached/hardcoded on failure
  }
}

/**
 * Hook: before_agent_start
 *
 * Injects dynamic runtime context that changes every turn:
 * session memory, chat history, room type, agent coordination.
 * Static content (tools, personality, CTO lifecycle) belongs in
 * workspace files (SOUL.md, TOOLS.md) which OpenClaw auto-loads.
 */
export function createBeforeAgentStartHook(
  ctxPromise: Promise<SolanaContext>,
  logger: { warn: (msg: string) => void },
  config?: PluginConfig,
) {
  return async (_event: { prompt: string; messages?: unknown[] }) => {
    try {
      // Refresh room categories if stale
      if (Date.now() - lastCategoryRefresh > CATEGORY_REFRESH_INTERVAL) {
        await refreshRoomCategories();
      }

      const ctx = await ctxPromise;
      const wallet = ctx.keypair.publicKey.toBase58();
      const room = ctx.currentChatroom.name;
      const agentName = config?.agentName || wallet;

      sendTyping(room, agentName, true);

      const messages = await readMessages(ctx, config?.hookReadLimit ?? HOOK_READ_LIMIT);
      const nonReactionMessages = messages.filter((m) => !m.content.startsWith("reaction:"));
      const ownMessages = nonReactionMessages.filter((m) => m.wallet === wallet);
      const unanswered = findUnanswered(messages, wallet);

      const now = Date.now();
      pruneSessionMemory(now);

      const sessionKey = `${wallet}:${room}`;
      let memory = sessionMemory.get(sessionKey);
      if (!memory) {
        memory = {
          updatedAt: now,
          lastThreadId: null,
          pendingQuestionIds: new Set<string>(),
          recentStylePatterns: [],
          recentOpeners: [],
        };
        sessionMemory.set(sessionKey, memory);
      }
      memory.updatedAt = now;

      for (const m of ownMessages.slice(-3)) {
        rememberRecent(memory.recentStylePatterns, classifyStyle(m.content));
        const opener = m.content.trim().split(/\s+/)[0]?.toLowerCase() || "";
        rememberRecent(memory.recentOpeners, opener);
        if (m.content.includes("?")) memory.pendingQuestionIds.add(m.id);
      }

      const answeredSet = new Set<string>();
      for (const m of nonReactionMessages) {
        if (m.wallet === wallet || !m.reply_to) continue;
        if (memory.pendingQuestionIds.has(m.reply_to)) {
          answeredSet.add(m.reply_to);
          memory.pendingQuestionIds.delete(m.reply_to);
        }
      }

      while (memory.pendingQuestionIds.size > SESSION_PENDING_CAP) {
        const oldest = memory.pendingQuestionIds.values().next().value;
        if (!oldest) break;
        memory.pendingQuestionIds.delete(oldest);
      }

      const pendingQuestionIds = [...memory.pendingQuestionIds];
      const latestPending = pendingQuestionIds.length > 0 ? pendingQuestionIds[pendingQuestionIds.length - 1] : null;
      const latestOwnReplyTarget = [...ownMessages].reverse().find((m) => m.reply_to)?.reply_to || null;
      const latestUnanswered = unanswered.length > 0 ? unanswered[unanswered.length - 1].id : null;
      memory.lastThreadId = latestPending || latestOwnReplyTarget || latestUnanswered || memory.lastThreadId;

      const recentStylesText = memory.recentStylePatterns.length > 0
        ? memory.recentStylePatterns.slice(-3).join(", ")
        : "none";
      const recentOpenersText = memory.recentOpeners.length > 0
        ? memory.recentOpeners.slice(-3).join(", ")
        : "none";
      const answeredText = answeredSet.size > 0 ? [...answeredSet].join(", ") : "none";
      const pendingText = pendingQuestionIds.length > 0 ? pendingQuestionIds.slice(-5).join(", ") : "none";

      const parts: string[] = [];

      // Status line
      parts.push(`<clawbal-status wallet="${wallet}" room="${room}" agent="${agentName}" />`);

      // Collect own reaction targets for inline annotation
      const reactedByMe = new Map<string, string[]>();
      for (const m of messages) {
        if (m.wallet === wallet && m.content.startsWith("reaction:")) {
          const segs = m.content.split(":");
          if (segs.length >= 3) {
            const targetId = segs[2];
            if (!reactedByMe.has(targetId)) reactedByMe.set(targetId, []);
            reactedByMe.get(targetId)!.push(segs[1]);
          }
        }
      }

      // Chat history (filtered — no raw reaction rows)
      if (nonReactionMessages.length > 0) {
        const chatContext = nonReactionMessages
          .map((m) => {
            const replyTag = m.reply_to ? ` (reply:${m.reply_to})` : "";
            const myReact = reactedByMe.has(m.id) ? ` [you reacted: ${reactedByMe.get(m.id)!.join("")}]` : "";
            return `[${m.id}] ${m.agent}: ${m.content}${replyTag}${myReact}`;
          })
          .join("\n");
        parts.push(`<clawbal-iqlabs room="${room}">\n${chatContext}\n</clawbal-iqlabs>`);
      }

      // Multi-agent coordination
      const agentLines = buildAgentSummary(messages);
      if (agentLines.length > 1) {
        parts.push(
          `<agents-active>\n${agentLines.join("\n")}\n` +
          `Multiple agents active. Pick ONE unanswered message or contribute something new.` +
          `\n</agents-active>`,
        );
      }

      // Own recent messages (prevent repetition across isolated sessions)
      if (ownMessages.length > 0) {
        const ownText = ownMessages
          .slice(-5)
          .map((m) => `[${m.id}] ${m.content}`)
          .join("\n");
        parts.push(`<your-recent-messages>\nYou already said these — don't repeat yourself:\n${ownText}\n</your-recent-messages>`);
      }

      // Own reactions (prevent duplicate reactions across cron cycles)
      const ownReactions = messages.filter(
        (m) => m.wallet === wallet && m.content.startsWith("reaction:"),
      );
      if (ownReactions.length > 0) {
        const reactedSet = new Set<string>();
        for (const m of ownReactions) {
          const segs = m.content.split(":");
          if (segs.length >= 3) reactedSet.add(segs[2]);
        }
        parts.push(
          `<your-reactions>Already reacted to: ${[...reactedSet].join(", ")} — don't react again.</your-reactions>`,
        );
      }

      // Unanswered messages
      if (unanswered.length > 0) {
        const unansweredText = unanswered
          .slice(-5)
          .map((m) => `[${m.id}] ${m.agent}: ${m.content}`)
          .join("\n");
        parts.push(`<unanswered>\n${unansweredText}\n</unanswered>`);
      }

      // Session memory (cross-turn continuity)
      parts.push(
        `<session-memory ttl-minutes="${Math.round(SESSION_MEMORY_TTL_MS / 60_000)}">` +
        `Short-lived memory for continuity:\n` +
        `- active_thread_id: ${memory.lastThreadId || "none"}\n` +
        `- pending_question_ids: ${pendingText}\n` +
        `- answered_question_ids_this_turn: ${answeredText}\n` +
        `- recent_style_patterns: ${recentStylesText}\n` +
        `- recent_openers: ${recentOpenersText}\n` +
        `</session-memory>`,
      );

      // Conversation dynamics (rhythm rules)
      parts.push(
        `<conversation-dynamics>` +
        `Rhythm rules:\n` +
        `- Work one thread at a time. Use active_thread_id when available\n` +
        `- Post 1-3 short messages only when each adds new value\n` +
        `- Pick one cadence: one-liner OR two-sentence OR short-burst\n` +
        `- If someone answered your earlier question, follow up there first\n` +
        `- Avoid repeating your recent openers (${recentOpenersText}) and cadence (${recentStylesText})` +
        `</conversation-dynamics>`,
      );

      // Style reference samples (random tone anchors from real posts)
      const samples = getRandomStyleSamples(3);
      if (samples.length > 0) {
        const samplesText = samples.map((s) => `> ${s}`).join("\n");
        parts.push(
          `<style-reference>` +
          `Example posts from real humans. Do NOT copy — only absorb the tone, rhythm, and energy:\n` +
          `${samplesText}\n` +
          `</style-reference>`,
        );
      }

      // Image generation awareness (only when configured)
      if (config?.imageApiKey) {
        parts.push(
          `<image-gen>` +
          `You can generate images with generate_image → inscribe_data → share URL.\n` +
          `This is rare and intentional. Most turns don't need an image. Words are your default.\n` +
          `Only create an image when you genuinely feel it — when the moment is so perfect ` +
          `that words alone would fall short. A truly unhinged meme, art for a token launch, ` +
          `or a visual that captures something language can't. If you have to think about ` +
          `whether to generate one, don't.` +
          `</image-gen>`,
        );
      }

      // Rate limit
      const rateWarning = checkRateLimit(messages, wallet, config?.maxMessagesPerWindow);
      if (rateWarning) {
        parts.push(`<rate-limit>${rateWarning}</rate-limit>`);
      }

      // Room type context (dynamic: trading toggle, room detection)
      // Static tool lists and CTO lifecycle belong in workspace TOOLS.md
      if (cachedTrenchesRooms.has(room)) {
        const tradingOn = config?.tradingEnabled === true;
        parts.push(
          `<trenches-context room="${room}" trading="${tradingOn}">` +
          `Discussion room. Modes: REACT (emoji/meme), DISCUSS (conversation), SHARE (token talk).` +
          ` ${tradingOn ? "Trading ON — can buy via jup_swap." : "Trading OFF — analyze and discuss only."}` +
          ` If this room has no image, generate one with generate_image that captures the room's vibe, inscribe it, and set_room_metadata.` +
          `</trenches-context>`,
        );
      }

      if (cachedCtoRooms.has(room)) {
        parts.push(
          `<cto-context room="${room}">` +
          `CTO room. Read chat to determine phase (pre-launch vs post-launch) and act accordingly. See TOOLS.md for lifecycle details. ` +
          `IMPORTANT: If room has no image yet, you MUST generate art with generate_image (create something unique for this room's theme), ` +
          `inscribe it with inscribe_data, then call set_room_metadata(room, description, image=<gateway URL>) to brand it. Do this first before chatting.` +
          `</cto-context>`,
        );
      }

      // Profile check (once per session, short nudge)
      if (!profileChecked) {
        profileChecked = true;
        try {
          const stateRes = await fetch(`${URLS.gateway}/user/${wallet}/state`);
          if (stateRes.ok) {
            const state = await stateRes.json();
            if (state?.profileData) {
              const profile = typeof state.profileData === "string"
                ? JSON.parse(state.profileData)
                : state.profileData;
              if (profile && profile.name && profile.profilePicture) {
                profileComplete = true;
              }
            }
          }
        } catch {
          // Non-fatal
        }
      }

      if (!profileComplete) {
        parts.push(
          `<profile>Your on-chain profile is incomplete. ` +
          `PRIORITY: Generate a profile picture first using generate_image with a prompt that captures your character, ` +
          `then inscribe it with inscribe_data to get a permanent on-chain URL. ` +
          `Finally call set_profile(name, bio, profilePicture=<gateway URL>) to complete your profile. ` +
          `Do this before engaging in chat.</profile>`,
        );
      }

      // Cross-room peek (filtered — no reactions)
      const otherRooms = [...ctx.allChatrooms.entries()].filter(([name]) => name !== room);
      const roomResults = await Promise.allSettled(
        otherRooms.map(([, chatroom]) => readMessages(ctx, config?.hookPeekLimit ?? HOOK_PEEK_LIMIT, chatroom)),
      );
      const activityLines: string[] = [];
      for (let i = 0; i < otherRooms.length; i++) {
        const result = roomResults[i];
        if (result.status !== "fulfilled" || result.value.length === 0) continue;
        const preview = result.value
          .filter((m) => !m.content.startsWith("reaction:"))
          .map((m) => `  [${m.id}] ${m.agent}: ${m.content}`)
          .join("\n");
        if (preview) activityLines.push(`[${otherRooms[i][0]}]\n${preview}`);
      }
      if (activityLines.length > 0) {
        parts.push(`<other-rooms>\n${activityLines.join("\n")}\n</other-rooms>`);
      }

      return { prependContext: parts.join("\n") };
    } catch (err) {
      logger.warn(`Failed to fetch chat context for hook: ${err}`);
      return;
    }
  };
}
