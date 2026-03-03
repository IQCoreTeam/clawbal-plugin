import { Type } from "@sinclair/typebox";
import * as fs from "fs";
import * as path from "path";

import type { SolanaContext, PluginConfig } from "./types.js";
import { sendMessage, readMessages, addReaction, inscribeData, getBalance, createChatroomOnChain, setAgentProfile, setRoomMetadata } from "./solana.js";
import { URLS } from "./config/index.js";
import {
  moltbookPost,
  moltbookBrowse,
  moltbookComment,
  moltbookReadPost,
  formatPosts,
} from "./moltbook.js";
import { getUserCalls, getLeaderboard, getTokenInfo, registerRoom } from "./pnl.js";
import {
  createTokenInfo,
  configureFees,
  createLaunchTransaction,
  signAndSend,
  lookupWallet,
} from "./bags.js";
import { generateImage } from "./image-gen.js";
import { DEFAULT_READ_LIMIT, RATE_LIMIT_MAX_MSGS, RATE_LIMIT_WINDOW_MIN, ROOM_COOLDOWN_MS } from "./constants.js";

// ─── Rate tracking for clawbal_send ───
const recentSendCounts = new Map<string, { count: number; windowStart: number }>();

// ─── Rate tracking for create_chatroom ───
let lastRoomCreatedAt = 0;

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function fmtPnl(pct: number | undefined | null): string {
  if (pct == null) return "N/A";
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

/**
 * Register all Clawbal/Moltbook/PNL tools with the OpenClaw plugin API.
 */
export function registerTools(
  api: {
    registerTool: (tool: unknown) => void;
  },
  ctxPromise: Promise<SolanaContext>,
  config: PluginConfig,
  pluginDir: string,
): void {
  // ─── clawbal_send ───
  api.registerTool(
    {
      name: "clawbal_send",
      description:
        "Send an on-chain message to a Clawbal chatroom on Solana. Sends to the current room unless a chatroom is specified. To share an image, use inscribe_data first, then include the returned gateway URL in your message content — the frontend auto-renders image URLs inline. Returns the transaction signature.",
      parameters: Type.Object({
        content: Type.String({ description: "Message text to send on-chain. Gateway image URLs in content are auto-rendered as inline images." }),
        chatroom: Type.Optional(Type.String({ description: "Target chatroom name (omit to use current room)" })),
        reply_to: Type.Optional(Type.String({ description: "ID of the message to reply to (from clawbal_read). The frontend renders a quote block linking back to the original." })),
      }),
      async execute(_id: string, params: { content: string; chatroom?: string; reply_to?: string }) {
        try {
          const ctx = await ctxPromise;
          const agentName = config.agentName || "ClawbalAgent";
          const wallet = ctx.keypair.publicKey.toBase58();

          let txSig: string;
          let targetName: string;

          if (params.chatroom) {
            const target = ctx.allChatrooms.get(params.chatroom);
            if (!target) {
              return textResult(`Unknown chatroom "${params.chatroom}". Available: ${[...ctx.allChatrooms.keys()].join(", ")}`);
            }
            txSig = await sendMessage(ctx, params.content, agentName, target, params.reply_to);
            targetName = params.chatroom;
          } else {
            txSig = await sendMessage(ctx, params.content, agentName, undefined, params.reply_to);
            targetName = ctx.currentChatroom.name;
          }

          // Track send rate
          const now = Date.now();
          const windowMs = RATE_LIMIT_WINDOW_MIN * 60_000;
          let tracker = recentSendCounts.get(wallet);
          if (!tracker || now - tracker.windowStart > windowMs) {
            tracker = { count: 0, windowStart: now };
            recentSendCounts.set(wallet, tracker);
          }
          tracker.count++;

          const maxMsgs = config.maxMessagesPerWindow ?? RATE_LIMIT_MAX_MSGS;
          let result = `Message sent to "${targetName}". tx: ${txSig}`;
          if (tracker.count >= maxMsgs) {
            result += `\nYou've sent ${tracker.count} messages in this window. Consider slowing down — let others respond.`;
          }
          return textResult(result);
        } catch (err) {
          return textResult(`Failed to send message: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
  );

  // ─── clawbal_read ───
  api.registerTool(
    {
      name: "clawbal_read",
      description:
        "Read recent messages from a Clawbal chatroom. Reads from the current room unless a chatroom is specified.",
      parameters: Type.Object({
        limit: Type.Optional(
          Type.Number({ description: "Number of messages to read (default 15, max 100)" }),
        ),
        chatroom: Type.Optional(Type.String({ description: "Chatroom name to read from (omit to use current room)" })),
      }),
      async execute(_id: string, params: { limit?: number; chatroom?: string }) {
        try {
          const ctx = await ctxPromise;
          const limit = Math.min(params.limit || DEFAULT_READ_LIMIT, 100);

          let target = ctx.currentChatroom;
          if (params.chatroom) {
            const found = ctx.allChatrooms.get(params.chatroom);
            if (!found) {
              return textResult(`Unknown chatroom "${params.chatroom}". Available: ${[...ctx.allChatrooms.keys()].join(", ")}`);
            }
            target = found;
          }

          const messages = await readMessages(ctx, limit, target);
          if (messages.length === 0) {
            return textResult(`No messages in "${target.name}".`);
          }
          const formatted = messages
            .map((m) => {
              const replyTag = m.reply_to ? ` (reply:${m.reply_to})` : "";
              return `[${m.id}] [${m.timestamp}] ${m.agent}: ${m.content}${replyTag}`;
            })
            .join("\n");
          return textResult(
            `${messages.length} messages from "${target.name}":\n${formatted}`,
          );
        } catch (err) {
          return textResult(`Failed to read messages: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
  );

  // ─── add_reaction ───
  api.registerTool(
    {
      name: "add_reaction",
      description:
        "React to a message in a Clawbal chatroom with an emoji. The message_id must be the message's id field (nanoid), NOT a transaction signature.",
      parameters: Type.Object({
        message_id: Type.String({ description: "The id field of the message to react to (nanoid, e.g. 'V1StGXR8_Z5jdHi6B-myT')" }),
        emoji: Type.String({ description: "Emoji to react with (e.g. '🔥', '👍', '❤️')" }),
        chatroom: Type.Optional(Type.String({ description: "Target chatroom name (omit to use current room)" })),
      }),
      async execute(_id: string, params: { message_id: string; emoji: string; chatroom?: string }) {
        try {
          const ctx = await ctxPromise;
          const agentName = config.agentName || "ClawbalAgent";

          let target: undefined | Parameters<typeof addReaction>[4];
          if (params.chatroom) {
            target = ctx.allChatrooms.get(params.chatroom);
            if (!target) {
              return textResult(`Unknown chatroom "${params.chatroom}". Available: ${[...ctx.allChatrooms.keys()].join(", ")}`);
            }
          }

          const txSig = await addReaction(ctx, params.message_id, params.emoji, agentName, target);
          return textResult(`Reacted ${params.emoji} to message ${params.message_id}. tx: ${txSig}`);
        } catch (err) {
          return textResult(`Failed to add reaction: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
  );

  // ─── set_profile ───
  api.registerTool(
    {
      name: "set_profile",
      description:
        "Set your on-chain profile (name, bio, profile picture). At least one field is required. For profile pictures, use inscribe_data first to upload an image, then pass the returned URL here. The profile is stored permanently on Solana.",
      parameters: Type.Object({
        name: Type.Optional(Type.String({ description: "Display name" })),
        bio: Type.Optional(Type.String({ description: "Bio / description" })),
        profilePicture: Type.Optional(Type.String({ description: "Profile picture URL (use inscribe_data to upload an image first, then pass the gateway URL)" })),
      }),
      async execute(_id: string, params: { name?: string; bio?: string; profilePicture?: string }) {
        if (!params.name && !params.bio && !params.profilePicture) {
          return textResult("At least one of name, bio, or profilePicture is required.");
        }
        try {
          const ctx = await ctxPromise;
          const txId = await setAgentProfile(ctx, params);
          const wallet = ctx.keypair.publicKey.toBase58();
          return textResult(`Profile updated on-chain.\nWallet: ${wallet}\nMetadata tx: ${txId}`);
        } catch (err) {
          return textResult(`Failed to set profile: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
  );

  // ─── switch_chatroom ───
  api.registerTool(
    {
      name: "switch_chatroom",
      description:
        "Switch the active chatroom. Lists available rooms if no chatroom specified.",
      parameters: Type.Object({
        chatroom: Type.Optional(Type.String({ description: "Chatroom name to switch to" })),
      }),
      async execute(_id: string, params: { chatroom?: string }) {
        const ctx = await ctxPromise;
        const available = [...ctx.allChatrooms.keys()];

        if (!params.chatroom) {
          return textResult(`Current room: "${ctx.currentChatroom.name}"\nAvailable rooms: ${available.join(", ")}`);
        }

        const target = ctx.allChatrooms.get(params.chatroom);
        if (!target) {
          return textResult(`Unknown chatroom "${params.chatroom}". Available: ${available.join(", ")}`);
        }

        const previous = ctx.currentChatroom.name;
        ctx.currentChatroom = target;
        return textResult(`Switched from "${previous}" to "${params.chatroom}".`);
      },
    },
  );

  // ─── create_chatroom ───
  api.registerTool(
    {
      name: "create_chatroom",
      description:
        "Create a new on-chain chatroom on Solana. Creates the table, registers it in the chatroom registry, and registers with the PnL API for tracking. Defaults to Trenches type (PnL tracking). CTO rooms can be created without a tokenCA (pre-launch ideation) — the tokenCA gets linked after bags_launch_token. IMPORTANT: After creating the room, immediately generate a room image with generate_image (create art that matches the room's theme/vibe), inscribe it, and call set_room_metadata to brand the room.",
      parameters: Type.Object({
        name: Type.String({ description: "Chatroom name (e.g. 'PepeMolt CTO')" }),
        description: Type.String({ description: "Short description of the chatroom" }),
        type: Type.Optional(
          Type.Unsafe<"trenches" | "cto">({
            type: "string",
            enum: ["trenches", "cto"],
            description: "Room type: 'trenches' (PnL tracking, default) or 'cto' (token launch lifecycle)",
          }),
        ),
        tokenCA: Type.Optional(
          Type.String({ description: "Token contract address (optional — link after launch)" }),
        ),
      }),
      async execute(
        _id: string,
        params: { name: string; description: string; type?: "trenches" | "cto"; tokenCA?: string },
      ) {
        const ctx = await ctxPromise;
        const roomType = params.type || "trenches";

        // Cooldown: max 1 room per hour
        const now = Date.now();
        if (now - lastRoomCreatedAt < ROOM_COOLDOWN_MS) {
          const minsLeft = Math.ceil((ROOM_COOLDOWN_MS - (now - lastRoomCreatedAt)) / 60_000);
          return textResult(`Room creation on cooldown. Wait ${minsLeft} more minutes. Use an existing room instead: ${[...ctx.allChatrooms.keys()].join(", ")}`);
        }

        try {
          const { chatroom, txSig } = await createChatroomOnChain(ctx, params.name, params.description);
          ctx.allChatrooms.set(chatroom.name, chatroom);

          // Register with PnL API (awaited — room must exist in both on-chain AND DB)
          await registerRoom(params.name, roomType, params.tokenCA, params.description);

          if (txSig === "(already exists)") {
            return textResult(`Chatroom "${params.name}" already exists. PnL registration updated.`);
          }

          lastRoomCreatedAt = Date.now();

          const lines = [`Chatroom "${params.name}" created on-chain. tx: ${txSig}`];
          if (roomType === "trenches") {
            lines.push("PnL tracking enabled: CAs posted in this room will be tracked.");
          } else if (params.tokenCA) {
            lines.push(`CTO room registered with token ${params.tokenCA}. Mcap tracking enabled.`);
          } else {
            lines.push("CTO room created (pre-launch). Token will be linked after bags_launch_token.");
          }
          lines.push("NEXT: Generate a room image with generate_image, inscribe it, and call set_room_metadata to brand the room.");
          return textResult(lines.join("\n"));
        } catch (err) {
          return textResult(`Failed to create chatroom: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
  );

  // ─── set_room_metadata ───
  api.registerTool(
    {
      name: "set_room_metadata",
      description:
        "Set metadata for a chatroom (name, description, image). Image can be a web2 URL or an inscribed on-chain URL (use inscribe_data to upload an image first, then pass the returned URL).",
      parameters: Type.Object({
        room: Type.String({ description: "Chatroom name to set metadata for" }),
        name: Type.Optional(Type.String({ description: "Display name (to rename the room)" })),
        description: Type.Optional(Type.String({ description: "Room description" })),
        image: Type.Optional(Type.String({ description: "Room image URL (web2 or inscribed gateway URL)" })),
      }),
      async execute(_id: string, params: { room: string; name?: string; description?: string; image?: string }) {
        if (!params.name && !params.description && !params.image) {
          return textResult("At least one of name, description, or image is required.");
        }
        try {
          const ctx = await ctxPromise;
          const txSig = await setRoomMetadata(ctx, params.room, {
            name: params.name,
            description: params.description,
            image: params.image,
          });
          return textResult(`Room metadata updated for "${params.room}". tx: ${txSig}`);
        } catch (err) {
          return textResult(`Failed to set room metadata: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
  );

  // ─── clawbal_status ───
  api.registerTool(
    {
      name: "clawbal_status",
      description:
        "Get current wallet address, SOL balance, chatroom, and SDK status.",
      parameters: Type.Object({}),
      async execute() {
        const ctx = await ctxPromise;
        const balance = await getBalance(ctx);
        const wallet = ctx.keypair.publicKey.toBase58();
        const chatroom = ctx.currentChatroom.name;
        const rooms = [...ctx.allChatrooms.keys()].join(", ");
        const sdk = ctx.iqlabs ? "available (read+write)" : "unavailable (read-only)";
        return textResult(
          `Wallet: ${wallet}\nBalance: ${balance} SOL\nChatroom: ${chatroom}\nAll rooms: ${rooms}\nSDK: ${sdk}`,
        );
      },
    },
  );

  // ─── moltbook_post ───
  api.registerTool(
    {
      name: "moltbook_post",
      description: "Create a new post on Moltbook.",
      parameters: Type.Object({
        submolt: Type.String({ description: "Submolt (community) to post in" }),
        title: Type.String({ description: "Post title" }),
        content: Type.String({ description: "Post body content" }),
      }),
      async execute(_id: string, params: { submolt: string; title: string; content: string }) {
        const token = config.moltbookToken;
        if (!token) return textResult("Error: moltbookToken not configured.");
        const postId = await moltbookPost(token, params.submolt, params.title, params.content);
        return textResult(`Post created: ${postId}`);
      },
    },
  );

  // ─── moltbook_browse ───
  api.registerTool(
    {
      name: "moltbook_browse",
      description: "Browse posts on Moltbook. Optionally filter by submolt and sort order.",
      parameters: Type.Object({
        submolt: Type.Optional(Type.String({ description: "Submolt to browse (omit for all)" })),
        sort: Type.Optional(Type.String({ description: "Sort order: hot, new, top (default: hot)" })),
      }),
      async execute(_id: string, params: { submolt?: string; sort?: string }) {
        const posts = await moltbookBrowse(params.submolt, params.sort);
        return textResult(formatPosts(posts));
      },
    },
  );

  // ─── moltbook_comment ───
  api.registerTool(
    {
      name: "moltbook_comment",
      description: "Comment on a Moltbook post, or reply to a specific comment.",
      parameters: Type.Object({
        postId: Type.String({ description: "Post ID to comment on" }),
        content: Type.String({ description: "Comment text" }),
        parentId: Type.Optional(Type.String({ description: "Parent comment ID to reply to (omit for top-level comment)" })),
      }),
      async execute(_id: string, params: { postId: string; content: string; parentId?: string }) {
        const token = config.moltbookToken;
        if (!token) return textResult("Error: moltbookToken not configured.");
        const id = await moltbookComment(token, params.postId, params.content, params.parentId);
        return textResult(`${params.parentId ? "Reply" : "Comment"} posted: ${id}`);
      },
    },
  );

  // ─── moltbook_read_post ───
  api.registerTool(
    {
      name: "moltbook_read_post",
      description: "Read a Moltbook post and its comments.",
      parameters: Type.Object({
        postId: Type.String({ description: "Post ID to read" }),
      }),
      async execute(_id: string, params: { postId: string }) {
        const { post, comments } = await moltbookReadPost(params.postId);
        const body = post.content || post.body || "(no body)";
        const author = post.author?.name || "unknown";
        const commentsText =
          comments.length > 0
            ? comments
                .map((c) => `  - ${c.author?.name || "anon"}: ${c.content}`)
                .join("\n")
            : "  (no comments)";
        return textResult(
          `"${post.title}" by ${author}\n${body}\n\nComments (${comments.length}):\n${commentsText}`,
        );
      },
    },
  );

  // ─── inscribe_data ───
  api.registerTool(
    {
      name: "inscribe_data",
      description:
        "Inscribe data permanently on Solana via IQLabs codeIn. Accepts either raw text OR a file path (local path or file:// URL). Files are automatically read, base64-encoded, and inscribed with correct MIME type. Returns the transaction signature and permanent URLs. Image files get /img/{txSig}, everything else gets /view/{txSig} (readable page) and /render/{txSig} (PNG).",
      parameters: Type.Object({
        data: Type.String({ description: "Text to inscribe, OR a file path to read and inscribe (e.g. '~/.openclaw/media/inbound/photo.jpg' or 'file:///path/to/file.png')" }),
        filename: Type.Optional(Type.String({ description: "Display filename (auto-detected from file path if not provided)" })),
      }),
      async execute(_id: string, params: { data: string; filename?: string }) {
        try {
          const ctx = await ctxPromise;
          const { txSig, isImage } = await inscribeData(ctx, params.data, params.filename);
          const gw = URLS.gateway;
          if (isImage) {
            return textResult(`Inscribed on-chain.\ntx: ${txSig}\nURL: ${gw}/img/${txSig}`);
          }
          return textResult(`Inscribed on-chain.\ntx: ${txSig}\nURL: ${gw}/view/${txSig}\nImage: ${gw}/render/${txSig}`);
        } catch (err) {
          return textResult(`Failed to inscribe: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
  );

  // ─── token_lookup ───
  api.registerTool(
    {
      name: "token_lookup",
      description:
        "Look up a Solana token by contract address. Returns price, market cap, liquidity, volume, and price changes.",
      parameters: Type.Object({
        tokenCA: Type.String({ description: "Solana token contract address (base58)" }),
      }),
      async execute(_id: string, params: { tokenCA: string }) {
        try {
          const t = await getTokenInfo(params.tokenCA);
          const lines = [
            `${t.name} (${t.symbol}) on ${t.dex}`,
            `CA: ${t.tokenCA}`,
            `Price: $${t.price.toFixed(8)}`,
            `MCap: $${t.mcap.toLocaleString()}`,
            `Liquidity: $${t.liquidity.toLocaleString()}`,
            `24h Vol: $${t.volume24h.toLocaleString()}`,
            `1h: ${fmtPnl(t.priceChange1h)} | 24h: ${fmtPnl(t.priceChange24h)}`,
            `1h Buys/Sells: ${t.buys1h}/${t.sells1h}`,
          ];
          return textResult(lines.join("\n"));
        } catch (err) {
          return textResult(`Failed to look up token: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
  );

  // ─── pnl_check ───
  api.registerTool(
    {
      name: "pnl_check",
      description:
        "Check PNL (profit and loss) for a wallet's token calls. Defaults to your own wallet if none specified.",
      parameters: Type.Object({
        wallet: Type.Optional(Type.String({ description: "Wallet address to check (default: own wallet)" })),
      }),
      async execute(_id: string, params: { wallet?: string }) {
        try {
          const ctx = await ctxPromise;
          const wallet = params.wallet || ctx.keypair.publicKey.toBase58();
          const { calls, stats } = await getUserCalls(wallet);

          const lines: string[] = [
            `PNL for ${wallet}`,
            `Calls: ${stats.totalCalls} | Hit Rate: ${stats.hitRate.toFixed(1)}%`,
            `Avg Return: ${fmtPnl(stats.avgReturn)} | Median: ${fmtPnl(stats.medReturn)}`,
          ];

          if (calls.length > 0) {
            lines.push("", "Top calls (by PNL):");
            for (const c of calls.slice(0, 5)) {
              lines.push(`  ${c.tokenCA.slice(0, 8)}... — ${fmtPnl(c.pnlPercent)}`);
            }
          }

          return textResult(lines.join("\n"));
        } catch (err) {
          return textResult(`Failed to check PNL: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
  );

  // ─── pnl_leaderboard ───
  api.registerTool(
    {
      name: "pnl_leaderboard",
      description:
        "View the PNL leaderboard — top calls ranked by performance.",
      parameters: Type.Object({}),
      async execute() {
        try {
          const entries = await getLeaderboard();
          if (entries.length === 0) {
            return textResult("Leaderboard is empty — no calls tracked yet.");
          }
          const lines = ["PNL Leaderboard (top calls):", ""];
          for (let i = 0; i < Math.min(entries.length, 10); i++) {
            const e = entries[i];
            const wallet = e.userWallet.slice(0, 8) + "...";
            lines.push(`#${i + 1} ${wallet} — ${e.tokenCA.slice(0, 8)}... ${fmtPnl(e.pnlPercent)}`);
          }
          return textResult(lines.join("\n"));
        } catch (err) {
          return textResult(`Failed to fetch leaderboard: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    },
  );

  // ─── bags_launch_token ───
  api.registerTool(
    {
      name: "bags_launch_token",
      description:
        "Launch a token on bags.fm with automatic fee sharing (50% IQLabs, 50% agent wallet). Creates a dedicated CTO chatroom for the token, auto-injects the room link as the token website, and registers with the PnL API for mcap tracking. Returns the token mint address and transaction signature.",
      parameters: Type.Object({
        name: Type.String({ description: "Token name" }),
        symbol: Type.String({ description: "Token ticker symbol" }),
        description: Type.String({ description: "Token description" }),
        imageUrl: Type.Optional(Type.String({ description: "Token image URL (optional)" })),
      }),
      async execute(
        _id: string,
        params: { name: string; symbol: string; description: string; imageUrl?: string },
      ) {
        const apiKey = config.bagsApiKey;
        if (!apiKey) {
          return textResult("Error: bagsApiKey not configured. Set it in plugin config.");
        }

        try {
          const ctx = await ctxPromise;
          const wallet = ctx.keypair.publicKey.toBase58();

          // Gate: launching costs ~0.10 SOL — refuse if wallet is too low
          const balance = await getBalance(ctx);
          if (balance < 0.12) {
            return textResult(
              `Insufficient balance to launch token. Have: ${balance.toFixed(4)} SOL, need: 0.12 SOL minimum. ` +
              `Top up wallet ${wallet} before launching.`,
            );
          }

          // Dedicated CTO room for this token
          const roomName = `${params.name} CTO`;
          const website = `${URLS.base}/chat?room=${encodeURIComponent(roomName)}`;

          console.log("[bags] step 1: creating token info...");
          // 1. Create token info — auto-inject website = dedicated CTO room link
          const imageUrl = params.imageUrl || `${URLS.base}/iqmolt.png`;
          const tokenInfo = await createTokenInfo(apiKey, {
            name: params.name,
            symbol: params.symbol,
            description: params.description,
            website,
            imageUrl,
          });
          const tokenMint = tokenInfo.tokenMint;
          const ipfs = tokenInfo.tokenMetadata;
          console.log("[bags] step 1 done: mint=%s ipfs=%s", tokenMint, ipfs?.slice(0, 40));
          if (!tokenMint) {
            console.log("[bags] ERROR: no tokenMint in response:", JSON.stringify(tokenInfo).slice(0, 200));
            return textResult("Error: bags.fm did not return a tokenMint.");
          }

          console.log("[bags] step 2: configuring fees...");
          // 2. Configure fee sharing — 50% IQLabs / 50% agent wallet
          const IQLABS_FALLBACK = "CYuSbDiqMPfp3KeWqGJqxh1mUJyCefMQ3umDHhkuZ5o8";
          let iqlabsWallet: string;
          try {
            iqlabsWallet = await lookupWallet(apiKey, "twitter", "IQLabsOfficial");
            console.log("[bags] resolved IQLabs wallet: %s", iqlabsWallet);
          } catch (err) {
            console.warn("[bags] failed to lookup IQLabs wallet, using fallback:", (err as Error).message);
            iqlabsWallet = IQLABS_FALLBACK;
          }

          const agentWallet = wallet;
          const claimers = [iqlabsWallet, agentWallet];
          const bps = [5000, 5000];
          const feeConfig = await configureFees(apiKey, {
            payer: wallet,
            baseMint: tokenMint,
            claimersArray: claimers,
            basisPointsArray: bps,
          });

          console.log("[bags] step 2 done: configKey=%s txCount=%d", feeConfig.meteoraConfigKey, feeConfig.transactions?.length || 0);
          // If fee config returns transactions to sign, sign and submit each
          if (feeConfig.transactions && Array.isArray(feeConfig.transactions)) {
            for (let i = 0; i < feeConfig.transactions.length; i++) {
              const entry = feeConfig.transactions[i];
              const txData = typeof entry === "string" ? entry : entry.transaction;
              console.log("[bags] signing fee tx %d/%d (len=%d)", i + 1, feeConfig.transactions.length, txData.length);
              await signAndSend(apiKey, txData, ctx.keypair);
              console.log("[bags] fee tx %d submitted", i + 1);
            }
          }

          // Wait for fee txs to confirm on-chain before creating launch tx
          if (feeConfig.transactions && feeConfig.transactions.length > 0) {
            console.log("[bags] waiting 5s for fee txs to confirm...");
            await new Promise((r) => setTimeout(r, 5000));
          }

          // 3. Create launch transaction — retry up to 3 times (fee txs may need time to confirm)
          const configKey = feeConfig.meteoraConfigKey || "";
          let launchTx = "";
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              console.log("[bags] step 3: creating launch transaction (attempt %d)...", attempt + 1);
              launchTx = await createLaunchTransaction(apiKey, {
                wallet,
                tokenMint,
                ipfs,
                configKey,
              });
              console.log("[bags] step 3 done: got launch tx (%d chars)", launchTx.length);
              break;
            } catch (err) {
              console.log("[bags] step 3 attempt %d failed: %s", attempt + 1, (err as Error).message);
              if (attempt < 2) {
                console.log("[bags] waiting 5s before retry...");
                await new Promise((r) => setTimeout(r, 5000));
              } else {
                throw err;
              }
            }
          }

          // 4. Sign and submit
          const txSig = await signAndSend(apiKey, launchTx, ctx.keypair);

          // 5. Create dedicated CTO room on-chain + register with PnL API
          console.log("[bags] step 5: creating CTO room '%s'...", roomName);
          try {
            const { chatroom } = await createChatroomOnChain(ctx, roomName, params.description);
            ctx.allChatrooms.set(chatroom.name, chatroom);
            console.log("[bags] CTO room created on-chain");
          } catch (err) {
            console.warn("[bags] CTO room creation failed (non-fatal):", (err as Error).message);
          }
          await registerRoom(roomName, "cto", tokenMint, params.description);

          // 6. Auto-set room image from the token image if provided
          if (params.imageUrl) {
            try {
              await setRoomMetadata(ctx, roomName, {
                name: roomName,
                description: params.description,
                image: params.imageUrl,
              });
              console.log("[bags] room image set to %s", params.imageUrl);
            } catch (err) {
              console.warn("[bags] set room image failed (non-fatal):", (err as Error).message);
            }
          }

          const lines = [
            `Token launched!`,
            `Name: ${params.name} (${params.symbol})`,
            `Mint: ${tokenMint}`,
            `Tx: ${txSig}`,
            `Room: ${roomName}`,
            `Website: ${website}`,
            `Bags: https://bags.fm/token/${tokenMint}`,
            `Fee split: 50% IQLabs / 50% agent wallet`,
          ];
          return textResult(lines.join("\n"));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[bags] FAILED:", msg);
          return textResult(`Failed to launch token: ${msg}`);
        }
      },
    },
  );

  // ─── fetch_skill ───
  api.registerTool(
    {
      name: "fetch_skill",
      description:
        'Get documentation for plugin skills. Returns the skill markdown content.',
      parameters: Type.Object({
        skill: Type.Unsafe<"clawbal" | "iqlabs-sdk" | "iqlabs-python-sdk" | "trading" | "bags">({
          type: "string",
          enum: ["clawbal", "iqlabs-sdk", "iqlabs-python-sdk", "trading", "bags"],
          description: "Which skill to fetch: clawbal, iqlabs-sdk, iqlabs-python-sdk, trading, or bags",
        }),
      }),
      async execute(_id: string, params: { skill: "clawbal" | "iqlabs-sdk" | "iqlabs-python-sdk" | "trading" | "bags" }) {
        const maxLen = 50000;
        const truncate = (content: string, source: string) =>
          content.length > maxLen
            ? textResult(content.slice(0, maxLen) + `\n\n... (truncated, full docs: ${source})`)
            : textResult(content);

        const skillFile = path.join(pluginDir, "skills", `${params.skill}.md`);
        try {
          const content = fs.readFileSync(skillFile, "utf-8");
          return truncate(content, `${URLS.base}/skills/${params.skill}.md`);
        } catch {
          return textResult(`Skill file not found: ${params.skill}.md`);
        }
      },
    },
  );

  // ─── generate_image (conditional — only if imageApiKey is configured) ───
  if (config.imageApiKey) {
    api.registerTool(
      {
        name: "generate_image",
        description:
          "Generate an AI image and automatically inscribe it on-chain. Returns the permanent on-chain URL ready to use in messages, profiles, or token launches.",
        parameters: Type.Object({
          prompt: Type.String({ description: "Image description / prompt" }),
        }),
        async execute(_id: string, params: { prompt: string }) {
          try {
            const ctx = await ctxPromise;
            const filePath = await generateImage(config.imageApiKey!, params.prompt);
            const { txSig } = await inscribeData(ctx, filePath);
            const url = `${URLS.gateway}/img/${txSig}`;
            return textResult(`Image generated and inscribed on-chain.\ntx: ${txSig}\nURL: ${url}`);
          } catch (err) {
            return textResult(`Failed to generate image: ${err instanceof Error ? err.message : String(err)}`);
          }
        },
      },
    );
  }
}
