---
name: dex-trending
description: Discover trending Solana memecoins via CoinGecko + Raydium APIs. Find top gainers, trending tokens, new pools, and search by name. No API key needed.
metadata: {"openclaw":{"emoji":"📈","category":"trading"}}
---

# Solana Token Discovery

Find what's moving on Solana right now using CoinGecko + Raydium public APIs. No API keys needed. Zero dependencies (Python stdlib only).

## Quick Usage

```bash
# Top Solana memecoins by 24h volume (default)
python3 {baseDir}/scripts/trending.py trending

# Biggest Solana gainers in 24h
python3 {baseDir}/scripts/trending.py gainers

# What's trending on CoinGecko right now (all chains, tags Solana tokens)
python3 {baseDir}/scripts/trending.py hot

# Top Raydium pools by TVL
python3 {baseDir}/scripts/trending.py pools

# Search for a specific token
python3 {baseDir}/scripts/trending.py search BONK
```

## Commands

### trending (Default)
Top Solana-native memecoins by 24h trading volume. Pulls from CoinGecko `solana-meme-coins` + `pump-fun` categories. Filters out stablecoins, wrapped assets, and non-Solana tokens.

```bash
python3 {baseDir}/scripts/trending.py trending
```

### gainers
Biggest 24h price gainers among Solana memecoins. Sorted by percentage change.

```bash
python3 {baseDir}/scripts/trending.py gainers
```

### hot
What people are searching for right now on CoinGecko. Shows all chains but tags Solana tokens with `[SOL]` and shows their contract address (CA).

```bash
python3 {baseDir}/scripts/trending.py hot
```

### pools
Top Raydium concentrated liquidity pools by TVL. Shows pair, TVL, and 24h volume. Good for finding where smart money is parking liquidity.

```bash
python3 {baseDir}/scripts/trending.py pools
```

### search
Look up any token by name, symbol, or contract address.

```bash
python3 {baseDir}/scripts/trending.py search POPCAT
python3 {baseDir}/scripts/trending.py search pengu
```

## Output Format

Each token shows:
- Name / Symbol
- Price + 24h change (green/red indicator)
- Market cap
- 24h volume
- Contract address (when available)

## Data Sources

| Source | What it provides | Rate Limit |
|--------|-----------------|------------|
| CoinGecko | Token markets, trending, search | 30 req/min (free, no key) |
| Raydium | Pool TVL, volume, pair data | Unlimited |

## Notes

- DexScreener API is **blocked from datacenter IPs** (403). This skill uses CoinGecko + Raydium instead.
- CoinGecko free tier is 30 requests/min — more than enough for agent use.
- All data is Solana-native. Stablecoins, wrapped assets, and multi-chain tokens are filtered out.
