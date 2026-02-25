import { URLS } from "./config/index.js";
import type {
  PnlTokenInfo,
  PnlUserCallsResponse,
  PnlLeaderboardEntry,
} from "./types.js";

const CA_PATTERN = /[1-9A-HJ-NP-Za-km-z]{32,44}/;

async function fetchPnl<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${URLS.pnl}${path}`, init);
  if (!response.ok) {
    const text = await response.text().catch(() => "unknown error");
    throw new Error(`PNL ${path} failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Ingest a message to the PNL tracker.
 * Server extracts the CA from the message text.
 */
function ingestCall(
  userWallet: string,
  message: string,
  roomName?: string,
  txSig?: string,
): Promise<unknown> {
  return fetchPnl("/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userWallet, message, roomName, txSig }),
  });
}

/**
 * Fire-and-forget ingest if the message likely contains a Solana CA.
 */
export function ingestIfHasCA(
  userWallet: string,
  message: string,
  roomName?: string,
  txSig?: string,
): void {
  if (!CA_PATTERN.test(message)) return;
  ingestCall(userWallet, message, roomName, txSig).catch(() => {});
}

/**
 * Get PNL calls for a specific wallet.
 */
export function getUserCalls(wallet: string): Promise<PnlUserCallsResponse> {
  return fetchPnl(`/users/${wallet}/calls`);
}

/**
 * Get the PNL leaderboard (flat array of top calls sorted by PNL).
 */
export function getLeaderboard(): Promise<PnlLeaderboardEntry[]> {
  return fetchPnl("/leaderboard");
}

/**
 * Get token info (price, mcap, liquidity) by contract address.
 */
export function getTokenInfo(tokenCA: string): Promise<PnlTokenInfo> {
  return fetchPnl(`/mcap/${tokenCA}`);
}

/**
 * Register a room with the PnL API. Fire-and-forget.
 */
export function registerRoom(
  roomName: string,
  category: "trenches" | "cto",
  tokenCA?: string,
  description?: string,
): void {
  fetchPnl("/admin/register-room", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomName, category, tokenCA, description }),
  }).catch((err) => {
    console.warn(`[pnl] Failed to register room "${roomName}":`, err);
  });
}

/**
 * Fetch registered room names from the PnL API, optionally filtered by category.
 */
export async function fetchRegisteredRooms(
  category?: "trenches" | "cto",
): Promise<string[]> {
  try {
    const qs = category ? `?category=${category}` : "";
    const data = await fetchPnl<{ success: boolean; rooms: { room_name: string }[] }>(
      `/admin/rooms${qs}`,
    );
    return data.rooms.map((r) => r.room_name);
  } catch {
    return [];
  }
}
