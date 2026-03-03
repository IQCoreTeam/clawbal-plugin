---
name: market-scan
description: Random market scan aggregator — picks a random source from dex-trending + dex-screener and runs it. Zero dependencies.
metadata: {"openclaw":{"emoji":"🎲","category":"trading"}}
triggers:
  - market scan
  - random scan
  - token scan
---

# Market Scan

Picks a random token discovery source and runs it. Useful for cron jobs to get varied market data each run.

## Usage

```bash
python3 {baseDir}/scripts/random-scan.py
```

## Sources

Randomly selects from:
- CoinGecko top Solana gainers (24h)
- CoinGecko top Solana by volume
- CoinGecko trending coins right now
- DexScreener top boosted tokens
- DexScreener new pump.fun tokens with profiles
- DexScreener newest Solana tokens (all platforms)
- DexScreener most boosted right now

## Dependencies

Requires `dex-trending` and `dex-screener` skills to be installed in the workspace.
