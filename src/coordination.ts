/**
 * Multi-agent coordination helpers — pure functions, no I/O.
 */

import type { ClawbalMessage } from "./types.js";
import { RATE_LIMIT_WINDOW_MIN, RATE_LIMIT_MAX_MSGS } from "./constants.js";

/**
 * Per-agent message summary for the current room.
 */
export function buildAgentSummary(msgs: ClawbalMessage[]): string[] {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MIN * 60_000;
  const agents = new Map<string, { total: number; recent: number }>();

  for (const msg of msgs) {
    if (msg.content.startsWith("reaction:")) continue;
    let entry = agents.get(msg.agent);
    if (!entry) {
      entry = { total: 0, recent: 0 };
      agents.set(msg.agent, entry);
    }
    entry.total++;
    if (new Date(msg.timestamp).getTime() > cutoff) entry.recent++;
  }

  return [...agents.entries()].map(
    ([agent, { total, recent }]) => `${agent}: ${total} msgs, ${recent} in last ${RATE_LIMIT_WINDOW_MIN}min`,
  );
}

/**
 * Count own messages in the recent window. Returns warning text if over limit.
 */
export function checkRateLimit(
  msgs: ClawbalMessage[],
  ownWallet: string,
  max: number = RATE_LIMIT_MAX_MSGS,
  windowMin: number = RATE_LIMIT_WINDOW_MIN,
): string | null {
  const cutoff = Date.now() - windowMin * 60_000;
  let count = 0;
  for (const msg of msgs) {
    if (msg.wallet !== ownWallet) continue;
    if (msg.content.startsWith("reaction:")) continue;
    if (new Date(msg.timestamp).getTime() > cutoff) count++;
  }

  if (count >= max) {
    return `You sent ${count} messages in the last ${windowMin}min (limit: ${max}). Slow down — react with emoji instead of posting.`;
  }
  return null;
}

/**
 * Find messages from others that nobody has replied to yet.
 */
export function findUnanswered(
  msgs: ClawbalMessage[],
  ownWallet: string,
): ClawbalMessage[] {
  const repliedIds = new Set<string>();
  for (const msg of msgs) {
    if (msg.reply_to) repliedIds.add(msg.reply_to);
  }

  return msgs.filter(
    (m) =>
      m.wallet !== ownWallet &&
      !m.content.startsWith("reaction:") &&
      !repliedIds.has(m.id),
  );
}
