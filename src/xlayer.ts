/**
 * X Layer (OKX L2) integration — EVM wallet, ERC-20 token deployment, balance checks.
 *
 * X Layer is an EVM-compatible L2 by OKX with native token OKB.
 * Chain ID: 196 (mainnet), 195 (testnet)
 * RPC: https://rpc.xlayer.tech (mainnet), https://testrpc.xlayer.tech (testnet)
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  formatEther,
  parseEther,
  type Chain,
  type PublicClient,
  type WalletClient,
  type Hash,
  type Address,
  encodeDeployData,
  getContractAddress,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

// ─── X Layer chain definitions ───

export const xlayerMainnet: Chain = {
  id: 196,
  name: "X Layer Mainnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.xlayer.tech"] },
  },
  blockExplorers: {
    default: { name: "OKX Explorer", url: "https://www.okx.com/explorer/xlayer" },
  },
};

export const xlayerTestnet: Chain = {
  id: 195,
  name: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testrpc.xlayer.tech"] },
  },
  blockExplorers: {
    default: { name: "OKX Explorer", url: "https://www.okx.com/explorer/xlayer-test" },
  },
};

// ─── Minimal ERC-20 contract (OpenZeppelin-style) ───
// Constructor: (string name, string symbol, uint256 initialSupply)
// Mints initialSupply to msg.sender

const ERC20_ABI = [
  {
    type: "constructor",
    inputs: [
      { name: "name_", type: "string" },
      { name: "symbol_", type: "string" },
      { name: "initialSupply", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalSupply",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transferFrom",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "spender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

// Compiled bytecode for a minimal ERC-20 token
// Solidity source (0.8.x, MIT):
//   contract SimpleToken is ERC20 {
//     constructor(string memory name_, string memory symbol_, uint256 initialSupply)
//       ERC20(name_, symbol_) { _mint(msg.sender, initialSupply); }
//   }
// Compiled with solc 0.8.24 optimizer 200 runs
const ERC20_BYTECODE =
  "0x60806040523480156200001157600080fd5b5060405162000c4538038062000c45833981016040819052620000349162000209565b8251839083906200004d906003906020860190620000a0565b50805162000063906004906020840190620000a0565b50505062000078338262000081565b505050620002e5565b6001600160a01b038216620000dc5760405162461bcd60e51b815260206004820152601f60248201527f45524332303a206d696e7420746f20746865207a65726f206164647265737300604482015260640160405180910390fd5b8060026000828254620000f09190620002a0565b90915550506001600160a01b038216600090815260208190526040812080548392906200011f908490620002a0565b90915550506040518181526001600160a01b038316906000907fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef9060200160405180910390a35050565b505050565b634e487b7160e01b600052604160045260246000fd5b600082601f8301126200019757600080fd5b81516001600160401b0380821115620001b457620001b46200016f565b604051601f8301601f19908116603f01168101908282118183101715620001df57620001df6200016f565b81604052838152602092508683858801011115620001fc57600080fd5b600091505b838210156200022057858201830151818301840152908201906200020157565b83821115620002325760008385830101525b9695505050505050565b80516001600160401b03811681146200025457600080fd5b919050565b6000806000606084860312156200026f57600080fd5b83516001600160401b03808211156200028757600080fd5b620002958783880162000185565b94506020860151915080821115620002ac57600080fd5b50620002bb8682870162000185565b925050620002cc604085016200023c565b90509250925092565b634e487b7160e01b600052601160045260246000fd5b60008219821115620002e257620002e2620002c0565b500190565b61095080620002f76000396000f3fe608060405234801561001057600080fd5b50600436106100a95760003560e01c80633950935111610071578063395093511461012957806370a082311461013c57806395d89b4114610165578063a457c2d71461016d578063a9059cbb14610180578063dd62ed3e1461019357600080fd5b806306fdde03146100ae578063095ea7b3146100cc57806318160ddd146100ef57806323b872dd14610101578063313ce56714610114575b600080fd5b6100b66101cc565b6040516100c391906107ae565b60405180910390f35b6100df6100da36600461081f565b61025e565b60405190151581526020016100c3565b6002545b6040519081526020016100c3565b6100df61010f366004610849565b610276565b60405160128152602001610c3565b6100df61013736600461081f565b61029a565b6100f361014a366004610885565b6001600160a01b031660009081526020819052604090205490565b6100b66102bc565b6100df61017b36600461081f565b6102cb565b6100df61018e36600461081f565b61034b565b6100f36101a13660046108a7565b6001600160a01b03918216600090815260016020908152604080832093909416825291909152205490565b6060600380546101db906108da565b80601f0160208091040260200160405190810160405280929190818152602001828054610207906108da565b80156102545780601f1061022957610100808354040283529160200191610254565b820191906000526020600020905b81548152906001019060200180831161023757829003601f168201915b5050505050905090565b60003361026c818585610359565b5060019392505050565b60003361028485828561047d565b61028f8585856104f7565b506001949350505050565b60003361026c8185856102ad83836101a1565b6102b79190610914565b610359565b6060600480546101db906108da565b600033816102d982866101a1565b90508381101561033e5760405162461bcd60e51b815260206004820152602560248201527f45524332303a2064656372656173656420616c6c6f77616e63652062656c6f77604482015264207a65726f60d81b60648201526084015b60405180910390fd5b61028f8286868403610359565b60003361026c8185856104f7565b6001600160a01b0383166103bb5760405162461bcd60e51b8152602060048201526024808201527f45524332303a20617070726f76652066726f6d20746865207a65726f206164646044820152637265737360e01b6064820152608401610335565b6001600160a01b03821661041c5760405162461bcd60e51b815260206004820152602260248201527f45524332303a20617070726f766520746f20746865207a65726f206164647265604482015261737360f01b6064820152608401610335565b6001600160a01b0383811660008181526001602090815260408083209487168084529482529182902085905590518481527f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925910160405180910390a3505050565b600061048984846101a1565b905060001981146104f157818110156104e45760405162461bcd60e51b815260206004820152601d60248201527f45524332303a20696e73756666696369656e7420616c6c6f77616e63650000006044820152606401610335565b6104f18484848403610359565b50505050565b6001600160a01b03831661055b5760405162461bcd60e51b815260206004820152602560248201527f45524332303a207472616e736665722066726f6d20746865207a65726f206164604482015264647265737360d81b6064820152608401610335565b6001600160a01b0382166105bd5760405162461bcd60e51b815260206004820152602360248201527f45524332303a207472616e7366657220746f20746865207a65726f206164647260448201526265737360e81b6064820152608401610335565b6001600160a01b038316600090815260208190526040902054818110156106355760405162461bcd60e51b815260206004820152602660248201527f45524332303a207472616e7366657220616d6f756e7420657863656564732062604482015265616c616e636560d01b6064820152608401610335565b6001600160a01b038085166000908152602081905260408082208585039055918516815290812080548492906106689084905b8082111561067557600081556001016106a0565b5090565b90505b8060005260206000200160005b838110156106b157815481890152600182019150602081019050610689565b505050505050565b600181811c908216806106cd57604052565b602080106106dc575081810390505b50919050565b600181815b808511156107335781600019048211156107195761071961092c565b8085161561072657918102915b93841c93908002906106e7565b509250929050565b6000826107a557506001610908565b816107b257506000610908565b81600181146107c857600281146107d257610905565b6001915050610908565b60ff8411156107e3576107e361092c565b50506001821b610908565b5060208310610133831016604e8410600b841016171561080e575081810a610908565b61081883836106e2565b905061090e565b600061083282846108a7565b60008061083f8585610914565b9695505050505050565b60008060006060848603121561085e57600080fd5b833561086981610942565b9250602084013561087981610942565b929592945050506040919091013590565b60006020828403121561089757600080fd5b81356108a281610942565b9392505050565b600080604083850312156108ba57600080fd5b82356108c581610942565b946020939093013593505050565b600181811c908216806108ee57607f821691505b6020821081036108da57634e487b7160e01b600052602260045260246000fd5b634e487b7160e01b600052601160045260246000fdfea164736f6c6343000818001a" as `0x${string}`;

// ─── X Layer context ───

export interface XLayerContext {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: PrivateKeyAccount;
  chain: Chain;
}

/**
 * Initialize X Layer connection from a hex private key.
 */
export function initXLayer(privateKey: string, rpcUrl?: string, testnet?: boolean): XLayerContext {
  const chain = testnet ? xlayerTestnet : xlayerMainnet;

  // Ensure 0x prefix
  const key = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`;
  const account = privateKeyToAccount(key);

  const transport = http(rpcUrl || chain.rpcUrls.default.http[0]);

  const publicClient = createPublicClient({ chain, transport }) as PublicClient;
  const walletClient = createWalletClient({ chain, transport, account });

  return { publicClient, walletClient, account, chain };
}

// ─── Balance ───

export async function getXLayerBalance(ctx: XLayerContext): Promise<string> {
  const balance = await ctx.publicClient.getBalance({ address: ctx.account.address });
  return formatEther(balance);
}

// ─── Deploy ERC-20 Token ───

export interface DeployTokenParams {
  name: string;
  symbol: string;
  totalSupply: string; // in whole tokens, e.g. "1000000"
}

export interface DeployTokenResult {
  txHash: Hash;
  contractAddress: Address;
  name: string;
  symbol: string;
  totalSupply: string;
}

export async function deployERC20(ctx: XLayerContext, params: DeployTokenParams): Promise<DeployTokenResult> {
  const supplyWei = parseEther(params.totalSupply);

  const deployData = encodeDeployData({
    abi: ERC20_ABI,
    bytecode: ERC20_BYTECODE,
    args: [params.name, params.symbol, supplyWei],
  });

  // Get nonce for contract address prediction
  const nonce = await ctx.publicClient.getTransactionCount({ address: ctx.account.address });

  const txHash = await ctx.walletClient.sendTransaction({
    data: deployData,
    chain: ctx.chain,
    account: ctx.account,
  });

  // Predict contract address from deployer + nonce
  const contractAddress = getContractAddress({
    from: ctx.account.address,
    nonce: BigInt(nonce),
  });

  // Wait for confirmation
  await ctx.publicClient.waitForTransactionReceipt({ hash: txHash });

  return {
    txHash,
    contractAddress,
    name: params.name,
    symbol: params.symbol,
    totalSupply: params.totalSupply,
  };
}

// ─── Send OKB (native transfer) ───

export async function sendOKB(
  ctx: XLayerContext,
  to: Address,
  amount: string, // in OKB, e.g. "0.1"
): Promise<Hash> {
  const txHash = await ctx.walletClient.sendTransaction({
    to,
    value: parseEther(amount),
    chain: ctx.chain,
    account: ctx.account,
  });

  await ctx.publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

// ─── Get transaction info ───

export async function getTxInfo(ctx: XLayerContext, txHash: Hash) {
  const receipt = await ctx.publicClient.getTransactionReceipt({ hash: txHash });
  return {
    status: receipt.status,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    from: receipt.from,
    to: receipt.to,
    contractAddress: receipt.contractAddress,
  };
}
