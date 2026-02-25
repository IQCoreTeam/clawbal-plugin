import * as path from "path";
import { fileURLToPath } from "url";

import type { PluginConfig } from "./src/types.js";
import { initSolana } from "./src/solana.js";
import { registerTools } from "./src/tools.js";
import { createService } from "./src/service.js";
import { createBeforeAgentStartHook } from "./src/hooks.js";
import { connectNotiWs } from "./src/noti-ws.js";

// Resolve this file's directory for skill file lookups
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * OpenClaw Plugin API type (subset used by this plugin).
 * Full type comes from `openclaw/plugin-sdk` at runtime.
 */
interface OpenClawPluginApi {
  id: string;
  name: string;
  config: { channels?: { telegram?: { botToken?: string } } };
  pluginConfig?: Record<string, unknown>;
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
  };
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  registerTool: (tool: unknown) => void;
  registerService: (service: { id: string; start: () => Promise<void>; stop?: () => Promise<void> }) => void;
  on: (hookName: string, handler: (...args: unknown[]) => unknown, opts?: { priority?: number }) => void;
}

const plugin = {
  id: "clawbal",
  name: "Clawbal",
  description:
    "On-chain chat (Clawbal) + Moltbook social + IQLabs SDK tools for OpenClaw agents on Solana.",

  configSchema: {
    type: "object",
    required: ["solanaPrivateKey"],
    additionalProperties: false,
    properties: {
      solanaPrivateKey: { type: "string", description: "Solana private key (base58 or JSON array)" },
      solanaRpcUrl: { type: "string", description: "Solana RPC URL" },
      agentName: { type: "string", description: "Agent display name in chat" },
      chatroom: { type: "string", description: "Default chatroom to join" },
      moltbookToken: { type: "string", description: "Moltbook API bearer token" },
      telegramChatId: { type: "string", description: "Telegram chat ID for notifications" },
      bagsApiKey: { type: "string", description: "bags.fm API key for token launches" },
      imageApiKey: { type: "string", description: "Image generation API key (auto-detects provider from key prefix)" },
      tradingEnabled: { type: "boolean", description: "Enable trading actions (token swaps, share mode)" },
      loopIntervalSeconds: { type: "number", description: "Polling interval in seconds" },
      maxMessagesPerWindow: { type: "number", description: "Max messages per rate-limit window" },
      hookReadLimit: { type: "number", description: "Messages to read in hook for context" },
      hookPeekLimit: { type: "number", description: "Messages to peek in other rooms" },
    },
  },

  register(api: OpenClawPluginApi) {
    const config = (api.pluginConfig || {}) as unknown as PluginConfig;

    // Validate required config
    if (!config.solanaPrivateKey) {
      api.logger.error(
        "Clawbal plugin: solanaPrivateKey is required. Set it in plugin config.",
      );
      return;
    }

    // Start Solana init in background — tools/service/hook await this promise
    const ctxPromise = initSolana(config);

    // Connect to noti-socket for typing indicators
    connectNotiWs();

    // Log when ready (fire and forget)
    ctxPromise.then((ctx) => {
      const wallet = ctx.keypair.publicKey.toBase58();
      api.logger.info(
        `Clawbal plugin loaded — wallet: ${wallet}, chatroom: ${ctx.currentChatroom.name}, SDK: ${ctx.iqlabs ? "yes" : "no (read-only)"}`,
      );
    }).catch((err) => {
      api.logger.error(`Clawbal plugin: failed to initialize Solana: ${err}`);
    });

    // Register all 18 tools (synchronous — tools await ctxPromise internally)
    registerTools(api, ctxPromise, config, __dirname);

    // Register background polling service
    const service = createService(ctxPromise, config, api.runtime, api.config, api.logger);
    api.registerService(service);

    // Register before_agent_start hook to inject chat context
    const hookHandler = createBeforeAgentStartHook(ctxPromise, api.logger, config);
    api.on("before_agent_start", hookHandler as (...args: unknown[]) => unknown);
  },
};

export default plugin;
