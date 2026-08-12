import { describe, expect, it } from 'vitest'
import { findNetwork } from '@shared/constants'
import { forceTestnets, networkSelectionError } from './networks'

describe('mainnet/testnet network policy', () => {
  it('returns both active networks to their testnets when mainnet is disabled', () => {
    expect(
      forceTestnets({ activeEvmNetworkId: 'base-mainnet', activeSolanaNetworkId: 'sol-mainnet' })
    ).toEqual({ activeEvmNetworkId: 'eth-sepolia', activeSolanaNetworkId: 'sol-devnet' })
  })

  it('does not change active testnets during a policy refresh', () => {
    expect(
      forceTestnets({ activeEvmNetworkId: 'base-sepolia', activeSolanaNetworkId: 'sol-devnet' })
    ).toEqual({ activeEvmNetworkId: 'base-sepolia', activeSolanaNetworkId: 'sol-devnet' })
  })

  it('allows an explicit mainnet selection only after the toggle is on', () => {
    const mainnet = findNetwork('sol-mainnet')
    expect(networkSelectionError(mainnet, false)).toContain('Enable mainnet')
    expect(networkSelectionError(mainnet, true)).toBeNull()
  })
})
