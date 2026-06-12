// Built by vsrupeshkumar
// ABIs for the RWAkins AI x RWA stack on Mantle Sepolia.

export const RWA_TOKEN_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'currentYield', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  // Owner-only: the agent syncs the live reference APY on-chain (lib/rwa/oracleSync).
  { type: 'function', name: 'setYield', stateMutability: 'nonpayable', inputs: [{ name: 'yieldBps', type: 'uint256' }], outputs: [] },
] as const

export const VAULT_ABI = [
  { type: 'function', name: 'deposit', stateMutability: 'nonpayable', inputs: [{ name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [{ name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'rebalance', stateMutability: 'nonpayable', inputs: [{ name: 'usdyBps', type: 'uint256' }, { name: 'methBps', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'rebalanceFor', stateMutability: 'nonpayable', inputs: [{ name: 'user', type: 'address' }, { name: 'usdyBps', type: 'uint256' }, { name: 'methBps', type: 'uint256' }], outputs: [] },
  // Gasless: user signs an EIP-712 RebalanceIntent off-chain, a relayer submits it.
  { type: 'function', name: 'rebalanceWithSig', stateMutability: 'nonpayable', inputs: [{ name: 'user', type: 'address' }, { name: 'usdyBps', type: 'uint256' }, { name: 'methBps', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }, { name: 'v', type: 'uint8' }, { name: 'r', type: 'bytes32' }, { name: 's', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'nonces', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'feeBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function', name: 'getPortfolio', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: 'usdyBal', type: 'uint256' }, { name: 'methBal', type: 'uint256' }, { name: 'usdyBps', type: 'uint256' }, { name: 'methBps', type: 'uint256' }],
  },
  { type: 'function', name: 'getTotalValue', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'usdy', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'meth', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'MAX_RISK_BPS', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  // Live mETH price (USDY units, 1e18) — read straight from the AMM pool reserves.
  { type: 'function', name: 'methPriceE18', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'event', name: 'Deposited', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'asset', type: 'address', indexed: false }, { name: 'amount', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'Withdrawn', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'asset', type: 'address', indexed: false }, { name: 'amount', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'Rebalanced', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'usdyBps', type: 'uint256', indexed: false }, { name: 'methBps', type: 'uint256', indexed: false }, { name: 'timestamp', type: 'uint256', indexed: false }] },
] as const

// The constant-product AMM the vault swaps through during a rebalance. The agent
// owner key keeps its spot price anchored to the live market via syncToPrice.
export const AMM_ABI = [
  { type: 'function', name: 'spotPriceE18', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'getReserves', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }, { type: 'uint256' }] },
  { type: 'function', name: 'getAmountOut', stateMutability: 'view', inputs: [{ name: 'tokenIn', type: 'address' }, { name: 'amountIn', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  // Owner-only: anchor the pool spot price to the live market (arbitrage stand-in).
  { type: 'function', name: 'syncToPrice', stateMutability: 'nonpayable', inputs: [{ name: 'targetPriceE18', type: 'uint256' }], outputs: [] },
] as const

// On-chain KYC/eligibility registry. The agent compliance-officer key writes
// verdicts; the vault gates deposits on isCompliant().
export const COMPLIANCE_ABI = [
  { type: 'function', name: 'isCompliant', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'bool' }] },
  {
    type: 'function', name: 'statusOf', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: 'verified', type: 'bool' }, { name: 'accredited', type: 'bool' }, { name: 'riskScore', type: 'uint8' }, { name: 'jurisdiction', type: 'bytes2' }, { name: 'expiry', type: 'uint64' }],
  },
  { type: 'function', name: 'setCompliance', stateMutability: 'nonpayable', inputs: [{ name: 'user', type: 'address' }, { name: 'verified', type: 'bool' }, { name: 'accredited', type: 'bool' }, { name: 'riskScore', type: 'uint8' }, { name: 'jurisdiction', type: 'bytes2' }, { name: 'expiry', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'revoke', stateMutability: 'nonpayable', inputs: [{ name: 'user', type: 'address' }, { name: 'reason', type: 'string' }], outputs: [] },
] as const
