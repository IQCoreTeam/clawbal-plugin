import { VersionedTransaction, type Keypair } from "@solana/web3.js";
import _bs58 from "bs58";
// bs58 v6 is ESM; jiti may wrap it as { default: { encode, decode } }
const bs58 = (_bs58 as unknown as { default?: typeof _bs58 }).default || _bs58;

const BAGS_BASE = "https://public-api-v2.bags.fm/api/v1";

async function fetchBags<T>(
  apiKey: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${BAGS_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "unknown error");
    throw new Error(`bags.fm ${path} failed (${response.status}): ${text}`);
  }
  const json = await response.json() as Record<string, unknown>;
  // bags.fm wraps all responses in {success, response} — unwrap
  if (json.success === false) {
    throw new Error(`bags.fm ${path}: ${json.response || "unknown error"}`);
  }
  return (json.response ?? json) as T;
}

export interface CreateTokenInfoParams {
  name: string;
  symbol: string;
  description: string;
  website?: string;
  imageUrl?: string;
  twitter?: string;
  telegram?: string;
}

export interface CreateTokenInfoResponse {
  tokenMint: string;
  tokenMetadata: string;
  tokenLaunch: Record<string, unknown>;
  [key: string]: unknown;
}

export function createTokenInfo(
  apiKey: string,
  params: CreateTokenInfoParams,
): Promise<CreateTokenInfoResponse> {
  return fetchBags(apiKey, "/token-launch/create-token-info", params as unknown as Record<string, unknown>);
}

export interface ConfigureFeesParams {
  payer: string;
  baseMint: string;
  claimersArray: string[];
  basisPointsArray: number[];
}

export interface ConfigureFeesResponse {
  needsCreation?: boolean;
  feeShareAuthority?: string;
  meteoraConfigKey?: string;
  transactions?: { transaction: string; blockhash: { blockhash: string; lastValidBlockHeight: number } }[];
  bundles?: unknown[];
  [key: string]: unknown;
}

export function configureFees(
  apiKey: string,
  params: ConfigureFeesParams,
): Promise<ConfigureFeesResponse> {
  return fetchBags(apiKey, "/fee-share/config", params as unknown as Record<string, unknown>);
}

export interface CreateLaunchTransactionParams {
  wallet: string;
  tokenMint: string;
  ipfs: string;
  configKey: string;
}

/**
 * Create a launch transaction. bags.fm returns the raw base58-encoded
 * transaction string directly (after envelope unwrap), NOT `{transaction: ...}`.
 */
export async function createLaunchTransaction(
  apiKey: string,
  params: CreateLaunchTransactionParams,
): Promise<string> {
  const result = await fetchBags<string | { transaction?: string }>(
    apiKey,
    "/token-launch/create-launch-transaction",
    params as unknown as Record<string, unknown>,
  );
  // API returns the tx string directly; handle both shapes defensively
  if (typeof result === "string") return result;
  if (result.transaction) return result.transaction;
  throw new Error("bags.fm create-launch-transaction: no transaction in response");
}

/**
 * Submit a signed transaction (base58-encoded) to bags.fm.
 * Returns the tx signature string.
 */
export async function sendTransaction(
  apiKey: string,
  transaction: string,
): Promise<string> {
  // bags.fm returns the raw signature string after envelope unwrap
  const result = await fetchBags<string | { signature?: string; txSignature?: string }>(
    apiKey,
    "/solana/send-transaction",
    { transaction },
  );
  if (typeof result === "string") return result;
  return result.signature || result.txSignature || "unknown";
}

/**
 * Look up a Solana wallet by social identity (twitter, moltbook, github).
 * Returns the wallet address string.
 */
export async function lookupWallet(
  apiKey: string,
  provider: "twitter" | "moltbook" | "github",
  username: string,
): Promise<string> {
  const url = `${BAGS_BASE}/token-launch/fee-share/wallet/v2?provider=${provider}&username=${username}`;
  const response = await fetch(url, {
    headers: { "x-api-key": apiKey },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "unknown error");
    throw new Error(`bags.fm wallet lookup failed (${response.status}): ${text}`);
  }
  const json = await response.json() as Record<string, unknown>;
  const inner = (json.response ?? json) as Record<string, unknown>;
  const wallet = inner.wallet as string | undefined;
  if (!wallet) throw new Error(`bags.fm wallet lookup: no wallet for ${provider}/${username}`);
  return wallet;
}

/**
 * Deserialize an unsigned transaction (base58 from bags.fm), sign with keypair, submit via bags.fm.
 * Returns the transaction signature.
 */
export async function signAndSend(
  apiKey: string,
  encodedTx: string,
  keypair: Keypair,
): Promise<string> {
  const txBytes = bs58.decode(encodedTx);
  const tx = VersionedTransaction.deserialize(txBytes);
  tx.sign([keypair]);
  const signed = bs58.encode(tx.serialize());
  return sendTransaction(apiKey, signed);
}
