import {
  DEFAULT_EVM_NETWORK,
  DEFAULT_SOLANA_NETWORK,
  findNetwork
} from '@shared/constants'
import type { NetworkInfo } from '@shared/types'

export interface ActiveNetworkIds {
  activeEvmNetworkId: string
  activeSolanaNetworkId: string
}

export function networkSelectionError(network: NetworkInfo | undefined, mainnetEnabled: boolean): string | null {
  if (!network) return 'Unknown network.'
  if (network.isMainnet && !mainnetEnabled) {
    return 'Enable mainnet in Guardrails before selecting a mainnet network.'
  }
  return null
}

/** Disabling mainnet must leave the app visibly and operationally on testnets. */
export function forceTestnets(active: ActiveNetworkIds): ActiveNetworkIds {
  return {
    activeEvmNetworkId: findNetwork(active.activeEvmNetworkId)?.isMainnet
      ? DEFAULT_EVM_NETWORK
      : active.activeEvmNetworkId,
    activeSolanaNetworkId: findNetwork(active.activeSolanaNetworkId)?.isMainnet
      ? DEFAULT_SOLANA_NETWORK
      : active.activeSolanaNetworkId
  }
}
