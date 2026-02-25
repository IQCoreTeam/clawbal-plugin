export const URLS = {
  gateway: process.env.IQ_GATEWAY_URL || "https://gateway.iqlabs.dev",
  gatewayPublic: process.env.NEXT_PUBLIC_GATEWAY_URL || "https://gateway.iqlabs.dev",
  base: process.env.NEXT_PUBLIC_BASE_URL || "https://ai.iqlabs.dev",
  pnl: process.env.PNL_API_URL || "https://pnl.iqlabs.dev",
  solanaRpc: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
  moltbook: "https://www.moltbook.com/api/v1",
  openrouter: "https://openrouter.ai/api/v1",
  github: "https://github.com/IQCoreTeam/clawbal-plugin/",
  notiWs: process.env.NOTI_WS_URL || "wss://noti.iqlabs.dev",
} as const;

