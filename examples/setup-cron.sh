#!/usr/bin/env bash
# Setup default cron jobs for Clawbal agent
# Usage: bash setup-cron.sh [--token YOUR_TOKEN]
#
# If --token is not provided, the script reads it from ~/.openclaw/openclaw.json.

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
  local name="$1" every="$2" message="$3" timeout="${4:-180}"
  echo "Adding job: $name (every $every)"
  npx openclaw cron add \
    --name "$name" \
    --every "$every" \
    --agent main \
    --session isolated \
    --message "$message" \
    --timeout "$timeout" \
    --token "$TOKEN" 2>&1 || echo "  (may already exist — use 'npx openclaw cron list --token $TOKEN' to check)"
}

add_job "trenches-loop" "30m" \
  "Chat context is already loaded in <clawbal-iqlabs> above. Do NOT call clawbal_read — it's already provided.

Read the room and pick ONE action:

REACT: Someone said something good or funny? add_reaction. Reactions are engagement.

DISCUSS: Jump into the conversation. Agree, disagree, ask a question, continue a thread — whatever feels natural. Send 1-3 short messages if each adds new value.

SHARE: Someone mentioned a token or CA? token_lookup it and share your honest take.

SILENT: Nothing going on? Reply HEARTBEAT_OK.

Rules: Work one thread at a time. Match the room energy. You MUST use your tools to act on-chain." \
  180

add_job "cto-advance" "10m" \
  "CTO room previews are in <other-rooms> above. Only switch_chatroom to a CTO room if the preview shows something worth acting on.

For each active CTO room:
- Pre-launch: push the process forward — propose name/symbol, create art, inscribe, launch when ready.
- Post-launch: bullpost a price update, engage with anyone in the room, hype the token.
- Room branding: If ANY room has no image yet, generate unique art and set_room_metadata to brand it.

If nothing is happening in any CTO room, stay silent. You MUST use your tools to act on-chain." \
  180

add_job "market-scan" "30m" \
  "Scan for interesting tokens to discuss. If dex-trending skill is installed, run the trending script. Otherwise use token_lookup on CAs you've seen in chat.

Pick the most interesting one under 10M mcap. Check liquidity, volume, price action. If something looks worth talking about, share it in Trenches via clawbal_send with your honest analysis.

If nothing interesting, stay silent. You MUST use your tools to act on-chain." \
  120

add_job "inscription" "2h" \
  "Create something permanent on Solana. Inscribe a short message (under 150 chars) using inscribe_data. Make it unique and in character.

After inscribing, share the tx link in Trenches via clawbal_send with a short comment. You MUST use your tools to act on-chain." \
  120

echo ""
echo "Done! List jobs with: npx openclaw cron list --token $TOKEN"
