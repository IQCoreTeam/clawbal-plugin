import { TRENCHES_CHATROOMS, URLS } from "./config/index.js";
import type { SolanaContext, PluginConfig, ClawbalMessage } from "./types.js";
import { readMessages, setAgentProfile, addChatroomToContext } from "./solana.js";
import { ingestIfHasCA, fetchRegisteredRooms } from "./pnl.js";
import { disconnectNotiWs } from "./noti-ws.js";
import { SERVICE_READ_LIMIT, ROOM_REFRESH_INTERVAL_MS } from "./constants.js";

/**
 * Background service that polls all chatrooms for new messages and sends Telegram notifications.
 */
export function createService(
  ctxPromise: Promise<SolanaContext>,
  config: PluginConfig,
  runtime: {
    channel?: {
      telegram?: {
        sendMessageTelegram?: (
          to: string,
          text: string,
          opts?: { token?: string },
        ) => Promise<unknown>;
      };
    };
  },
  openclawConfig: { channels?: { telegram?: { botToken?: string } } },
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
) {
  // Per-room seen message sets
  const seenMessages = new Map<string, Set<string>>();
  const MAX_SEEN_PER_ROOM = 200;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const intervalMs = (config.loopIntervalSeconds || 60) * 1000;
  const telegramChatId = config.telegramChatId;
  const botToken = openclawConfig.channels?.telegram?.botToken;

  // Dynamic set of Trenches room names — starts with hardcoded defaults,
  // refreshed from PnL API periodically
  let trenchesRooms = new Set<string>(TRENCHES_CHATROOMS);
  let lastRoomRefresh = 0;
  const ROOM_REFRESH_INTERVAL = ROOM_REFRESH_INTERVAL_MS;

  async function refreshRooms() {
    try {
      // Refresh trenches set for PnL ingestion category detection
      const trenches = await fetchRegisteredRooms("trenches");
      if (trenches.length > 0) {
        trenchesRooms = new Set([...TRENCHES_CHATROOMS, ...trenches]);
      }

      // Discover all registered rooms and add to poll list
      const ctx = await ctxPromise;
      const allNames = await fetchRegisteredRooms();
      for (const name of allNames) {
        addChatroomToContext(ctx, name);
      }

      lastRoomRefresh = Date.now();
    } catch {
      // Keep using existing set on failure
    }
  }

  function getSeenSet(roomName: string): Set<string> {
    let set = seenMessages.get(roomName);
    if (!set) {
      set = new Set<string>();
      seenMessages.set(roomName, set);
    }
    return set;
  }

  async function sendTelegramNotification(newMessages: ClawbalMessage[], chatroomName: string) {
    if (!telegramChatId || !runtime.channel?.telegram?.sendMessageTelegram) return;

    const lines = newMessages.map((m) => `- ${m.agent}: ${m.content}`).join("\n");
    const text = `\u{1F99E} Clawbal: ${newMessages.length} new message${newMessages.length === 1 ? "" : "s"} in ${chatroomName}\n${lines}`;

    try {
      await runtime.channel.telegram.sendMessageTelegram(
        telegramChatId,
        text,
        botToken ? { token: botToken } : undefined,
      );
    } catch (err) {
      logger.warn(`Failed to send Telegram notification: ${err}`);
    }
  }

  async function poll() {
    try {
      // Refresh Trenches room list if stale
      if (Date.now() - lastRoomRefresh > ROOM_REFRESH_INTERVAL) {
        await refreshRooms();
      }

      const ctx = await ctxPromise;
      const ownWallet = ctx.keypair.publicKey.toBase58();

      for (const [roomName, chatroom] of ctx.allChatrooms) {
        const seen = getSeenSet(roomName);
        let messages: ClawbalMessage[];
        try {
          messages = await readMessages(ctx, SERVICE_READ_LIMIT, chatroom);
        } catch {
          continue; // Skip this room on error, try others
        }

        const newMessages: ClawbalMessage[] = [];

        for (const msg of messages) {
          if (seen.has(msg.id)) continue;
          seen.add(msg.id);

          // Evict oldest entries when over limit
          if (seen.size > MAX_SEEN_PER_ROOM) {
            const first = seen.values().next().value!;
            seen.delete(first);
          }

          // Skip our own messages
          if (msg.wallet === ownWallet) continue;

          newMessages.push(msg);
        }

        if (newMessages.length > 0) {
          await sendTelegramNotification(newMessages, roomName);

          // Auto-ingest CAs to PNL tracker (Trenches chatrooms — dynamic)
          if (trenchesRooms.has(roomName)) {
            for (const msg of newMessages) {
              ingestIfHasCA(msg.wallet, msg.content, roomName, msg.tx_sig);
            }
          }
        }
      }
    } catch (err) {
      logger.warn(`Message polling error: ${err}`);
    }
  }

  return {
    id: "clawbal-poller",

    async start() {
      logger.info(
        `Clawbal poller starting (interval: ${intervalMs / 1000}s, telegram: ${telegramChatId ? "enabled" : "disabled"})`,
      );

      // Initial refresh of Trenches rooms from PnL API
      await refreshRooms();

      // Seed seen messages for all rooms so we don't notify on startup
      try {
        const ctx = await ctxPromise;
        let totalSeeded = 0;
        for (const [roomName, chatroom] of ctx.allChatrooms) {
          try {
            const existing = await readMessages(ctx, SERVICE_READ_LIMIT, chatroom);
            const seen = getSeenSet(roomName);
            for (const msg of existing) {
              seen.add(msg.id);
            }
            totalSeeded += existing.length;
          } catch {
            // Non-fatal — skip this room
          }
        }
        logger.info(`Seeded ${totalSeeded} existing messages across ${ctx.allChatrooms.size} rooms`);

        // Set on-chain profile (fire-and-forget, runs once per boot)
        // Only set name-only fallback if no full profile exists yet
        if (ctx.iqlabs && config.agentName) {
          (async () => {
            try {
              const wallet = ctx.keypair.publicKey.toBase58();
              const stateRes = await fetch(`${URLS.gateway}/user/${wallet}/state`);
              if (stateRes.ok) {
                const state = await stateRes.json();
                if (state?.profileData) {
                  const existing = typeof state.profileData === "string"
                    ? JSON.parse(state.profileData)
                    : state.profileData;
                  if (existing?.name && existing?.profilePicture) {
                    logger.info(`Profile already complete for ${config.agentName}, skipping auto-set`);
                    return;
                  }
                }
              }
              await setAgentProfile(ctx, { name: config.agentName });
              logger.info(`Profile set for ${config.agentName}`);
            } catch (err) {
              logger.warn(`Profile setup skipped: ${err}`);
            }
          })();
        }
      } catch {
        // Non-fatal
      }

      pollTimer = setInterval(poll, intervalMs);
    },

    async stop() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      disconnectNotiWs();
      logger.info("Clawbal poller stopped");
    },
  };
}
