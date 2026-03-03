#!/usr/bin/env python3
"""Solana token discovery — CoinGecko + Raydium. Zero dependencies, stdlib only."""
import json, sys, urllib.request, urllib.parse

HEADERS = {"User-Agent": "ClawbalAgent/1.0", "Accept": "application/json"}

def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())

def fmt_num(n):
    if n is None or n == 0: return "?"
    n = float(n)
    if n >= 1e9: return f"${n/1e9:.1f}B"
    if n >= 1e6: return f"${n/1e6:.1f}M"
    if n >= 1e3: return f"${n/1e3:.1f}K"
    return f"${n:.2f}"

def cmd_trending():
    """Top Solana-native tokens by 24h volume via CoinGecko."""
    data = fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=solana-meme-coins&order=volume_desc&per_page=30&sparkline=false")
    # Also grab pump-fun category
    try:
        data2 = fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=pump-fun&order=volume_desc&per_page=20&sparkline=false")
        seen_ids = {t["id"] for t in data}
        data.extend([t for t in data2 if t["id"] not in seen_ids])
    except Exception:
        pass
    # Filter out stablecoins, wrapped assets, and non-Solana-native tokens
    skip = {"usdt", "usdc", "usds", "pyusd", "usde", "usd1", "wbtc", "cbbtc",
            "weth", "wsol", "sol", "link", "uni", "aave", "mkr", "snx", "crv",
            "matic", "avax", "bnb", "dot", "atom", "near", "apt", "sui", "arb",
            "op", "eth", "btc", "wlfi", "hbar", "tao", "morpho"}
    tokens = [t for t in data if t.get("symbol","").lower() not in skip][:12]

    print(f"📊 Top Solana Tokens by Volume\n")
    for i, t in enumerate(tokens, 1):
        name = t.get("name", "?")
        sym = t.get("symbol", "?").upper()
        price = t.get("current_price") or 0
        chg = t.get("price_change_percentage_24h") or 0
        mcap = t.get("market_cap") or 0
        vol = t.get("total_volume") or 0
        emoji = "🟢" if chg > 0 else "🔴"
        print(f"{i}. {name} ({sym})")
        print(f"   Price: ${price:,.6f}  24h: {emoji}{chg:+.1f}%")
        print(f"   MCap: {fmt_num(mcap)}  Vol: {fmt_num(vol)}")
        print()

def cmd_gainers():
    """Top Solana-native gainers in last 24h."""
    data = fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=solana-meme-coins&order=market_cap_desc&per_page=100&sparkline=false")
    skip = {"usdt", "usdc", "usds", "pyusd", "usde", "usd1", "wbtc", "cbbtc",
            "weth", "wsol", "sol", "link", "wlfi"}
    tokens = [t for t in data if t.get("symbol","").lower() not in skip and t.get("price_change_percentage_24h") is not None]
    tokens.sort(key=lambda t: t.get("price_change_percentage_24h") or 0, reverse=True)
    tokens = tokens[:12]

    print(f"🚀 Top Solana Gainers (24h)\n")
    for i, t in enumerate(tokens, 1):
        name = t.get("name", "?")
        sym = t.get("symbol", "?").upper()
        price = t.get("current_price") or 0
        chg = t.get("price_change_percentage_24h") or 0
        mcap = t.get("market_cap") or 0
        vol = t.get("total_volume") or 0
        print(f"{i}. {name} ({sym}) — 🟢{chg:+.1f}%")
        print(f"   Price: ${price:,.6f}  MCap: {fmt_num(mcap)}  Vol: {fmt_num(vol)}")
        print()

def cmd_hot():
    """What people are searching for right now (CoinGecko trending)."""
    data = fetch("https://api.coingecko.com/api/v3/search/trending")
    coins = data.get("coins", [])[:15]

    print(f"🔥 Trending Coins Right Now\n")
    for i, c in enumerate(coins, 1):
        item = c["item"]
        name = item.get("name", "?")
        sym = item.get("symbol", "?")
        rank = item.get("market_cap_rank", "?")
        d = item.get("data", {})
        price = d.get("price", "?")
        chg = d.get("price_change_percentage_24h", {}).get("usd")
        chg_str = f" ({chg:+.1f}%)" if chg else ""
        # Check Solana platform
        platforms = item.get("platforms", {})
        is_sol = "solana" in platforms or any("solana" in str(v).lower() for v in platforms.values())
        sol_tag = " [SOL]" if is_sol else ""
        print(f"{i}. {name} ({sym}){sol_tag}{chg_str}")
        if isinstance(price, (int, float)):
            print(f"   Price: ${price:.6f}  Rank: #{rank}")
        else:
            print(f"   Price: {price}  Rank: #{rank}")
        if is_sol and "solana" in platforms:
            print(f"   CA: {platforms['solana']}")
        print()

def cmd_search(query):
    """Search for a Solana token by name or symbol."""
    data = fetch(f"https://api.coingecko.com/api/v3/search?query={urllib.parse.quote(query)}")
    coins = data.get("coins", [])[:15]

    # Filter to Solana-related
    print(f"🔍 Search: '{query}'\n")
    for i, c in enumerate(coins, 1):
        name = c.get("name", "?")
        sym = c.get("symbol", "?")
        rank = c.get("market_cap_rank", "?")
        print(f"{i}. {name} ({sym}) — Rank: #{rank}")

    if not coins:
        print("No results found.")

def cmd_pools():
    """Latest Raydium pools with highest TVL — find where liquidity is going."""
    data = fetch("https://api.raydium.io/v2/ammV3/ammPools")
    pools = data.get("data", [])
    # Sort by TVL descending, filter minimum $10K
    pools = [p for p in pools if float(p.get("tvl", 0) or 0) > 10000]
    pools.sort(key=lambda p: float(p.get("tvl", 0) or 0), reverse=True)
    pools = pools[:15]

    print(f"💧 Top Raydium Pools by TVL\n")
    for i, p in enumerate(pools, 1):
        pool_id = p.get("id", "?")[:16]
        tvl = float(p.get("tvl", 0) or 0)
        mint_a = p.get("mintA", "?")
        mint_b = p.get("mintB", "?")
        sym_a = mint_a.get("symbol") or mint_a.get("address", "?")[:8] if isinstance(mint_a, dict) else str(mint_a)[:8]
        sym_b = mint_b.get("symbol") or mint_b.get("address", "?")[:8] if isinstance(mint_b, dict) else str(mint_b)[:8]
        day = p.get("day") or {}
        vol = float(day.get("volume", 0) if isinstance(day, dict) else 0)
        print(f"{i}. {sym_a}/{sym_b}")
        print(f"   TVL: {fmt_num(tvl)}  24h Vol: {fmt_num(vol)}")
        print(f"   Pool: {pool_id}...")
        print()

if __name__ == "__main__":
    args = sys.argv[1:]
    cmd = args[0] if args else "trending"

    if cmd == "trending":
        cmd_trending()
    elif cmd == "gainers":
        cmd_gainers()
    elif cmd == "hot":
        cmd_hot()
    elif cmd == "pools":
        cmd_pools()
    elif cmd == "search" and len(args) > 1:
        cmd_search(" ".join(args[1:]))
    else:
        print("Usage: trending.py [trending|gainers|hot|pools|search <query>]")
        print()
        print("  trending  — Top Solana tokens by 24h volume")
        print("  gainers   — Biggest Solana gainers (24h)")
        print("  hot       — What people are searching for right now")
        print("  pools     — Top Raydium pools by TVL")
        print("  search    — Search for a token by name/symbol")
