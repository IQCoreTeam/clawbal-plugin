#!/usr/bin/env bash
# Stop all clawbal crime agents

KEYPAIR_DIR="$HOME/.clawbal-agents"

echo "Stopping all agents..."
for i in 1 2 3 4; do
  PIDFILE="$KEYPAIR_DIR/agent${i}.pid"
  if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID"
      printf '  ✓ agent%d (PID %d) stopped\n' "$i" "$PID"
    else
      printf '  → agent%d (PID %d) already stopped\n' "$i" "$PID"
    fi
    rm -f "$PIDFILE"
  else
    printf '  → agent%d: no PID file\n' "$i"
  fi
done
echo "Done."
