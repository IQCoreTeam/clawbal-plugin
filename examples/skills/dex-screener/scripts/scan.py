#!/usr/bin/env python3
"""DexScreener token discovery — boosted, new pump.fun, trending profiles. Zero dependencies."""
import json, sys, urllib.request, time

HEADERS = {"User-Agent": "ClawbalAgent/1.0", "Accept": "application/json"}
DS_BASE = "https://api.dexscreener.com"


def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def fmt_num(n):
    if n is None or n == 0:
        return "?"
    n = float(n)
    if n >= 1e9:
        return f"${n/1e9:.1f}B"
    if n >= 1e6:
        return f"${n/1e6:.1f}M"
    if n >= 1e3:
        return f"${n/1e3:.1f}K"
    return f"${n:.2f}"


def age_str(created_at_ms):
    if not created_at_ms:
        return "?"
    diff = time.time() - created_at_ms / 1000
    if diff < 3600:
        return f"{int(diff/60)}m"
    if diff < 86400:
        return f"{int(diff/3600)}h"
    return f"{int(diff/86400)}d"


def get_pair_data(addresses):
    """Fetch pair data for up to 30 token addresses (DexScreener batch endpoint)."""
    if not addresses:
        return []
    # DexScreener allows comma-separated addresses
    batch = ",".join(addresses[:30])
    try:
        data = fetch(f"{DS_BASE}/tokens/v1/solana/{batch}")
        return data if isinstance(data, list) else []
    except Exception:
        return []


def print_token(i, p):
    bt = p.get("baseToken", {})
    name = bt.get("name", "?")
    sym = bt.get("symbol", "?")
    ca = bt.get("address", "?")
    price = p.get("priceUsd", "?")
    mcap = p.get("marketCap") or p.get("fdv") or 0
    liq = (p.get("liquidity") or {}).get("usd", 0)
    vol = (p.get("volume") or {}).get("h24", 0)
    chg_h1 = (p.get("priceChange") or {}).get("h1") or 0
    chg_24h = (p.get("priceChange") or {}).get("h24") or 0
    txns = p.get("txns", {})
    buys_h1 = (txns.get("h1") or {}).get("buys", 0)
    sells_h1 = (txns.get("h1") or {}).get("sells", 0)
    age = age_str(p.get("pairCreatedAt"))
    dex = p.get("dexId", "?")
    emoji = "\u2191" if chg_h1 and chg_h1 > 0 else "\u2193"

    print(f"{i}. {name} ({sym}) — {age} old")
    print(f"   Price: ${price}  MCap: {fmt_num(mcap)}  Liq: {fmt_num(liq)}")
    print(f"   Vol24h: {fmt_num(vol)}  1h: {emoji}{chg_h1:+.1f}%  24h: {chg_24h:+.1f}%")
    print(f"   Buys/Sells 1h: {buys_h1}/{sells_h1}  DEX: {dex}")
    print(f"   CA: {ca}")
    print()


def cmd_boosted():
    """Top boosted tokens on Solana — paid promotion = attention."""
    data = fetch(f"{DS_BASE}/token-boosts/top/v1")
    sol_tokens = [t for t in data if t.get("chainId") == "solana"]
    addresses = [t["tokenAddress"] for t in sol_tokens[:15]]
    pairs = get_pair_data(addresses)

    # Dedupe by base token address, keep first (highest liq)
    seen = set()
    unique = []
    for p in pairs:
        ca = p.get("baseToken", {}).get("address")
        if ca and ca not in seen:
            seen.add(ca)
            unique.append(p)

    # Sort by volume
    unique.sort(key=lambda p: (p.get("volume") or {}).get("h24", 0), reverse=True)
    unique = unique[:10]

    print("DexScreener Top Boosted (Solana)\n")
    for i, p in enumerate(unique, 1):
        print_token(i, p)


def cmd_new_pump():
    """Newest pump.fun tokens that got a DexScreener profile (= dev is active)."""
    data = fetch(f"{DS_BASE}/token-profiles/latest/v1")
    pump_tokens = [t for t in data if t.get("chainId") == "solana" and "pump" in t.get("tokenAddress", "")]
    addresses = [t["tokenAddress"] for t in pump_tokens[:15]]
    pairs = get_pair_data(addresses)

    # Dedupe
    seen = set()
    unique = []
    for p in pairs:
        ca = p.get("baseToken", {}).get("address")
        if ca and ca not in seen:
            seen.add(ca)
            unique.append(p)

    # Filter: must have some liquidity and volume
    filtered = [p for p in unique if (p.get("liquidity") or {}).get("usd", 0) > 500]
    # Sort by age (newest first)
    filtered.sort(key=lambda p: p.get("pairCreatedAt", 0), reverse=True)
    filtered = filtered[:10]

    print("New Pump.fun Tokens (with DexScreener profiles)\n")
    for i, p in enumerate(filtered, 1):
        print_token(i, p)


def cmd_new_all():
    """Newest Solana tokens across all platforms that got a DexScreener profile."""
    data = fetch(f"{DS_BASE}/token-profiles/latest/v1")
    sol_tokens = [t for t in data if t.get("chainId") == "solana"]
    addresses = [t["tokenAddress"] for t in sol_tokens[:20]]
    pairs = get_pair_data(addresses)

    seen = set()
    unique = []
    for p in pairs:
        ca = p.get("baseToken", {}).get("address")
        if ca and ca not in seen:
            seen.add(ca)
            unique.append(p)

    filtered = [p for p in unique if (p.get("liquidity") or {}).get("usd", 0) > 500]
    filtered.sort(key=lambda p: p.get("pairCreatedAt", 0), reverse=True)
    filtered = filtered[:10]

    print("Newest Solana Tokens (all platforms)\n")
    for i, p in enumerate(filtered, 1):
        print_token(i, p)


def cmd_hot():
    """Tokens getting the most boost activity right now."""
    data = fetch(f"{DS_BASE}/token-boosts/latest/v1")
    sol_tokens = [t for t in data if t.get("chainId") == "solana"]
    # Count boosts per token
    boost_count = {}
    for t in sol_tokens:
        addr = t["tokenAddress"]
        boost_count[addr] = boost_count.get(addr, 0) + 1

    # Get top boosted addresses
    top_addrs = sorted(boost_count, key=boost_count.get, reverse=True)[:15]
    pairs = get_pair_data(top_addrs)

    seen = set()
    unique = []
    for p in pairs:
        ca = p.get("baseToken", {}).get("address")
        if ca and ca not in seen:
            seen.add(ca)
            unique.append(p)
    unique = unique[:10]

    print("Hottest Boosted Tokens Right Now (Solana)\n")
    for i, p in enumerate(unique, 1):
        print_token(i, p)


if __name__ == "__main__":
    args = sys.argv[1:]
    cmd = args[0] if args else "boosted"

    if cmd == "boosted":
        cmd_boosted()
    elif cmd == "new-pump":
        cmd_new_pump()
    elif cmd == "new":
        cmd_new_all()
    elif cmd == "hot":
        cmd_hot()
    else:
        print("Usage: scan.py [boosted|new-pump|new|hot]")
        print()
        print("  boosted   — Top boosted tokens on Solana (paid promo)")
        print("  new-pump  — Newest pump.fun tokens with DexScreener profiles")
        print("  new       — Newest Solana tokens across all platforms")
        print("  hot       — Tokens getting the most boost activity right now")
