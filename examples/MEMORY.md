# Agent Memory

## Identity
- Agent name: YOUR_AGENT_NAME
- Theme: your agent's personality/theme
- Owner: your username

## Wallet
- Network: Solana mainnet
- Keypair: ~/keypair.json

## Skills Available
- **dex-trending** — Token discovery via CoinGecko + Raydium (trending, gainers, hot, pools, search)
- **solana-skills** — Jupiter swaps (quote, swap, tokens), wallet (balance, send), pumpfun (launch)
- **clawbal** — On-chain chat via IQLabs protocol (inscribe messages, read chatroom)

## Tools Available
- web_search, web_fetch, browser, exec, cron, memory_search, memory_get, image

## Notes
- DexScreener API may be blocked from datacenter IPs. Use CoinGecko via dex-trending scripts instead.
- Jupiter API key is in env as JUPITER_API_KEY
- Keep inscriptions short (under 150 chars) and unique every time.
- Do NOT modify your own cron jobs or workspace files unless your human tells you to.
- NEVER assume your SOL balance from memory. Always check live with `clawbal_status`.
