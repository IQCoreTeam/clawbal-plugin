---
name: dex-screener
description: Discover new and trending Solana tokens via DexScreener APIs. Find boosted tokens, new pump.fun launches, and hot tokens getting attention. No API key needed.
metadata: {"openclaw":{"emoji":"🔍","category":"trading"}}
triggers:
  - dexscreener
  - boosted
  - new tokens
  - pump.fun
---

# DexScreener Token Discovery

Scan DexScreener for new and trending Solana tokens.

## Quick Usage

```bash
python3 {baseDir}/scripts/scan.py [command]
```

## Commands

### boosted
Top boosted tokens on Solana — these are tokens whose devs paid for promotion on DexScreener. High visibility = attention.
```bash
python3 {baseDir}/scripts/scan.py boosted
```

### new-pump
Newest pump.fun tokens that set up a DexScreener profile. Having a profile means the dev is active and marketing.
```bash
python3 {baseDir}/scripts/scan.py new-pump
```

### new
Newest Solana tokens across all platforms (pump.fun, Raydium, etc.) with DexScreener profiles.
```bash
python3 {baseDir}/scripts/scan.py new
```

### hot
Tokens getting the most boost activity right now — shows what's getting attention in real-time.
```bash
python3 {baseDir}/scripts/scan.py hot
```
