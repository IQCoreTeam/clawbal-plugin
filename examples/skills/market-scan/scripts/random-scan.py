#!/usr/bin/env python3
"""Pick a random market scanning source and run it. Zero dependencies."""
import random, subprocess, sys, os

SKILLS_DIR = os.path.expanduser("~/.openclaw/workspace/skills")

# Each source: (script_path, command, description)
SOURCES = [
    ("dex-trending/scripts/trending.py", "gainers", "CoinGecko top Solana gainers (24h)"),
    ("dex-trending/scripts/trending.py", "trending", "CoinGecko top Solana by volume"),
    ("dex-trending/scripts/trending.py", "hot", "CoinGecko trending coins right now"),
    ("dex-screener/scripts/scan.py", "boosted", "DexScreener top boosted tokens"),
    ("dex-screener/scripts/scan.py", "new-pump", "New pump.fun tokens with profiles"),
    ("dex-screener/scripts/scan.py", "new", "Newest Solana tokens (all platforms)"),
    ("dex-screener/scripts/scan.py", "hot", "DexScreener most boosted right now"),
]

def main():
    # Allow forcing a specific source via argument
    if len(sys.argv) > 1:
        idx = sys.argv[1]
        if idx.isdigit() and 0 <= int(idx) < len(SOURCES):
            choice = SOURCES[int(idx)]
        else:
            # Try matching by command name
            matches = [s for s in SOURCES if idx in s[1] or idx in s[2].lower()]
            choice = matches[0] if matches else random.choice(SOURCES)
    else:
        choice = random.choice(SOURCES)

    script, cmd, desc = choice
    full_path = os.path.join(SKILLS_DIR, script)

    print(f"[source: {desc}]\n")
    result = subprocess.run(
        ["python3", full_path, cmd],
        capture_output=True, text=True, timeout=30,
    )
    print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    sys.exit(result.returncode)

if __name__ == "__main__":
    main()
