export interface DirectBuyCommand {
  buyAmount: string
  buySymbol: string
  /** USDC is explicit in the confirmation/action summary when omitted. */
  sellSymbol: string
  networkId: 'sol-mainnet' | 'sol-devnet' | null
}

/**
 * Deliberately narrow deterministic command grammar. It is the only shortcut
 * around the model provider, and it never signs by itself: it still creates a
 * normal gated action.
 */
export function parseDirectBuyCommand(input: string): DirectBuyCommand | null {
  const match = input.match(
    /^\s*(?:buy|beli)\s+([0-9]+(?:[.,][0-9]+)?)\s+([a-z][a-z0-9]*)\s*(?:(?:with|using|pakai|dengan)\s+([a-z][a-z0-9]*))?\s*(?:(?:on|di)\s+(mainnet|devnet))?\s*$/i
  )
  if (!match) return null

  const buyAmount = match[1]!.replace(',', '.')
  const buySymbol = match[2]!.toUpperCase()
  const sellSymbol = (match[3] ?? 'USDC').toUpperCase()
  if (buySymbol !== 'SOL' || sellSymbol !== 'USDC') return null

  const network = match[4]?.toLowerCase()
  return {
    buyAmount,
    buySymbol,
    sellSymbol,
    networkId: network === 'mainnet' ? 'sol-mainnet' : network === 'devnet' ? 'sol-devnet' : null
  }
}
