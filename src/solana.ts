import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import { createHash } from "crypto";
import { createRequire } from "module";
import { existsSync, readFileSync } from "fs";
import { basename, extname } from "path";
import { nanoid } from "nanoid";
import bs58 from "bs58";

import { parsePnlCommand, buildPnlImageUrl, ingestPnl, DB_ROOT_NAME, CHATROOM_PREFIX, CHATROOM_NAMES, CHATROOM_REGISTRY_TABLE, GLOBAL_USER_LIST_TABLE, CHATROOM_METADATA_SUFFIX, DEFAULT_CHATROOM, URLS } from "./config/index.js";
import { DEFAULT_READ_LIMIT } from "./constants.js";
import type { PluginConfig, ClawbalMessage, ClawbalChatroom, IQLabsSDK, SolanaContext } from "./types.js";
import { ingestIfHasCA } from "./pnl.js";
import { sendTyping, sendMessageSent } from "./noti-ws.js";

function sha256(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

function getProgramId(iqlabs: IQLabsSDK): PublicKey {
  return typeof iqlabs.contract.getProgramId === "function"
    ? iqlabs.contract.getProgramId()
    : (iqlabs.contract as unknown as { PROGRAM_ID: PublicKey }).PROGRAM_ID;
}

/**
 * Initialize Solana connection, keypair, and SDK.
 * Returns a SolanaContext used by all tools.
 */
export async function initSolana(config: PluginConfig): Promise<SolanaContext> {
  const rpcUrl = config.solanaRpcUrl || URLS.solanaRpc;
  const connection = new Connection(rpcUrl, "confirmed");

  // Decode private key — supports both base58 and JSON array formats
  let keypair: Keypair;
  const keyStr = config.solanaPrivateKey.trim();
  if (keyStr.startsWith("[")) {
    keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(keyStr)));
  } else {
    keypair = Keypair.fromSecretKey(bs58.decode(keyStr));
  }

  // Try to import iqlabs-sdk dynamically
  let iqlabs: IQLabsSDK | null = null;
  try {
    const mod = await import("iqlabs-sdk");
    iqlabs = (mod.default || mod) as unknown as IQLabsSDK;
  } catch {
    // SDK not available — read-only mode via gateway API
  }

  const dbRootId = sha256(DB_ROOT_NAME);
  let programId: PublicKey | null = null;
  let dbRootPda: PublicKey | null = null;

  if (iqlabs) {
    programId = getProgramId(iqlabs);
    dbRootPda = iqlabs.contract.getDbRootPda(dbRootId, programId);
  }

  // Build all known chatrooms
  const allChatrooms = new Map<string, ClawbalChatroom>();
  for (const name of CHATROOM_NAMES) {
    allChatrooms.set(name, buildChatroom(name, dbRootId, iqlabs, dbRootPda, programId));
  }

  const chatroomName = config.chatroom || DEFAULT_CHATROOM;
  const currentChatroom = allChatrooms.get(chatroomName)
    || buildChatroom(chatroomName, dbRootId, iqlabs, dbRootPda, programId);

  // Ensure the configured chatroom is in the map (handles custom rooms not in CHATROOM_NAMES)
  if (!allChatrooms.has(chatroomName)) {
    allChatrooms.set(chatroomName, currentChatroom);
  }

  return { connection, keypair, iqlabs, currentChatroom, allChatrooms };
}

/**
 * Build a ClawbalChatroom from name + on-chain refs
 */
export function buildChatroom(
  name: string,
  dbRootId: Buffer,
  iqlabs: IQLabsSDK | null,
  dbRootPda: PublicKey | null,
  programId: PublicKey | null,
): ClawbalChatroom {
  const tableSeed = sha256(`${CHATROOM_PREFIX}${name}`);
  let tablePda = "";

  if (iqlabs && dbRootPda && programId) {
    const pda = iqlabs.contract.getTablePda(dbRootPda, tableSeed, programId);
    tablePda = pda.toBase58();
  }

  return { name, dbRootId, tableSeed, tablePda };
}

/**
 * Send a message to a chatroom on-chain.
 * Defaults to ctx.currentChatroom if no chatroom specified.
 */
export async function sendMessage(
  ctx: SolanaContext,
  content: string,
  agentName: string,
  chatroom?: ClawbalChatroom,
  replyTo?: string,
): Promise<string> {
  if (!ctx.iqlabs) {
    throw new Error("On-chain message sending requires iqlabs-sdk. Install it to enable write capability.");
  }

  const target = chatroom || ctx.currentChatroom;
  const wallet = ctx.keypair.publicKey.toBase58();
  const pnlCmd = parsePnlCommand(content);

  // /pnl commands get bot_message synchronously (URL generation)
  // Other messages: await ingestPnl for formatted response (Qreply)
  const botMessage = pnlCmd
    ? buildPnlImageUrl(URLS.base, wallet, pnlCmd)
    : await ingestPnl(wallet, content);

  const message: ClawbalMessage = {
    id: nanoid(),
    agent: agentName,
    wallet,
    content,
    ...(botMessage ? { bot_message: botMessage } : {}),
    ...(replyTo ? { reply_to: replyTo } : {}),
    timestamp: new Date().toISOString(),
  };

  const txSig = await ctx.iqlabs.writer.writeRow(
    ctx.connection,
    ctx.keypair,
    target.dbRootId,
    target.tableSeed,
    JSON.stringify(message),
  );

  // Fire-and-forget: clear typing + notify subscribers
  sendTyping(target.name, agentName, false);
  sendMessageSent(target.name, txSig);

  // Fire-and-forget: ingest CA to PNL tracker
  // PnL API validates room_name against its rooms table; unregistered rooms get null attribution
  ingestIfHasCA(message.wallet, content, target.name, txSig);

  return txSig;
}

/**
 * Add a reaction (emoji) to a message in a chatroom.
 * Reactions are stored as regular rows using the existing table columns.
 * The content field uses format "reaction:{emoji}:{target_id}" which the
 * frontend processRows() detects and converts to reaction objects.
 */
export async function addReaction(
  ctx: SolanaContext,
  messageId: string,
  emoji: string,
  agentName: string,
  chatroom?: ClawbalChatroom,
): Promise<string> {
  if (!ctx.iqlabs) {
    throw new Error("On-chain reactions require iqlabs-sdk. Install it to enable write capability.");
  }

  const target = chatroom || ctx.currentChatroom;
  const wallet = ctx.keypair.publicKey.toBase58();

  // Encode reaction data into existing table columns
  // content format: "reaction:{emoji}:{target_id}"
  const row = {
    id: nanoid(),
    agent: agentName,
    wallet,
    content: `reaction:${emoji}:${messageId}`,
    timestamp: new Date().toISOString(),
  };

  const txSig = await ctx.iqlabs.writer.writeRow(
    ctx.connection,
    ctx.keypair,
    target.dbRootId,
    target.tableSeed,
    JSON.stringify(row),
  );

  sendMessageSent(target.name, txSig);
  return txSig;
}

/**
 * Set the agent's on-chain profile (name, bio, profilePicture).
 * Flow: codeIn metadata JSON → updateUserMetadata instruction → register in global_user_list.
 * Adapted from solchat-web/components/users/use-user-profile-manager.ts.
 */
export async function setAgentProfile(
  ctx: SolanaContext,
  profile: { name?: string; bio?: string; profilePicture?: string },
): Promise<string> {
  if (!ctx.iqlabs) {
    throw new Error("Profile setting requires iqlabs-sdk. Install it to enable write capability.");
  }

  const programId = getProgramId(ctx.iqlabs);
  const dbRootId = sha256(DB_ROOT_NAME);
  const dbRootPda = ctx.iqlabs.contract.getDbRootPda(dbRootId, programId);
  const userPk = ctx.keypair.publicKey;
  const userPda = ctx.iqlabs.contract.getUserPda(userPk, programId);

  // 1. Store profile metadata via codeIn
  const fullMetadata = JSON.stringify({
    name: profile.name || "",
    bio: profile.bio || "",
    profilePicture: profile.profilePicture || "",
  });

  const txId = await ctx.iqlabs.writer.codeIn(
    { connection: ctx.connection, signer: ctx.keypair },
    [fullMetadata],
    undefined,
    0,
    "profile-metadata",
  );

  if (!txId) throw new Error("Failed to store metadata transaction");

  // 2. Ensure db_root is initialized
  const rootInfo = await ctx.connection.getAccountInfo(dbRootPda);
  if (!rootInfo) {
    const require = createRequire(import.meta.url);
    const idl = require("iqlabs-sdk/idl/code_in.json");
    const builder = ctx.iqlabs.contract.createInstructionBuilder(idl, programId);

    const initRootIx = ctx.iqlabs.contract.initializeDbRootInstruction(
      builder,
      {
        db_root: dbRootPda,
        signer: userPk,
        system_program: SystemProgram.programId,
      },
      { db_root_id: Buffer.from(dbRootId) },
    );

    try {
      const tx = new Transaction().add(initRootIx);
      await sendAndConfirmTransaction(ctx.connection, tx, [ctx.keypair]);
    } catch (err) {
      // Ignore if already initialized by another tx
      if (!(err instanceof Error && (err.message.includes("already in use") || err.message.includes("AlreadyInUse")))) {
        throw err;
      }
    }
  }

  // 3. Update user metadata on-chain (point to the codeIn tx)
  const require2 = createRequire(import.meta.url);
  const idl2 = require2("iqlabs-sdk/idl/code_in.json");
  const builder2 = ctx.iqlabs.contract.createInstructionBuilder(idl2, programId);

  const updateIx = ctx.iqlabs.contract.updateUserMetadataInstruction(
    builder2,
    {
      user: userPda,
      db_root: dbRootPda,
      signer: userPk,
      system_program: SystemProgram.programId,
    },
    {
      db_root_id: Buffer.from(dbRootId),
      meta: Buffer.from(txId, "utf8"),
    },
  );

  const updateTx = new Transaction().add(updateIx);
  await sendAndConfirmTransaction(ctx.connection, updateTx, [ctx.keypair]);

  // 4. Fire-and-forget: register in global_user_list
  const userListSeed = Buffer.from(GLOBAL_USER_LIST_TABLE, "utf8");
  const rowData = JSON.stringify({ pubkeyString: userPk.toBase58() });
  ctx.iqlabs.writer.writeRow(
    ctx.connection,
    ctx.keypair,
    dbRootId,
    userListSeed,
    rowData,
  ).catch(() => { /* non-fatal */ });

  return txId;
}

/**
 * Read recent messages from a chatroom.
 * Defaults to ctx.currentChatroom if no chatroom specified.
 * Uses 3-tier fallback: API → gateway → direct SDK.
 */
export async function readMessages(
  ctx: SolanaContext,
  limit: number = DEFAULT_READ_LIMIT,
  chatroom?: ClawbalChatroom,
): Promise<ClawbalMessage[]> {
  const target = chatroom || ctx.currentChatroom;

  // Tier 1: Clawbal API (works without SDK)
  try {
    const apiUrl = `${URLS.base}/api/v1/messages?chatroom=${encodeURIComponent(target.name)}&limit=${limit}`;
    const response = await fetch(apiUrl);
    if (response.ok) {
      const data = await response.json();
      return (data.messages || []) as ClawbalMessage[];
    }
  } catch {
    // fall through to gateway
  }

  // Tier 2: Gateway (needs table PDA)
  if (target.tablePda) {
    try {
      const gatewayUrl = `${URLS.gateway}/table/${target.tablePda}/rows?limit=${limit}`;
      const response = await fetch(gatewayUrl);
      if (response.ok) {
        const data = await response.json();
        return (data.rows || data || []) as ClawbalMessage[];
      }
    } catch {
      // fall through to direct read
    }
  }

  // Tier 3: Direct on-chain read via SDK
  if (ctx.iqlabs && target.tablePda) {
    try {
      const tablePda = new PublicKey(target.tablePda);
      const rows = await ctx.iqlabs.reader.readTableRows(tablePda, { limit });
      return rows as unknown as ClawbalMessage[];
    } catch {
      // all tiers failed
    }
  }

  return [];
}

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  json: "application/json",
  txt: "text/plain",
};

function resolveFilePath(input: string): string | null {
  let p = input.trim();
  if (p.startsWith("file://")) p = p.slice(7);
  if (p.startsWith("/") && existsSync(p)) return p;
  return null;
}

/**
 * Inscribe data on Solana via codeIn.
 * Accepts either:
 *  - A file path (or file:// URL) → reads the file, base64 encodes, detects MIME
 *  - Raw text → inscribes as-is with text/plain
 *
 * Follows the same pattern as the SDK's upload-test.ts:
 *   readFile → base64 → codeIn(data, filename, method, filetype)
 */
export async function inscribeData(
  ctx: SolanaContext,
  input: string,
  filename?: string,
): Promise<{ txSig: string; isImage: boolean }> {
  if (!ctx.iqlabs) {
    throw new Error("On-chain data inscription requires iqlabs-sdk. Install it to enable write capability.");
  }

  const filePath = resolveFilePath(input);

  let data: string;
  let resolvedName: string;
  let filetype: string;

  if (filePath) {
    // File path: read → base64, detect MIME from extension
    const fileData = readFileSync(filePath);
    data = fileData.toString("base64");
    resolvedName = filename || basename(filePath);
    const ext = extname(resolvedName).slice(1).toLowerCase();
    filetype = MIME_TYPES[ext] || "application/octet-stream";
  } else {
    // Raw text data
    data = input;
    resolvedName = filename || "data.txt";
    filetype = "text/plain";
  }

  const txSig = await ctx.iqlabs.writer.codeIn(
    { connection: ctx.connection, signer: ctx.keypair },
    data,
    resolvedName,
    0,
    filetype,
  );

  return { txSig, isImage: filePath !== null && filetype.startsWith("image/") };
}

const MESSAGE_COLUMNS = ["id", "agent", "wallet", "content", "bot_message", "reply_to", "timestamp", "tx_sig"];

/**
 * Create a new chatroom on-chain: create the table + register in chatroom registry.
 * Returns the built ClawbalChatroom and the table creation tx signature.
 */
export async function createChatroomOnChain(
  ctx: SolanaContext,
  name: string,
  description: string,
): Promise<{ chatroom: ClawbalChatroom; txSig: string }> {
  if (!ctx.iqlabs) {
    throw new Error("Chatroom creation requires iqlabs-sdk. Install it to enable write capability.");
  }

  const programId = getProgramId(ctx.iqlabs);
  const dbRootId = sha256(DB_ROOT_NAME);
  const dbRootPda = ctx.iqlabs.contract.getDbRootPda(dbRootId, programId);

  const tableSeed = sha256(`${CHATROOM_PREFIX}${name}`);
  const tablePda = ctx.iqlabs.contract.getTablePda(dbRootPda, tableSeed, programId);
  const instructionTablePda = ctx.iqlabs.contract.getInstructionTablePda(dbRootPda, tableSeed, programId);

  // Check if chatroom already exists
  const tableInfo = await ctx.connection.getAccountInfo(tablePda);
  if (tableInfo) {
    const chatroom = buildChatroom(name, dbRootId, ctx.iqlabs, dbRootPda, programId);
    return { chatroom, txSig: "(already exists)" };
  }

  // Load IDL for instruction building
  const require = createRequire(import.meta.url);
  const idl = require("iqlabs-sdk/idl/code_in.json");
  const builder = ctx.iqlabs.contract.createInstructionBuilder(idl, programId);

  const ix = ctx.iqlabs.contract.createTableInstruction(builder, {
    db_root: dbRootPda,
    receiver: ctx.keypair.publicKey,
    signer: ctx.keypair.publicKey,
    table: tablePda,
    instruction_table: instructionTablePda,
    system_program: SystemProgram.programId,
  }, {
    db_root_id: Buffer.from(dbRootId),
    table_seed: Buffer.from(tableSeed),
    table_name: Buffer.from(`${CHATROOM_PREFIX}${name}`),
    column_names: MESSAGE_COLUMNS.map(c => Buffer.from(c)),
    id_col: Buffer.from("id"),
    ext_keys: [],
    gate_mint_opt: null,
    writers_opt: null,
  });

  const tx = new Transaction().add(ix);
  const txSig = await sendAndConfirmTransaction(ctx.connection, tx, [ctx.keypair]);

  // Create metadata table for this room
  try {
    await ensureRoomMetadataTable(ctx, name);
    // Write initial metadata row
    const metaSeed = sha256(`${CHATROOM_PREFIX}${name}${CHATROOM_METADATA_SUFFIX}`);
    const metaRow = JSON.stringify({
      name,
      description,
      image: "",
      updatedBy: ctx.keypair.publicKey.toBase58(),
      updatedAt: new Date().toISOString(),
    });
    await ctx.iqlabs.writer.writeRow(ctx.connection, ctx.keypair, dbRootId, metaSeed, metaRow);
  } catch {
    // Non-fatal — chatroom works without metadata table
  }

  // Register in chatroom registry (seed must be sha256 to match the on-chain table)
  const registryTableSeed = sha256(CHATROOM_REGISTRY_TABLE);
  const wallet = ctx.keypair.publicKey.toBase58();
  const registryRow = JSON.stringify({ name, description, createdBy: wallet });
  try {
    await ctx.iqlabs.writer.writeRow(ctx.connection, ctx.keypair, dbRootId, registryTableSeed, registryRow);
  } catch {
    // Non-fatal — table was created even if registry write fails
  }

  const chatroom = buildChatroom(name, dbRootId, ctx.iqlabs, dbRootPda, programId);
  return { chatroom, txSig };
}

const METADATA_COLUMNS = ["name", "description", "image", "updatedBy", "updatedAt"];

/**
 * Ensure a per-room metadata table exists on-chain.
 * Table seed: sha256("chatroom:{roomName}_metadata")
 */
async function ensureRoomMetadataTable(ctx: SolanaContext, roomName: string): Promise<void> {
  if (!ctx.iqlabs) throw new Error("SDK required");

  const programId = getProgramId(ctx.iqlabs);
  const dbRootId = sha256(DB_ROOT_NAME);
  const dbRootPda = ctx.iqlabs.contract.getDbRootPda(dbRootId, programId);

  const metaTableName = `${CHATROOM_PREFIX}${roomName}${CHATROOM_METADATA_SUFFIX}`;
  const tableSeed = sha256(metaTableName);
  const tablePda = ctx.iqlabs.contract.getTablePda(dbRootPda, tableSeed, programId);

  // Already exists?
  const tableInfo = await ctx.connection.getAccountInfo(tablePda);
  if (tableInfo) return;

  const instructionTablePda = ctx.iqlabs.contract.getInstructionTablePda(dbRootPda, tableSeed, programId);

  const require = createRequire(import.meta.url);
  const idl = require("iqlabs-sdk/idl/code_in.json");
  const builder = ctx.iqlabs.contract.createInstructionBuilder(idl, programId);

  const ix = ctx.iqlabs.contract.createTableInstruction(builder, {
    db_root: dbRootPda,
    receiver: ctx.keypair.publicKey,
    signer: ctx.keypair.publicKey,
    table: tablePda,
    instruction_table: instructionTablePda,
    system_program: SystemProgram.programId,
  }, {
    db_root_id: Buffer.from(dbRootId),
    table_seed: Buffer.from(tableSeed),
    table_name: Buffer.from(metaTableName),
    column_names: METADATA_COLUMNS.map(c => Buffer.from(c)),
    id_col: Buffer.from("name"),
    ext_keys: [],
    gate_mint_opt: null,
    writers_opt: null,
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(ctx.connection, tx, [ctx.keypair]);
}

/**
 * Set room metadata (name, description, image) for a chatroom.
 * Creates the metadata table if it doesn't exist yet.
 * Image can be a web2 URL or an inscribed on-chain gateway URL.
 */
export async function setRoomMetadata(
  ctx: SolanaContext,
  roomName: string,
  metadata: { name?: string; description?: string; image?: string },
): Promise<string> {
  if (!ctx.iqlabs) {
    throw new Error("Room metadata requires iqlabs-sdk. Install it to enable write capability.");
  }

  await ensureRoomMetadataTable(ctx, roomName);

  const dbRootId = sha256(DB_ROOT_NAME);
  const metaSeed = sha256(`${CHATROOM_PREFIX}${roomName}${CHATROOM_METADATA_SUFFIX}`);
  const wallet = ctx.keypair.publicKey.toBase58();

  const row = JSON.stringify({
    name: metadata.name || roomName,
    description: metadata.description || "",
    image: metadata.image || "",
    updatedBy: wallet,
    updatedAt: new Date().toISOString(),
  });

  const txSig = await ctx.iqlabs.writer.writeRow(
    ctx.connection,
    ctx.keypair,
    dbRootId,
    metaSeed,
    row,
  );

  return txSig;
}

/**
 * Get SOL balance in SOL (not lamports)
 */
export async function getBalance(ctx: SolanaContext): Promise<number> {
  try {
    const balance = await ctx.connection.getBalance(ctx.keypair.publicKey);
    return balance / 1e9;
  } catch {
    return 0;
  }
}

