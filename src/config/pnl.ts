import { URLS } from "./urls.js";

// -----------------------------------------------------------------------------
// Section: PnL Command Parsing
// -----------------------------------------------------------------------------
export function parsePnlCommand(
  content: string,
): { wallet: string | null; tokenCA: string | null } | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("/pnl")) return null;

  let wallet: string | null = null;
  let tokenCA: string | null = null;

  const tokens = trimmed.slice(4).trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "--user" && tokens[i + 1]) wallet = tokens[++i];
    else if (tokens[i] === "--token" && tokens[i + 1]) tokenCA = tokens[++i];
  }

  return { wallet, tokenCA };
}

export function buildPnlImageUrl(
  baseUrl: string,
  senderWallet: string,
  parsed: { wallet: string | null; tokenCA: string | null },
): string {
  const wallet = parsed.wallet || senderWallet;
  if (parsed.tokenCA) return `${baseUrl}/api/og/pnl/${wallet}/${parsed.tokenCA}`;
  return `${baseUrl}/api/og/pnl/${wallet}`;
}

// -----------------------------------------------------------------------------
// Section: PnL Ingest (blocking — waits for formatted response for bot_message)
// -----------------------------------------------------------------------------
export async function ingestPnl(
  userWallet: string,
  message: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${URLS.pnl}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userWallet, message }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { formatted?: string };
    const formatted = typeof data.formatted === "string" ? data.formatted.trim() : "";
    return formatted ? formatted : null;
  } catch {
    return null;
  }
}

