import type { ExecutionModeInfo, NetworkInfo, Policy } from './types'

export const APP_NAME = 'Remiora'

/**
 * Testnets first, and deliberately so: a fresh install cannot touch real funds
 * until the operator flips `mainnetEnabled` and picks a mainnet by hand.
 */
export const NETWORKS: NetworkInfo[] = [
  {
    id: 'eth-sepolia',
    family: 'evm',
    label: 'Ethereum Sepolia',
    isMainnet: false,
    nativeSymbol: 'ETH',
    decimals: 18,
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    explorerTxUrl: 'https://sepolia.etherscan.io/tx/',
    explorerAddressUrl: 'https://sepolia.etherscan.io/address/',
    chainId: 11155111
  },
  {
    id: 'base-sepolia',
    family: 'evm',
    label: 'Base Sepolia',
    isMainnet: false,
    nativeSymbol: 'ETH',
    decimals: 18,
    rpcUrl: 'https://base-sepolia-rpc.publicnode.com',
    explorerTxUrl: 'https://sepolia.basescan.org/tx/',
    explorerAddressUrl: 'https://sepolia.basescan.org/address/',
    chainId: 84532
  },
  {
    id: 'eth-mainnet',
    family: 'evm',
    label: 'Ethereum Mainnet',
    isMainnet: true,
    nativeSymbol: 'ETH',
    decimals: 18,
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
    explorerTxUrl: 'https://etherscan.io/tx/',
    explorerAddressUrl: 'https://etherscan.io/address/',
    chainId: 1
  },
  {
    id: 'base-mainnet',
    family: 'evm',
    label: 'Base Mainnet',
    isMainnet: true,
    nativeSymbol: 'ETH',
    decimals: 18,
    rpcUrl: 'https://base-rpc.publicnode.com',
    explorerTxUrl: 'https://basescan.org/tx/',
    explorerAddressUrl: 'https://basescan.org/address/',
    chainId: 8453
  },
  {
    id: 'sol-devnet',
    family: 'solana',
    label: 'Solana Devnet',
    isMainnet: false,
    nativeSymbol: 'SOL',
    decimals: 9,
    rpcUrl: 'https://api.devnet.solana.com',
    explorerTxUrl: 'https://explorer.solana.com/tx/',
    explorerAddressUrl: 'https://explorer.solana.com/address/'
  },
  {
    id: 'sol-mainnet',
    family: 'solana',
    label: 'Solana Mainnet',
    isMainnet: true,
    nativeSymbol: 'SOL',
    decimals: 9,
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    explorerTxUrl: 'https://explorer.solana.com/tx/',
    explorerAddressUrl: 'https://explorer.solana.com/address/'
  }
]

export const DEFAULT_EVM_NETWORK = 'eth-sepolia'
export const DEFAULT_SOLANA_NETWORK = 'sol-devnet'

export const EXECUTION_MODES: ExecutionModeInfo[] = [
  {
    id: 'agent-restricted',
    label: 'Agent · Restricted',
    autonomy: 'agent',
    requiresApproval: true,
    blurb: 'One task per turn. Stops and asks you before anything moves money.'
  },
  {
    id: 'agent-full',
    label: 'Agent · Full',
    autonomy: 'agent',
    requiresApproval: false,
    blurb: 'One task per turn, executed without an approval pause. The gate still applies.'
  },
  {
    id: 'mission-restricted',
    label: 'Mission · Restricted',
    autonomy: 'mission',
    requiresApproval: true,
    blurb: 'Plans and works autonomously, but every signature waits on you.'
  },
  {
    id: 'mission-full',
    label: 'Mission · Full',
    autonomy: 'mission',
    requiresApproval: false,
    blurb: 'Continuous autonomy. Only the guardrail gate stands between plan and execution.'
  }
]

export const DEFAULT_POLICY: Policy = {
  maxNotionalUsdPerAction: 50,
  maxNotionalUsdPerMission: 250,
  maxLossUsd: 25,
  maxSlippageBps: 100,
  missionDeadlineMinutes: 30,
  maxMissionSteps: 12,
  transferAllowlist: [],
  tokenAllowlist: ['ETH', 'WETH', 'USDC', 'SOL'],
  mainnetEnabled: false,
  emergencyStop: false
}

/**
 * The hosted endpoint VexDesk runs. It keeps the provider credential on the
 * server and meters usage per access key, so no provider key ever ships inside
 * a build where it could be extracted.
 *
 * Deliberately not the default yet: pointing new installs at an endpoint that
 * is not answering would leave them with an assistant that quietly falls back
 * to the local planner and no way to tell why. Once it serves
 * /chat/completions in production, make this the value of
 * DEFAULT_LLM_BASE_URL below — that is the entire switch.
 */
export const VEXDESK_HOSTED_BASE_URL = 'https://api.vexdesktop.xyz/v1'

/** OpenAI-compatible endpoint. Anything speaking that dialect works here. */
export const DEFAULT_LLM_BASE_URL = 'https://ai.megallm.io/v1'
export const DEFAULT_LLM_MODEL = 'openai-gpt-oss-120b'

/** Used only when semantic memory is switched on, which it is not by default. */
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'

/** Lesson strength halves every 30 days. */
export const MEMORY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000

/** Idle minutes before the vault re-locks itself and wipes the key from memory. */
export const AUTO_LOCK_MINUTES = 15

export const DERIVATION_PATH_EVM = "m/44'/60'/0'/0/0"
export const DERIVATION_PATH_SOLANA = "m/44'/501'/0'/0'"

/**
 * Non-explorer links the app is allowed to open, matched exactly.
 *
 * The external-link gate is otherwise limited to block explorers. Widening it
 * to a whole domain would mean any string starting with `https://x.com/` gets
 * through, so this stays a list of complete URLs the build already knows.
 */
export const EXTERNAL_LINKS = {
  x: 'https://x.com/vexdesktop'
} as const

export function isAllowedExternalLink(url: string): boolean {
  if (Object.values(EXTERNAL_LINKS).includes(url as never)) return true
  return NETWORKS.some((n) => url.startsWith(n.explorerTxUrl) || url.startsWith(n.explorerAddressUrl))
}

export function findNetwork(id: string): NetworkInfo | undefined {
  return NETWORKS.find((n) => n.id === id)
}
