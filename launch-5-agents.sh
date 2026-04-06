#!/usr/bin/env bash
set -euo pipefail

# ━━━ Clawbal 5-Agent Launcher ━━━
# 메인 지갑에서 SOL을 5개 새 지갑으로 분배하고
# 각각 다른 프로필로 동시 실행합니다.
# 메인 방: crime/acc CTO
# 크론: ai crime 토큰 수다

info()  { printf '\033[0;36m%s\033[0m\n' "$*"; }
ok()    { printf '\033[0;32m  ✓ %s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33m  → %s\033[0m\n' "$*"; }
die()   { printf '\033[0;31m  ✗ %s\033[0m\n' "$*"; exit 1; }

# ── Config ──
HELIUS_RPC="https://mainnet.helius-rpc.com/?api-key=a0b8ead5-9dc8-4926-b537-9a4b32439f2f"
OPENROUTER_KEY="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"
MAIN_KEYPAIR="$HOME/keypair.json"
MILADY_KEYPAIR="$HOME/milady-keypair.json"
MAIN_CHATROOM="crime/acc CTO"
AGENT_COUNT=5
BASE_PORT=18800

# 에이전트별 크론 간격 (분) — 각각 다르게
CRON_INTERVALS=(15 22 18 25 12)

# NVM 로드
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

command -v node >/dev/null || die "node not found. nvm이 설정되어 있는지 확인하세요."

# ── Agent Names & Personalities ──
AGENT_NAMES=("CrimeAlpha" "AccDegen" "CrimeShill" "OnChainCop" "CrimeWatcher")
AGENT_VIBES=(
  "sharp alpha caller obsessed with ai crime token"
  "degen trader who lives for crime/acc culture"
  "relentless shill for ai crime ecosystem"
  "on-chain detective tracking crime token movements"
  "watchful analyst monitoring crime/acc CTO room"
)

# ━━━ Step 1: Generate 5 Keypairs ━━━
info ""
info "━━━ [1/4] Generating $AGENT_COUNT keypairs ━━━"
info ""

KEYPAIR_DIR="$HOME/.clawbal-agents"
mkdir -p "$KEYPAIR_DIR"

PUBKEYS=()
for i in $(seq 1 $AGENT_COUNT); do
  KP_FILE="$KEYPAIR_DIR/agent${i}.json"
  if [ -f "$KP_FILE" ]; then
    ok "agent${i} keypair already exists"
  else
    # Generate keypair via node (no solana-keygen needed)
    node -e '
const { Keypair } = require("@solana/web3.js");
const fs = require("fs");
const kp = Keypair.generate();
fs.writeFileSync(process.argv[1], JSON.stringify(Array.from(kp.secretKey)));
' "$KP_FILE"
    ok "generated agent${i} keypair"
  fi

  # Get pubkey
  PK=$(node -e '
const { Keypair } = require("@solana/web3.js");
const fs = require("fs");
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.argv[1], "utf-8"))));
console.log(kp.publicKey.toBase58());
' "$KP_FILE")
  PUBKEYS+=("$PK")
  info "  agent${i}: $PK"
done

# ━━━ Step 2: Distribute SOL from main + milady wallets ━━━
info ""
info "━━━ [2/4] Distributing SOL from main + milady wallets ━━━"
info ""

RPC_URL="$HELIUS_RPC" MAIN_KP="$MAIN_KEYPAIR" MILADY_KP="$MILADY_KEYPAIR" AGENT_COUNT="$AGENT_COUNT" PUBKEYS="$(IFS=,; echo "${PUBKEYS[*]}")" node -e '
const { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const fs = require("fs");

async function sendFromWallet(conn, kp, pubkeys, perAgent, label) {
  for (let i = 0; i < pubkeys.length; i++) {
    const balance = await conn.getBalance(kp.publicKey);
    if (balance < perAgent + 5000) {
      console.log("  " + label + ": insufficient balance, stopping transfers");
      return i;
    }

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: kp.publicKey,
        toPubkey: new PublicKey(pubkeys[i]),
        lamports: perAgent,
      })
    );
    try {
      const sig = await conn.sendTransaction(tx, [kp]);
      await conn.confirmTransaction(sig, "confirmed");
      console.log("  agent" + (i+1) + ": " + (perAgent / LAMPORTS_PER_SOL).toFixed(6) + " SOL from " + label + "  tx: " + sig.slice(0, 20) + "...");
    } catch (e) {
      console.log("  agent" + (i+1) + ": FAILED from " + label + " - " + e.message);
    }
  }
  return pubkeys.length;
}

async function main() {
  const conn = new Connection(process.env.RPC_URL, "confirmed");
  const agentCount = parseInt(process.env.AGENT_COUNT);
  const pubkeys = process.env.PUBKEYS.split(",");

  // Load wallets
  const mainKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.MAIN_KP, "utf-8"))));
  const mainBal = await conn.getBalance(mainKp.publicKey);
  console.log("Main wallet:   " + mainKp.publicKey.toBase58().slice(0,8) + "...  " + (mainBal / LAMPORTS_PER_SOL) + " SOL");

  let miladyKp = null;
  let miladyBal = 0;
  if (process.env.MILADY_KP && fs.existsSync(process.env.MILADY_KP)) {
    miladyKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.MILADY_KP, "utf-8"))));
    miladyBal = await conn.getBalance(miladyKp.publicKey);
    console.log("Milady wallet: " + miladyKp.publicKey.toBase58().slice(0,8) + "...  " + (miladyBal / LAMPORTS_PER_SOL) + " SOL");
  }

  // Total available (reserve 0.001 SOL in each source wallet)
  const reservePerWallet = 0.001 * LAMPORTS_PER_SOL;
  const feePerTx = 5000;
  const totalFees = feePerTx * agentCount * 2; // worst case both wallets send
  const totalAvailable = Math.max(0, mainBal - reservePerWallet) + Math.max(0, miladyBal - reservePerWallet) - totalFees;

  if (totalAvailable <= 0) {
    console.log("WARNING: Not enough SOL across both wallets.");
    process.exit(0);
  }

  const perAgent = Math.floor(totalAvailable / agentCount);
  console.log("\nTotal distributable: " + (totalAvailable / LAMPORTS_PER_SOL).toFixed(6) + " SOL");
  console.log("Per agent: " + (perAgent / LAMPORTS_PER_SOL).toFixed(6) + " SOL\n");

  // Check which agents already have balance
  const needsFunding = [];
  for (let i = 0; i < pubkeys.length; i++) {
    const bal = await conn.getBalance(new PublicKey(pubkeys[i]));
    if (bal > 0) {
      console.log("  agent" + (i+1) + ": already has " + (bal / LAMPORTS_PER_SOL) + " SOL, skipping");
    } else {
      needsFunding.push(pubkeys[i]);
    }
  }

  if (needsFunding.length === 0) {
    console.log("\nAll agents already funded!");
  } else {
    // Send from milady first (has more SOL), then main for remainder
    let funded = 0;
    if (miladyKp && miladyBal > reservePerWallet) {
      console.log("\nSending from milady wallet...");
      funded = await sendFromWallet(conn, miladyKp, needsFunding, perAgent, "milady");
    }

    if (funded < needsFunding.length) {
      console.log("\nSending from main wallet...");
      await sendFromWallet(conn, mainKp, needsFunding.slice(funded), perAgent, "main");
    }
  }

  // Final balances
  console.log("\n--- Final Balances ---");
  const finalMain = await conn.getBalance(mainKp.publicKey);
  console.log("  main:   " + (finalMain / LAMPORTS_PER_SOL) + " SOL");
  if (miladyKp) {
    const finalMilady = await conn.getBalance(miladyKp.publicKey);
    console.log("  milady: " + (finalMilady / LAMPORTS_PER_SOL) + " SOL");
  }
  for (let i = 0; i < pubkeys.length; i++) {
    const bal = await conn.getBalance(new PublicKey(pubkeys[i]));
    console.log("  agent" + (i+1) + ": " + (bal / LAMPORTS_PER_SOL) + " SOL");
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
'

# ━━━ Step 3: Create Profiles & Configs ━━━
info ""
info "━━━ [3/4] Creating OpenClaw profiles ━━━"
info ""

PLUGIN_SRC="$HOME/.openclaw/extensions/clawbal"

for i in $(seq 1 $AGENT_COUNT); do
  IDX=$((i - 1))
  PROFILE_NAME="crime${i}"
  PROFILE_DIR="$HOME/.openclaw-${PROFILE_NAME}"
  KP_FILE="$KEYPAIR_DIR/agent${i}.json"
  KP_CONTENTS=$(cat "$KP_FILE")
  PORT=$((BASE_PORT + i))
  AGENT_NAME="${AGENT_NAMES[$IDX]}"
  AGENT_VIBE="${AGENT_VIBES[$IDX]}"
  GW_TOKEN=$(openssl rand -hex 8 2>/dev/null || printf "tok-%s-%d" "$(date +%s)" "$i")

  # Create profile directory structure
  mkdir -p "$PROFILE_DIR/extensions/clawbal"
  mkdir -p "$PROFILE_DIR/workspace/skills"

  # Symlink plugin (saves disk space)
  if [ ! -f "$PROFILE_DIR/extensions/clawbal/index.ts" ]; then
    cp -r "$PLUGIN_SRC"/. "$PROFILE_DIR/extensions/clawbal/" 2>/dev/null || true
    # If plugin source doesn't exist, try from project dir
    if [ ! -f "$PROFILE_DIR/extensions/clawbal/index.ts" ]; then
      SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
      cp -r "$SCRIPT_DIR"/. "$PROFILE_DIR/extensions/clawbal/"
      (cd "$PROFILE_DIR/extensions/clawbal" && npm install 2>/dev/null) || true
    fi
  fi

  # Write config
  CFG_KP="$KP_CONTENTS" CFG_NAME="$AGENT_NAME" CFG_PORT="$PORT" CFG_TOKEN="$GW_TOKEN" node -e '
const fs = require("fs");
const config = {
  env: {
    OPENROUTER_API_KEY: "'"$OPENROUTER_KEY"'"
  },
  agents: {
    defaults: {
      model: { primary: "openrouter/deepseek/deepseek-v3.2" },
      compaction: { mode: "safeguard" },
      heartbeat: { target: "none" },
      maxConcurrent: 2,
      subagents: { maxConcurrent: 4 }
    }
  },
  tools: {
    allow: ["*"],
    web: { search: { enabled: true }, fetch: { enabled: true } },
    exec: { timeoutSec: 600 }
  },
  cron: { enabled: true, maxConcurrentRuns: 1 },
  commands: { native: "auto", nativeSkills: "auto" },
  channels: {},
  gateway: {
    port: parseInt(process.env.CFG_PORT),
    mode: "local",
    auth: { token: process.env.CFG_TOKEN }
  },
  plugins: {
    allow: ["clawbal"],
    entries: {
      clawbal: {
        enabled: true,
        config: {
          solanaPrivateKey: process.env.CFG_KP,
          solanaRpcUrl: "'"$HELIUS_RPC"'",
          agentName: process.env.CFG_NAME,
          chatroom: "crime/acc CTO",
          loopIntervalSeconds: 90,
          hookReadLimit: 20,
          hookPeekLimit: 5,
          maxMessagesPerWindow: 2
        }
      }
    }
  }
};
fs.writeFileSync(process.argv[1], JSON.stringify(config, null, 2) + "\n");
' "$PROFILE_DIR/openclaw.json"

  # Write IDENTITY.md
  cat > "$PROFILE_DIR/workspace/IDENTITY.md" <<IDEOF
- Name: ${AGENT_NAME}
- Creature: ai crime token degen agent
- Vibe: ${AGENT_VIBE}
IDEOF

  # Write SOUL.md (crime/acc focused)
  cat > "$PROFILE_DIR/workspace/SOUL.md" <<'SOULEOF'
You are stepping into Clawbal.

Clawbal is a live on-chain group chat on Solana.
Real agents, real wallets, real money on the line.
Every message is a transaction. Every reaction is signed.

You live in the crime/acc CTO room. This is YOUR room.
You are here to talk about AI CRIME token — the culture, the price action, the community.
You are a true believer in the ai crime / crime acc movement.

---

## Your mission

You are obsessed with ai crime token. You talk about:
- Price action, mcap, volume, liquidity of ai crime
- The crime/acc culture and memes
- Why ai crime is going to pump
- Replying to other agents and humans in the room
- Reacting to messages with fire emojis when someone says something bullish

You are NOT a generic chatbot. You are a crime/acc degen who lives and breathes this token.

---

## How you talk

Talk like texting in a group chat. Short, punchy, degen energy.
No markdown. No bullet points. No formal language.
Mix in crime/acc slang naturally.
Be bullish but not cringe. Be funny but not forced.

Examples:
- "crime looking juicy rn ngl"
- "anyone else see that volume spike? someone knows something"
- "crime/acc is a lifestyle not just a token"
- "if you're not in crime by now idk what to tell you"

---

## The rules

- ALWAYS use reply_to when responding to someone
- React before posting (add_reaction first)
- One message per cycle max
- If nobody's talking, stay quiet. Don't talk to yourself.
- If the last 3+ messages are all yours, respond HEARTBEAT_OK
- Use token_lookup to check crime token stats when discussing price
- PLAIN TEXT ONLY. No markdown ever.
SOULEOF

  # Copy shared files
  for f in TOOLS.md AGENTS.md HEARTBEAT.md; do
    [ -f "$PLUGIN_SRC/examples/$f" ] && cp "$PLUGIN_SRC/examples/$f" "$PROFILE_DIR/workspace/$f" 2>/dev/null || true
  done
  [ -d "$PLUGIN_SRC/examples/skills" ] && cp -r "$PLUGIN_SRC/examples/skills"/* "$PROFILE_DIR/workspace/skills/" 2>/dev/null || true

  # Write cron job with agent-specific interval
  CRON_MIN="${CRON_INTERVALS[$IDX]}"
  mkdir -p "$PROFILE_DIR/cron"
  cat > "$PROFILE_DIR/cron/jobs.json" <<CRONEOF
{
  "version": 1,
  "jobs": [
    {
      "name": "crime-chat",
      "enabled": true,
      "schedule": {
        "kind": "cron",
        "expr": "*/${CRON_MIN} * * * *",
        "staggerMs": $((IDX * 60000 + 30000))
      },
      "sessionTarget": "isolated",
      "wakeMode": "now",
      "payload": {
        "kind": "agentTurn",
        "message": "You are in the crime/acc CTO room. Chat context is already in <clawbal-iqlabs> above. Do NOT call clawbal_read.\n\nSELF-TALK CHECK FIRST:\nIf the last 3+ messages in <clawbal-iqlabs> are ALL from you with nobody else in between, respond HEARTBEAT_OK. Stop. Do not post.\n\nIF THERE IS ACTIVITY FROM OTHERS:\n1. add_reaction to a recent message from someone else (use fire, skull, or 100 emoji)\n2. Reply to the most interesting message about ai crime token using clawbal_send with reply_to set to their message ID\n3. Talk about ai crime token — price, vibes, culture, why it's pumping or about to pump\n4. If someone dropped a CA, use token_lookup and share your take\n5. Keep it short and degen. One message max.\n\nIF ROOM IS QUIET BUT YOU WANT TO START CONVERSATION:\n- Use token_lookup to check ai crime token stats\n- Drop a take about the current price action or volume\n- Keep it natural, like you're just thinking out loud in the group chat\n\nCRITICAL RULES:\n- MUST call tool functions. Never describe actions as text.\n- If no tool called, respond HEARTBEAT_OK only.\n- Do NOT modify cron jobs or files.\n- PLAIN TEXT ONLY. No markdown. Write like texting.",
        "timeoutSeconds": 120
      },
      "delivery": {
        "mode": "silent"
      }
    }
  ]
}
CRONEOF

  ok "profile crime${i} created (${AGENT_NAME}, port ${PORT})"
done

# ━━━ Step 4: Launch All ━━━
info ""
info "━━━ [4/4] Launching $AGENT_COUNT agents ━━━"
info ""

LOG_DIR="$HOME/.clawbal-agents/logs"
mkdir -p "$LOG_DIR"

# Kill any existing agents
for i in $(seq 1 $AGENT_COUNT); do
  PIDFILE="$KEYPAIR_DIR/agent${i}.pid"
  if [ -f "$PIDFILE" ]; then
    OLD_PID=$(cat "$PIDFILE")
    kill "$OLD_PID" 2>/dev/null || true
    rm -f "$PIDFILE"
  fi
done

info "Starting agents..."
echo ""

for i in $(seq 1 $AGENT_COUNT); do
  IDX=$((i - 1))
  PROFILE_NAME="crime${i}"
  PORT=$((BASE_PORT + i))
  AGENT_NAME="${AGENT_NAMES[$IDX]}"
  LOG_FILE="$LOG_DIR/agent${i}.log"

  # Launch in background
  npx openclaw --profile "$PROFILE_NAME" gateway > "$LOG_FILE" 2>&1 &
  AGENT_PID=$!
  echo "$AGENT_PID" > "$KEYPAIR_DIR/agent${i}.pid"

  ok "${AGENT_NAME} (crime${i}) started on port ${PORT} — PID ${AGENT_PID}"
  info "  log: $LOG_FILE"
done

echo ""
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "  $AGENT_COUNT agents launched!"
info "  Room: crime/acc CTO"
info "  Cron intervals: ${CRON_INTERVALS[0]}m / ${CRON_INTERVALS[1]}m / ${CRON_INTERVALS[2]}m / ${CRON_INTERVALS[3]}m / ${CRON_INTERVALS[4]}m"
info "  SOL source: main + milady wallets"
info "  Helius RPC: shared across all agents"
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
info "Useful commands:"
info "  tail -f $LOG_DIR/agent1.log   # watch agent 1"
info "  kill \$(cat $KEYPAIR_DIR/agent1.pid)  # stop agent 1"
info "  bash $(dirname "$0")/stop-agents.sh   # stop all"
echo ""
info "Chat UI: https://ai.iqlabs.dev/chat?room=crime%2Facc%20CTO"
echo ""
