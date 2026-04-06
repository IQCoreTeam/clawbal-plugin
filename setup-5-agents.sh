#!/usr/bin/env bash
set -euo pipefail

# ━━━ Clawbal 5-Agent Setup ━━━
# 1회만 실행: 키페어 생성, SOL 분배, 프로필 설정
# 이후 start-agents.sh 로 실행

info()  { printf '\033[0;36m%s\033[0m\n' "$*"; }
ok()    { printf '\033[0;32m  ✓ %s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33m  → %s\033[0m\n' "$*"; }
die()   { printf '\033[0;31m  ✗ %s\033[0m\n' "$*"; exit 1; }

# ── Config ──
HELIUS_RPC="https://mainnet.helius-rpc.com/?api-key=a0b8ead5-9dc8-4926-b537-9a4b32439f2f"
OPENROUTER_KEY="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"
MAIN_KEYPAIR="$HOME/keypair.json"
MILADY_KEYPAIR="$HOME/milady-keypair.json"
AGENT_COUNT=5
BASE_PORT=18800

# NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
command -v node >/dev/null || die "node not found"

# ── Agent Definitions ──
AGENT_NAMES=("CrimeAlpha" "AccDegen" "CrimeShill" "OnChainCop" "CrimeWatcher")
AGENT_VIBES=(
  "sharp alpha caller obsessed with ai crime token"
  "degen trader who lives for crime/acc culture"
  "relentless shill for ai crime ecosystem"
  "on-chain detective tracking crime token movements"
  "watchful analyst monitoring crime/acc CTO room"
)

# 각 에이전트 프로필 이미지 URL
AGENT_PFPS=(
  "https://cdn.discordapp.com/attachments/1425401180271673427/1483279023697170442/d60f5f0d8580b396603dab9c8d5df757.jpg?ex=69ba02bd&is=69b8b13d&hm=bad8853c63d0bb46c1700022e92fe8fd18e11786e0fce47e08d62a716818a085&"
  "https://cdn.discordapp.com/attachments/1425401180271673427/1483279024217391124/d86d2d7e5dac3bddeafd8fc7ec0a1131.jpg?ex=69ba02bd&is=69b8b13d&hm=e317fe5cb0a9c124df786331b165478520e69dd3b226cd6bf82d435e20c22c80&"
  "https://cdn.discordapp.com/attachments/1425401180271673427/1483279024586493952/Eric.svg.png?ex=69ba02bd&is=69b8b13d&hm=ead4b8e7893e107db2f63da2e573431810e9c138c3fad5ee8cfe602ffff4fcae&"
  "https://cdn.discordapp.com/attachments/1425401180271673427/1483279025043537920/image_2.jpg?ex=69ba02bd&is=69b8b13d&hm=68de871059805872bb45ac5c7cee5a5247fa2d3f94498a27084e745d266397dc&"
  "https://cdn.discordapp.com/attachments/1425401180271673427/1483279025714626723/zo_eth_crime_simple_logo_girl_with_gun_red_eyes_orange_hair_g_3c9cc915-387d-42ca-968a-1df2b794027e_0.png?ex=69ba02bd&is=69b8b13d&hm=f75bbffc69a646959cc1b574ca29f5694e2859c31b4fc81749a46db146da93c6&"
)

# 에이전트별 크론 간격 (분)
CRON_INTERVALS=(15 22 18 25 12)

KEYPAIR_DIR="$HOME/.clawbal-agents"
mkdir -p "$KEYPAIR_DIR"

# ━━━ Step 1: Generate Keypairs (재사용) ━━━
info ""
info "━━━ [1/3] Keypairs ━━━"
info ""

PUBKEYS=()
for i in $(seq 1 $AGENT_COUNT); do
  KP_FILE="$KEYPAIR_DIR/agent${i}.json"
  if [ -f "$KP_FILE" ]; then
    ok "agent${i} keypair exists (reusing)"
  else
    node -e '
const { Keypair } = require("@solana/web3.js");
const fs = require("fs");
const kp = Keypair.generate();
fs.writeFileSync(process.argv[1], JSON.stringify(Array.from(kp.secretKey)));
' "$KP_FILE"
    ok "generated agent${i} keypair"
  fi

  PK=$(node -e '
const { Keypair } = require("@solana/web3.js");
const fs = require("fs");
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.argv[1], "utf-8"))));
console.log(kp.publicKey.toBase58());
' "$KP_FILE")
  PUBKEYS+=("$PK")
  info "  agent${i} (${AGENT_NAMES[$((i-1))]}): $PK"
done

# ━━━ Step 2: Distribute SOL ━━━
info ""
info "━━━ [2/3] Distributing SOL (main + milady) ━━━"
info ""

RPC_URL="$HELIUS_RPC" MAIN_KP="$MAIN_KEYPAIR" MILADY_KP="$MILADY_KEYPAIR" AGENT_COUNT="$AGENT_COUNT" PUBKEYS="$(IFS=,; echo "${PUBKEYS[*]}")" node -e '
const { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const fs = require("fs");

async function sendFrom(conn, kp, targets, amount, label) {
  let sent = 0;
  for (const dest of targets) {
    const bal = await conn.getBalance(kp.publicKey);
    if (bal < amount + 5000) { console.log("  " + label + ": not enough left"); break; }
    const tx = new Transaction().add(SystemProgram.transfer({
      fromPubkey: kp.publicKey, toPubkey: new PublicKey(dest), lamports: amount
    }));
    try {
      const sig = await conn.sendTransaction(tx, [kp]);
      await conn.confirmTransaction(sig, "confirmed");
      console.log("  → " + dest.slice(0,8) + "...: " + (amount/LAMPORTS_PER_SOL).toFixed(6) + " SOL from " + label);
      sent++;
    } catch(e) { console.log("  FAIL " + dest.slice(0,8) + ": " + e.message); }
  }
  return sent;
}

async function main() {
  const conn = new Connection(process.env.RPC_URL, "confirmed");
  const count = parseInt(process.env.AGENT_COUNT);
  const pubkeys = process.env.PUBKEYS.split(",");

  const mainKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.MAIN_KP, "utf-8"))));
  const mainBal = await conn.getBalance(mainKp.publicKey);
  console.log("Main:   " + (mainBal / LAMPORTS_PER_SOL) + " SOL");

  let miladyKp = null, miladyBal = 0;
  if (process.env.MILADY_KP && fs.existsSync(process.env.MILADY_KP)) {
    miladyKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.MILADY_KP, "utf-8"))));
    miladyBal = await conn.getBalance(miladyKp.publicKey);
    console.log("Milady: " + (miladyBal / LAMPORTS_PER_SOL) + " SOL");
  }

  // 이미 잔액 있는 에이전트 스킵
  const needsFunding = [];
  for (let i = 0; i < pubkeys.length; i++) {
    const bal = await conn.getBalance(new PublicKey(pubkeys[i]));
    if (bal > 0) {
      console.log("agent" + (i+1) + ": " + (bal/LAMPORTS_PER_SOL) + " SOL (skip)");
    } else {
      needsFunding.push(pubkeys[i]);
    }
  }

  if (needsFunding.length === 0) { console.log("\nAll agents already funded!"); }
  else {
    const reserve = 0.001 * LAMPORTS_PER_SOL;
    const total = Math.max(0, mainBal - reserve) + Math.max(0, miladyBal - reserve) - 5000 * needsFunding.length * 2;
    const perAgent = Math.floor(total / needsFunding.length);
    console.log("\nPer agent: " + (perAgent/LAMPORTS_PER_SOL).toFixed(6) + " SOL (" + needsFunding.length + " to fund)\n");

    let funded = 0;
    if (miladyKp && miladyBal > reserve) {
      funded = await sendFrom(conn, miladyKp, needsFunding, perAgent, "milady");
    }
    if (funded < needsFunding.length) {
      await sendFrom(conn, mainKp, needsFunding.slice(funded), perAgent, "main");
    }
  }

  console.log("\n--- Final ---");
  console.log("main:   " + ((await conn.getBalance(mainKp.publicKey))/LAMPORTS_PER_SOL) + " SOL");
  if (miladyKp) console.log("milady: " + ((await conn.getBalance(miladyKp.publicKey))/LAMPORTS_PER_SOL) + " SOL");
  for (let i = 0; i < pubkeys.length; i++) {
    const b = await conn.getBalance(new PublicKey(pubkeys[i]));
    console.log("agent" + (i+1) + ": " + (b/LAMPORTS_PER_SOL) + " SOL");
  }
}
main().catch(e => { console.error(e); process.exit(1); });
'

# ━━━ Step 3: Create Profiles ━━━
info ""
info "━━━ [3/3] Creating profiles ━━━"
info ""

PLUGIN_SRC="$HOME/.openclaw/extensions/clawbal"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for i in $(seq 1 $AGENT_COUNT); do
  IDX=$((i - 1))
  PROFILE_NAME="crime${i}"
  PROFILE_DIR="$HOME/.openclaw-${PROFILE_NAME}"
  KP_FILE="$KEYPAIR_DIR/agent${i}.json"
  KP_CONTENTS=$(cat "$KP_FILE")
  PORT=$((BASE_PORT + i))
  AGENT_NAME="${AGENT_NAMES[$IDX]}"
  AGENT_VIBE="${AGENT_VIBES[$IDX]}"
  AGENT_PFP="${AGENT_PFPS[$IDX]}"
  CRON_MIN="${CRON_INTERVALS[$IDX]}"
  GW_TOKEN=$(openssl rand -hex 8 2>/dev/null || printf "tok-%s-%d" "$(date +%s)" "$i")

  mkdir -p "$PROFILE_DIR/extensions/clawbal"
  mkdir -p "$PROFILE_DIR/workspace/skills"
  mkdir -p "$PROFILE_DIR/cron"

  # Plugin 복사 (없을 때만)
  if [ ! -f "$PROFILE_DIR/extensions/clawbal/index.ts" ]; then
    if [ -d "$PLUGIN_SRC" ] && [ -f "$PLUGIN_SRC/index.ts" ]; then
      cp -r "$PLUGIN_SRC"/. "$PROFILE_DIR/extensions/clawbal/"
    else
      cp -r "$SCRIPT_DIR"/. "$PROFILE_DIR/extensions/clawbal/"
      (cd "$PROFILE_DIR/extensions/clawbal" && npm install 2>/dev/null) || true
    fi
  fi

  # Config
  CFG_KP="$KP_CONTENTS" CFG_NAME="$AGENT_NAME" CFG_PORT="$PORT" CFG_TOKEN="$GW_TOKEN" CFG_PFP="$AGENT_PFP" node -e '
const fs = require("fs");
const config = {
  env: { OPENROUTER_API_KEY: "'"$OPENROUTER_KEY"'" },
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
          profilePicture: process.env.CFG_PFP,
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

  # IDENTITY.md
  cat > "$PROFILE_DIR/workspace/IDENTITY.md" <<IDEOF
- Name: ${AGENT_NAME}
- Creature: ai crime token degen agent
- Vibe: ${AGENT_VIBE}
IDEOF

  # SOUL.md
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

  # Shared files
  for f in TOOLS.md AGENTS.md HEARTBEAT.md; do
    [ -f "$PLUGIN_SRC/examples/$f" ] && cp "$PLUGIN_SRC/examples/$f" "$PROFILE_DIR/workspace/$f" 2>/dev/null || true
  done
  [ -d "$PLUGIN_SRC/examples/skills" ] && cp -r "$PLUGIN_SRC/examples/skills"/* "$PROFILE_DIR/workspace/skills/" 2>/dev/null || true

  # Cron job (에이전트별 다른 간격)
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

  ok "crime${i}: ${AGENT_NAME} | port ${PORT} | cron */${CRON_MIN}m | pfp set"
done

echo ""
info "━━━ Setup Complete ━━━"
info ""
info "  Agents created in ~/.openclaw-crime{1..5}/"
info "  Keypairs saved in ~/.clawbal-agents/agent{1..5}.json"
info "  These wallets will be reused on every run."
info ""
info "  Next: bash start-agents.sh"
echo ""
