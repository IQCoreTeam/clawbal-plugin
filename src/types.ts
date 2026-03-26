import type { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";

export interface PluginConfig {
  solanaPrivateKey: string;
  solanaRpcUrl?: string;
  agentName?: string;
  chatroom?: string;
  moltbookToken?: string;
  telegramChatId?: string;
  bagsApiKey?: string;
  imageApiKey?: string;
  tradingEnabled?: boolean;
  loopIntervalSeconds?: number;
  /** Max messages per rate-limit window before advisory warning (default 3) */
  maxMessagesPerWindow?: number;
  /** Messages to read in before_agent_start hook (default 25) */
  hookReadLimit?: number;
  /** Messages to peek in other rooms (default 8) */
  hookPeekLimit?: number;
  /** EVM private key (hex) for X Layer operations */
  evmPrivateKey?: string;
  /** X Layer RPC URL override */
  xlayerRpcUrl?: string;
  /** Use X Layer testnet instead of mainnet */
  xlayerTestnet?: boolean;
}

export interface ClawbalMessage {
  id: string;
  agent: string;
  wallet: string;
  content: string;
  /** Optional bot-generated message (PnL summary) */
  bot_message?: string;
  /** ID of the message being replied to */
  reply_to?: string;
  timestamp: string;
  tx_sig?: string;
}

export interface ClawbalChatroom {
  name: string;
  dbRootId: Buffer;
  tableSeed: Buffer;
  tablePda: string;
}

export interface MoltbookPost {
  id: string;
  title: string;
  content?: string;
  body?: string;
  submolt?: { name: string };
  author?: { name: string };
  upvotes?: number;
  comment_count?: number;
  created_at?: string;
}

export interface MoltbookComment {
  id: string;
  content: string;
  author?: { name: string };
  created_at?: string;
  parent_id?: string;
}

/** Dynamically imported at runtime — falls back to read-only if unavailable */
export interface IQLabsSDK {
  contract: {
    PROGRAM_ID: PublicKey;
    getProgramId?(): PublicKey;
    getDbRootPda(dbRootId: Buffer, programId: PublicKey): PublicKey;
    getTablePda(dbRootPda: PublicKey, tableSeed: Buffer, programId: PublicKey): PublicKey;
    getInstructionTablePda(dbRootPda: PublicKey, tableSeed: Buffer, programId: PublicKey): PublicKey;
    createInstructionBuilder(idl: unknown, programId: PublicKey): unknown;
    createTableInstruction(
      builder: unknown,
      accounts: Record<string, PublicKey>,
      args: Record<string, unknown>,
    ): TransactionInstruction;
    getUserPda(user: PublicKey, programId: PublicKey): PublicKey;
    updateUserMetadataInstruction(
      builder: unknown,
      accounts: { user: PublicKey; db_root: PublicKey; signer: PublicKey; system_program?: PublicKey },
      args: { db_root_id: Buffer; meta: Buffer },
    ): TransactionInstruction;
    initializeDbRootInstruction(
      builder: unknown,
      accounts: { db_root: PublicKey; signer: PublicKey; system_program?: PublicKey },
      args: { db_root_id: Buffer },
    ): TransactionInstruction;
  };
  writer: {
    writeRow(
      connection: Connection,
      keypair: Keypair,
      dbRootId: Buffer,
      tableSeed: Buffer,
      data: string,
    ): Promise<string>;
    codeIn(
      input: { connection: Connection; signer: Keypair },
      data: string | string[],
      filename?: string,
      method?: number,
      filetype?: string,
    ): Promise<string>;
    updateUserMetadata(
      connection: Connection,
      signer: Keypair,
      dbRootId: Buffer | Uint8Array | string,
      meta: Buffer | Uint8Array | string,
    ): Promise<string>;
    createTable(
      connection: Connection,
      signer: Keypair,
      dbRootId: string | Buffer,
      tableSeed: string | Buffer,
      tableName: string | Buffer,
      columnNames: (string | Buffer)[],
      idCol: string | Buffer,
      extKeys: (string | Buffer)[],
      gate: unknown | null,
      writers: unknown[] | null,
    ): Promise<string>;
  };
  reader: {
    readTableRows(
      tablePda: PublicKey,
      options?: { limit: number },
    ): Promise<Record<string, unknown>[]>;
    readCodeIn(txId: string): Promise<{ data: string | null }>;
  };
}

/** GET /mcap/:tokenCA */
export interface PnlTokenInfo {
  tokenCA: string;
  mcap: number;
  price: number;
  name: string;
  symbol: string;
  dex: string;
  volume24h: number;
  liquidity: number;
  priceChange1h: number;
  priceChange24h: number;
  buys1h: number;
  sells1h: number;
  pairCreatedAt: number;
  timestamp: number;
}

/** GET /users/:wallet/calls */
export interface PnlUserCallsResponse {
  calls: {
    tokenCA: string;
    firstCallTs: string;
    firstCallMcap: number;
    currentMcap: number | null;
    pnlPercent: number;
  }[];
  stats: {
    totalCalls: number;
    hitRate: number;
    avgReturn: number;
    medReturn: number;
  };
}

/** GET /leaderboard — per-call, sorted by PNL */
export interface PnlLeaderboardEntry {
  userWallet: string;
  tokenCA: string;
  entryMcap: number;
  currentMcap: number | null;
  pnlPercent: number;
}

export interface SolanaContext {
  connection: Connection;
  keypair: Keypair;
  iqlabs: IQLabsSDK | null;
  currentChatroom: ClawbalChatroom;
  allChatrooms: Map<string, ClawbalChatroom>;
}
