import { describe, expect, it } from 'vitest'
import { parseDirectBuyCommand } from './commands'

describe('direct buy command parser', () => {
  it('parses the short SOL command and defaults the funding asset to USDC', () => {
    expect(parseDirectBuyCommand('buy 1 sol')).toEqual({
      buyAmount: '1',
      buySymbol: 'SOL',
      sellSymbol: 'USDC',
      networkId: null
    })
  })

  it('accepts Indonesian words, decimal commas and an explicit network', () => {
    expect(parseDirectBuyCommand('beli 1,25 SOL pakai USDC di mainnet')).toEqual({
      buyAmount: '1.25',
      buySymbol: 'SOL',
      sellSymbol: 'USDC',
      networkId: 'sol-mainnet'
    })
  })

  it('does not guess from vague or unsupported commands', () => {
    expect(parseDirectBuyCommand('buy SOL')).toBeNull()
    expect(parseDirectBuyCommand('buy 1 ETH')).toBeNull()
    expect(parseDirectBuyCommand('buy 1 sol and send the rest')).toBeNull()
  })
})
