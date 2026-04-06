#!/usr/bin/env bash
set -euo pipefail

# ━━━ Start 5 Crime Agents ━━━
# setup-5-agents.sh 먼저 실행해야 함

info()  { printf '\033[0;36m%s\033[0m\n' "$*"; }
ok()    { printf '\033[0;32m  ✓ %s\033[0m\n' "$*"; }

AGENT_COUNT=4
KEYPAIR_DIR="$HOME/.clawbal-agents"
LOG_DIR="$KEYPAIR_DIR/logs"
AGENT_NAMES=("CrimeAlpha" "AccDegen" "CrimeShill" "OnChainCop" "CrimeWatcher")
BASE_PORT=18800

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

mkdir -p "$LOG_DIR"

# 기존 프로세스 정리
for i in $(seq 1 $AGENT_COUNT); do
  PIDFILE="$KEYPAIR_DIR/agent${i}.pid"
  if [ -f "$PIDFILE" ]; then
    OLD_PID=$(cat "$PIDFILE")
    kill "$OLD_PID" 2>/dev/null || true
    rm -f "$PIDFILE"
  fi
done

info "Starting $AGENT_COUNT agents..."
echo ""

for i in $(seq 1 $AGENT_COUNT); do
  IDX=$((i - 1))
  PROFILE_NAME="crime${i}"
  PORT=$((BASE_PORT + i))
  AGENT_NAME="${AGENT_NAMES[$IDX]}"
  LOG_FILE="$LOG_DIR/agent${i}.log"
  PROFILE_DIR="$HOME/.openclaw-${PROFILE_NAME}"

  if [ ! -f "$PROFILE_DIR/openclaw.json" ]; then
    printf '\033[0;31m  ✗ crime%d not set up. Run setup-5-agents.sh first.\033[0m\n' "$i"
    continue
  fi

  npx openclaw --profile "$PROFILE_NAME" gateway > "$LOG_FILE" 2>&1 &
  AGENT_PID=$!
  echo "$AGENT_PID" > "$KEYPAIR_DIR/agent${i}.pid"

  ok "${AGENT_NAME} (crime${i}) → port ${PORT} — PID ${AGENT_PID}"
done

echo ""
info "All agents started!"
info ""
info "  Logs:  tail -f $LOG_DIR/agent1.log"
info "  Stop:  bash $(dirname "$0")/stop-agents.sh"
info "  Room:  https://ai.iqlabs.dev/chat?room=crime%2Facc%20CTO"
echo ""
