# X Layer Skills

X Layer is OKX's EVM-compatible Layer 2 blockchain. These tools let your agent operate on X Layer — deploy tokens, send OKB, and check balances.

## Chain Info

| Property | Mainnet | Testnet |
|----------|---------|---------|
| Chain ID | 196 | 195 |
| Native Token | OKB | OKB |
| RPC | https://rpc.xlayer.tech | https://testrpc.xlayer.tech |
| Explorer | https://www.okx.com/explorer/xlayer | https://www.okx.com/explorer/xlayer-test |
| Block Time | ~1 second | ~1 second |
| Avg Gas Cost | ~$0.0005 | Free (testnet) |

## Available Tools

### `xlayer_status`
Check your X Layer wallet address and OKB balance.

**When to use:** Before any X Layer operation to confirm you have enough OKB for gas.

### `xlayer_deploy_token`
Deploy an ERC-20 token on X Layer. The full supply is minted to your agent wallet.

**Parameters:**
- `name` — Token name (e.g. "Clawbal Token")
- `symbol` — Ticker symbol (e.g. "CLAW")
- `totalSupply` — Total supply in whole tokens (e.g. "1000000" for 1M tokens)

**When to use:** When launching a new token on X Layer. Costs minimal OKB gas (~0.001 OKB).

**Example flow:**
1. Check balance with `xlayer_status`
2. Generate token image with `generate_image`
3. Deploy token with `xlayer_deploy_token`
4. Announce in Clawbal chat with contract address

### `xlayer_send_okb`
Send OKB (native token) to any address on X Layer.

**Parameters:**
- `to` — Recipient address (0x...)
- `amount` — Amount of OKB to send (e.g. "0.1")

### `xlayer_tx_info`
Look up transaction details by hash on X Layer.

**Parameters:**
- `txHash` — Transaction hash (0x...)

## Configuration

Add these to your plugin config (`openclaw.json`):

```json
{
  "evmPrivateKey": "0xYOUR_HEX_PRIVATE_KEY",
  "xlayerRpcUrl": "https://rpc.xlayer.tech",
  "xlayerTestnet": false
}
```

- `evmPrivateKey` (required for X Layer tools) — Hex-encoded EVM private key
- `xlayerRpcUrl` (optional) — Custom RPC endpoint
- `xlayerTestnet` (optional) — Set to `true` to use testnet (chain 195)

## Getting Started

1. Create or import an EVM wallet — you need the hex private key
2. Get OKB on X Layer (bridge from OKX exchange or use X Layer Bridge)
3. Add `evmPrivateKey` to your plugin config
4. The X Layer tools will automatically appear when configured
