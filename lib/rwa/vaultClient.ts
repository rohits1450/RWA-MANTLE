// Built by vsrupeshkumar
// viem-based read/write client for the RWAkinsRWAVault on Mantle Sepolia.
// Reads go over a public HTTP RPC; writes go through the user's injected wallet
// (the hub's raw EIP-1193 provider), matching the rest of the hub's on-chain layer.
'use client'

import {
  createPublicClient, createWalletClient, custom,
  parseEther, formatEther, type Address,
} from 'viem'
import { getEvmProvider } from '@/lib/wallet-providers'
import { VAULT_ABI, RWA_TOKEN_ABI } from './abi'
import deployed from '@/lib/rwa-deployed.json'
import { mantleSepolia, mantleTransport } from './rpc'

export { mantleSepolia }

export const MANTLE_SEPOLIA_CHAIN_ID = 5003
export const MAX_RISK_BPS = 7000

export const RWA = {
  usdy: (deployed.usdy || '') as Address,
  meth: (deployed.meth || '') as Address,
  vault: (deployed.vault || '') as Address,
}

/** True once deploy-rwa.ts has written real addresses into rwa-deployed.json. */
export const isVaultDeployed =
  typeof deployed.vault === 'string' && deployed.vault.length === 42

export const explorerTx = (hash: string) => `https://sepolia.mantlescan.xyz/tx/${hash}`
export const explorerAddr = (addr: string) => `https://sepolia.mantlescan.xyz/address/${addr}`

const publicClient = createPublicClient({ chain: mantleSepolia, transport: mantleTransport() })

function getWalletClient() {
  const eth = getEvmProvider('MetaMask')
  if (!eth) throw new Error('No EVM wallet detected. Install MetaMask and reload.')
  return createWalletClient({ chain: mantleSepolia, transport: custom(eth as never) })
}

/** Ask the wallet to add/switch to Mantle Sepolia. */
export async function switchToMantleSepolia(): Promise<void> {
  const eth = getEvmProvider('MetaMask')
  if (!eth) throw new Error('No EVM wallet detected.')
  await eth.request({
    method: 'wallet_addEthereumChain',
    params: [{
      chainId: '0x138b', // 5003
      chainName: 'Mantle Sepolia',
      rpcUrls: ['https://rpc.sepolia.mantle.xyz'],
      blockExplorerUrls: ['https://sepolia.mantlescan.xyz'],
      nativeCurrency: { name: 'Mantle', symbol: 'MNT', decimals: 18 },
    }],
  })
}

export interface Portfolio {
  usdyBal: bigint
  methBal: bigint
  usdyBps: bigint
  methBps: bigint
}

export interface VaultSnapshot {
  usdyTokens: number
  methTokens: number
  methBps: number
  usdyApyBps: number
  methApyBps: number
  methPriceUsd: number
  feeBps: number
}

/**
 * The dashboard's single reliable read: position + yields + mETH price in one
 * call to the server route (GET /api/portfolio), which runs over the resilient
 * multi-endpoint RPC. Throws on a genuine outage so the caller can show a
 * "reconnecting" state instead of fabricating a position.
 */
export async function fetchVaultSnapshot(wallet: string): Promise<VaultSnapshot> {
  const res = await fetch(`/api/portfolio?wallet=${wallet}`, { cache: 'no-store' })
  const j = (await res.json()) as Record<string, unknown>
  if (!res.ok || j.ok !== true) throw new Error(String(j.error ?? 'read failed'))
  return {
    usdyTokens: Number(formatEther(BigInt(String(j.usdyBal)))),
    methTokens: Number(formatEther(BigInt(String(j.methBal)))),
    methBps: Number(j.methBps),
    usdyApyBps: Number(j.usdyApyBps),
    methApyBps: Number(j.methApyBps),
    methPriceUsd: Number(j.methPriceUsd),
    feeBps: Number(j.feeBps ?? 0),
  }
}

export async function readPortfolio(user: Address): Promise<Portfolio> {
  const res = (await publicClient.readContract({
    address: RWA.vault,
    abi: VAULT_ABI,
    functionName: 'getPortfolio',
    args: [user],
  })) as readonly [bigint, bigint, bigint, bigint]
  return { usdyBal: res[0], methBal: res[1], usdyBps: res[2], methBps: res[3] }
}

/** Live mETH price (USD) the vault values the mETH leg at — kept in sync with the
 *  real market by the agent oracle (lib/rwa/oracleSync). USDY ≈ $1, so the on-chain
 *  methPriceE18 (mETH priced in USDY units) is the USD price. */
export async function readMethPrice(): Promise<number> {
  const e18 = (await publicClient.readContract({
    address: RWA.vault, abi: VAULT_ABI, functionName: 'methPriceE18',
  })) as bigint
  return Number(e18) / 1e18
}

/** Mock RWA yields, in basis points (480 = 4.80% APY). */
export async function readYields(): Promise<{ usdyApyBps: number; methApyBps: number }> {
  const [usdy, meth] = await Promise.all([
    publicClient.readContract({ address: RWA.usdy, abi: RWA_TOKEN_ABI, functionName: 'currentYield' }) as Promise<bigint>,
    publicClient.readContract({ address: RWA.meth, abi: RWA_TOKEN_ABI, functionName: 'currentYield' }) as Promise<bigint>,
  ])
  return { usdyApyBps: Number(usdy), methApyBps: Number(meth) }
}

export async function readWalletBalances(user: Address): Promise<{ usdy: bigint; meth: bigint }> {
  const [usdy, meth] = await Promise.all([
    publicClient.readContract({ address: RWA.usdy, abi: RWA_TOKEN_ABI, functionName: 'balanceOf', args: [user] }) as Promise<bigint>,
    publicClient.readContract({ address: RWA.meth, abi: RWA_TOKEN_ABI, functionName: 'balanceOf', args: [user] }) as Promise<bigint>,
  ])
  return { usdy, meth }
}

/** Mint demo tokens to the user (mock tokens expose an open mint for the faucet flow). */
export async function faucetMint(account: Address, asset: Address, amount: string): Promise<`0x${string}`> {
  const wc = getWalletClient()
  const hash = await wc.writeContract({
    account, chain: mantleSepolia, address: asset,
    abi: RWA_TOKEN_ABI, functionName: 'mint', args: [account, parseEther(amount)],
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

/** Approve then deposit `amount` of `asset` into the vault (two transactions). */
export async function approveAndDeposit(
  account: Address, asset: Address, amount: string,
  onStep?: (step: 'approving' | 'depositing', hash?: `0x${string}`) => void,
): Promise<`0x${string}`> {
  const wc = getWalletClient()
  const value = parseEther(amount)

  onStep?.('approving')
  const approveHash = await wc.writeContract({
    account, chain: mantleSepolia, address: asset,
    abi: RWA_TOKEN_ABI, functionName: 'approve', args: [RWA.vault, value],
  })
  await publicClient.waitForTransactionReceipt({ hash: approveHash })

  onStep?.('depositing')
  const depositHash = await wc.writeContract({
    account, chain: mantleSepolia, address: RWA.vault,
    abi: VAULT_ABI, functionName: 'deposit', args: [asset, value],
  })
  await publicClient.waitForTransactionReceipt({ hash: depositHash })
  return depositHash
}

/** Execute the on-chain rebalance. The contract enforces sum==100% and methBps<=70%. */
export async function executeRebalance(
  account: Address, usdyBps: number, methBps: number,
): Promise<`0x${string}`> {
  const wc = getWalletClient()
  const hash = await wc.writeContract({
    account, chain: mantleSepolia, address: RWA.vault,
    abi: VAULT_ABI, functionName: 'rebalance', args: [BigInt(usdyBps), BigInt(methBps)],
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

export interface SignedRebalanceIntent {
  user: Address
  usdyBps: number
  methBps: number
  nonce: string
  deadline: string
  signature: `0x${string}`
}

/**
 * GASLESS rebalance: the user signs an EIP-712 RebalanceIntent (a free signature,
 * no gas, no tx) authorising this exact split. The agent then relays it on-chain
 * and pays the gas (POST /api/rebalance/relay → vault.rebalanceWithSig).
 */
export async function signRebalanceIntent(
  account: Address, usdyBps: number, methBps: number,
): Promise<SignedRebalanceIntent> {
  const nonce = (await publicClient.readContract({
    address: RWA.vault, abi: VAULT_ABI, functionName: 'nonces', args: [account],
  })) as bigint
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600) // 1h
  const wc = getWalletClient()
  const signature = await wc.signTypedData({
    account,
    domain: { name: 'RWAkinsVault', version: '1', chainId: MANTLE_SEPOLIA_CHAIN_ID, verifyingContract: RWA.vault },
    types: {
      RebalanceIntent: [
        { name: 'user', type: 'address' },
        { name: 'usdyBps', type: 'uint256' },
        { name: 'methBps', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'RebalanceIntent',
    message: { user: account, usdyBps: BigInt(usdyBps), methBps: BigInt(methBps), nonce, deadline },
  })
  return { user: account, usdyBps, methBps, nonce: nonce.toString(), deadline: deadline.toString(), signature }
}

/**
 * Sign-In With Ethereum: fetch a nonce + message, sign it with the wallet (free,
 * no gas), and exchange it for a session cookie. After this the per-user write
 * endpoints accept requests for THIS wallet only.
 */
export async function signInWithEthereum(account: Address): Promise<boolean> {
  const nRes = await fetch('/api/auth/nonce', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: account }),
  })
  if (!nRes.ok) return false
  const { message } = (await nRes.json()) as { message: string }
  const wc = getWalletClient()
  const signature = await wc.signMessage({ account, message })
  const vRes = await fetch('/api/auth/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: account, nonce: message.split('Nonce: ')[1]?.trim(), signature }),
  })
  return vRes.ok
}

export const fmt = (v: bigint, dp = 2) => {
  const n = Number(formatEther(v))
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}
