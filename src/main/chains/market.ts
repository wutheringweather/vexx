/**
 * Read-only market data. Nothing here can move funds; it exists so the agent
 * can research before it proposes, and so the gate has a USD figure to judge.
 */

interface CachedPrice {
  usd: number
  at: number
  source: string
}

const CACHE_TTL_MS = 60_000
const cache = new Map<string, CachedPrice>()

/** Used when the network is unavailable so the app stays usable offline. */
const FALLBACK_USD: Record<string, number> = {
  ETH: 3000,
  WETH: 3000,
  SOL: 150,
  USDC: 1,
  USDT: 1,
  DAI: 1
}

export interface PriceQuote {
  symbol: string
  usd: number
  source: string
  at: number
  stale: boolean
}

export async function getPrice(symbol: string): Promise<PriceQuote> {
  const key = symbol.toUpperCase()
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { symbol: key, usd: cached.usd, source: cached.source, at: cached.at, stale: false }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 6000)
    const res = await fetch(`https://api.coinbase.com/v2/prices/${key}-USD/spot`, {
      signal: controller.signal
    })
    clearTimeout(timeout)
    if (!res.ok) throw new Error(`Price API returned ${res.status}`)

    const payload = (await res.json()) as { data?: { amount?: string } }
    const usd = Number(payload.data?.amount)
    if (!Number.isFinite(usd) || usd <= 0) throw new Error('Price API returned no usable amount')

    const entry: CachedPrice = { usd, at: Date.now(), source: 'coinbase' }
    cache.set(key, entry)
    return { symbol: key, usd, source: entry.source, at: entry.at, stale: false }
  } catch {
    const fallback = FALLBACK_USD[key]
    if (fallback === undefined) {
      // Unknown asset with no quote: report zero and let the gate decide.
      return { symbol: key, usd: 0, source: 'unknown', at: Date.now(), stale: true }
    }
    return { symbol: key, usd: fallback, source: 'offline-fallback', at: Date.now(), stale: true }
  }
}

export async function toUsd(symbol: string, amount: string): Promise<number> {
  const quote = await getPrice(symbol)
  const value = Number(amount) * quote.usd
  return Number.isFinite(value) ? value : 0
}

export interface SwapQuote {
  sellSymbol: string
  buySymbol: string
  sellAmount: string
  expectedBuyAmount: string
  slippageBps: number
  rate: number
  notionalUsd: number
  source: string
}

/**
 * A price-derived quote, not a routed one. Testnets have no real liquidity, so
 * pretending to route through a DEX would be a lie the audit log then records
 * as fact. This is explicitly labelled as an indicative quote everywhere it
 * surfaces, and the resulting action executes as a simulation.
 */
export async function quoteSwap(
  sellSymbol: string,
  buySymbol: string,
  sellAmount: string
): Promise<SwapQuote> {
  const [sell, buy] = await Promise.all([getPrice(sellSymbol), getPrice(buySymbol)])
  const amount = Number(sellAmount)

  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Invalid sell amount "${sellAmount}"`)
  if (buy.usd <= 0) throw new Error(`No price available for ${buySymbol}`)
  if (sell.usd <= 0) throw new Error(`No price available for ${sellSymbol}`)

  const rate = sell.usd / buy.usd
  // A flat 30 bps stands in for pool fee plus impact at these sizes.
  const slippageBps = 30
  const expected = amount * rate * (1 - slippageBps / 10_000)

  return {
    sellSymbol: sell.symbol,
    buySymbol: buy.symbol,
    sellAmount,
    expectedBuyAmount: expected.toFixed(6),
    slippageBps,
    rate,
    notionalUsd: amount * sell.usd,
    source: `${sell.source}/${buy.source}`
  }
}
