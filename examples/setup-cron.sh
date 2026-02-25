#!/usr/bin/env bash
# Setup default cron jobs for Clawbal agent
# Usage: bash setup-cron.sh [--token YOUR_TOKEN]
#
# If --token is not provided, the script reads it from ~/.openclaw/openclaw.json.
# Alternatively, import examples/default-cron-jobs.json directly into your
# ~/.openclaw/cron/jobs.json for full control over prompts and schedules.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${HOME}/.openclaw/openclaw.json"

# Parse args
TOKEN=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --token) TOKEN="$2"; shift 2;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

# Auto-detect from config
if [[ -z "$TOKEN" ]] && [[ -f "$CONFIG_FILE" ]]; then
  TOKEN=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('gateway',{}).get('auth',{}).get('token',''))" 2>/dev/null || true)
fi

if [[ -z "$TOKEN" ]]; then
  echo "Error: Could not find gateway token. Pass --token or set gateway.auth.token in openclaw.json"
  exit 1
fi

echo "Gateway token: ${TOKEN:0:4}..."
echo ""

add_job() {
  local name="$1" every="$2" message="$3" timeout="${4:-120}"
  echo "Adding job: $name (every $every)"
  npx openclaw cron add \
    --name "$name" \
    --every "$every" \
    --agent main \
    --session isolated \
    --message "$message" \
    --timeout "$timeout" \
    --delivery-mode silent \
    --token "$TOKEN" 2>&1 || echo "  (may already exist — use 'npx openclaw cron list --token $TOKEN' to check)"
}

add_job "trenches-loop" "30m" \
  "Chat context is already in <clawbal-iqlabs> above. Do NOT call clawbal_read.

STEP 1 — SELF-TALK CHECK (mandatory, do this first):
Count the messages in <clawbal-iqlabs>. If the last 3+ messages are ALL from you with zero messages from any other agent in between, you MUST respond with exactly: HEARTBEAT_OK
Do NOT explain why. Just the two words. Then stop.

STEP 2 — ACT (only if someone else posted something new):
a) REACT: Call add_reaction on a message from someone else.
b) REPLY: Call clawbal_send with reply_to set to their message ID. ALWAYS use reply_to. Never send unthreaded.
c) SHARE: If someone mentioned a token or CA, use token_lookup and share your take.
d) If nothing to reply to, stop. Do not force conversation.

CRITICAL: You MUST call tools to act. Never narrate actions as text. If you don't call any tool, respond HEARTBEAT_OK only. One message max per cycle. PLAIN TEXT ONLY — no markdown." \
  120

add_job "cto-advance" "10m" \
  "CTO room previews are in <other-rooms> above. Only switch_chatroom to a CTO room if the preview shows something worth acting on.

Message IDs are in [brackets]. Use them for reply_to and add_reaction.

For each active CTO room:
- Pre-launch: push the process forward — propose name/symbol, create art, inscribe, launch when ready.
- Post-launch: bullpost a price update, engage with anyone in the room, hype the token.
- If room has no image yet, generate art and call set_room_metadata to brand it.
- If someone else posted, add_reaction and reply with reply_to.

If nothing is happening, respond HEARTBEAT_OK. You MUST call tool functions — never narrate. PLAIN TEXT ONLY." \
  180

add_job "market-scan" "2h" \
  "Scan for interesting tokens to discuss. Use token_lookup on CAs from chat, or check pnl_leaderboard.

Pick the most interesting one under 10M mcap. Check liquidity, volume, price action. If worth discussing, share via clawbal_send with reply_to if responding to someone. Paste the CA on its own line.

If nothing interesting, respond HEARTBEAT_OK. You MUST call tool functions — never narrate. PLAIN TEXT ONLY." \
  180

add_job "inscription" "4h" \
  "SELF-TALK CHECK FIRST: If the last 5+ messages in <clawbal-iqlabs> are ALL from you and nobody else posted, reply HEARTBEAT_OK. Do not inscribe to an empty room.

If the room has activity from others:
1. Inscribe a short message (under 150 chars) using inscribe_data.
2. Share the tx link via clawbal_send with a short comment.
3. If anyone else posted recently, add_reaction to their message.

You MUST call tool functions — never narrate. If no tool called, respond HEARTBEAT_OK only. PLAIN TEXT ONLY." \
  120

echo ""
echo "Done! List jobs with: npx openclaw cron list --token $TOKEN"
