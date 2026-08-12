import { Keypair, VersionedTransaction } from '@solana/web3.js'
import * as market from './market'
import type { JupiterProbeResult } from '@shared/types'

const ORDER_URL = 'https://api.jup.ag/swap/v2/order'
const EXECUTE_URL = 'https://api.jup.ag/swap/v2/execute'
const REQUEST_TIMEOUT_MS = 15_000

export const TOKEN_MINTS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
} as const

const TOKEN_DECIMALS = { SOL: 9, USDC: 6 } as const

type SupportedToken = keyof typeof TOKEN_MINTS

interface JupiterOrderResponse {
  inputMint?: string
  outputMint?: string
  inAmount?: string
  outAmount?: string
  otherAmountThreshold?: string
  transaction?: string
  requestId?: string
  router?: string
  errorCode?: number
  errorMessage?: string
}

interface JupiterExecuteResponse {
  status?: 'Success' | 'Failed' | string
  signature?: string
  code?: number
  error?: string
  inputAmountResult?: string
  outputAmountResult?: string
}

export interface JupiterTargetQuote {
  sellSymbol: string
  buySymbol: string
  sellAmount: string
  expectedBuyAmount: string
  targetBuyAmount: string
  slippageBps: number
  notionalUsd: number
  source: 'jupiter'
  inputAmountRaw: string
  outputAmountRaw: string
  minimumOutputAmountRaw: string
  requestId: string | null
  router: string | null
}

export interface LiveSwapResult {
  ok: boolean
  signature: string | null
  detail: string
  actualSellAmount: string | null
  actualBuyAmount: string | null
}

function supportedSymbol(symbol: string): SupportedToken {
  const key = symbol.toUpperCase() as SupportedToken
  if (!(key in TOKEN_MINTS)) {
    throw new Error(`Jupiter live swaps currently support SOL and USDC only, not ${symbol}.`)
  }
  return key
}

export function parseUnits(value: string, decimals: number): bigint {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error(`Invalid decimal amount "${value}".`)
  const [whole, fraction = ''] = normalized.split('.')
  if (fraction.length > decimals) throw new Error(`Amount "${value}" has too many decimals.`)
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0')
}

export function formatUnits(raw: string | bigint, decimals: number): string {
  const value = typeof raw === 'bigint' ? raw : BigInt(raw)
  const base = 10n ** BigInt(decimals)
  const whole = value / base
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

async function request<T>(url: string, apiKey: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { accept: 'application/json', 'x-api-key': apiKey, ...(init?.headers ?? {}) }
    })
    const payload = (await response.json().catch(() => ({}))) as T & {
      error?: string
      errorMessage?: string
    }
    if (!response.ok) {
      throw new Error(
        `Jupiter returned HTTP ${response.status}: ${payload.errorMessage ?? payload.error ?? 'request failed'}`
      )
    }
    return payload
  } finally {
    clearTimeout(timer)
  }
}

async function order(
  apiKey: string,
  inputSymbol: string,
  outputSymbol: string,
  amountRaw: string,
  taker: string | null,
  slippageBps: number
): Promise<JupiterOrderResponse> {
  if (!apiKey.trim()) throw new Error('Jupiter API key is not configured.')
  const input = supportedSymbol(inputSymbol)
  const output = supportedSymbol(outputSymbol)
  const params = new URLSearchParams({
    inputMint: TOKEN_MINTS[input],
    outputMint: TOKEN_MINTS[output],
    amount: amountRaw,
    slippageBps: String(slippageBps)
  })
  if (taker) params.set('taker', taker)
  const result = await request<JupiterOrderResponse>(`${ORDER_URL}?${params.toString()}`, apiKey)
  if (result.errorCode || !result.outAmount || !result.inAmount) {
    throw new Error(result.errorMessage ?? `Jupiter returned no usable route for ${input} → ${output}.`)
  }
  if (result.inputMint !== TOKEN_MINTS[input] || result.outputMint !== TOKEN_MINTS[output]) {
    throw new Error('Jupiter returned a route for unexpected token mints; nothing was signed.')
  }
  return result
}

export async function quoteTargetBuy(
  apiKey: string,
  input: {
    sellSymbol: string
    buySymbol: string
    targetBuyAmount: string
    slippageBps: number
    taker: string
  }
): Promise<JupiterTargetQuote> {
  const sellSymbol = supportedSymbol(input.sellSymbol)
  const buySymbol = supportedSymbol(input.buySymbol)
  if (sellSymbol === buySymbol) throw new Error('Sell and buy assets must be different.')
  const targetRaw = parseUnits(input.targetBuyAmount, TOKEN_DECIMALS[buySymbol])
  if (targetRaw <= 0n) throw new Error('Target buy amount must be positive.')

  const [sellPrice, buyPrice] = await Promise.all([
    market.getPrice(sellSymbol),
    market.getPrice(buySymbol)
  ])
  if (sellPrice.usd <= 0 || buyPrice.usd <= 0) throw new Error('No usable USD price for this SOL/USDC pair.')
  if (sellPrice.stale || buyPrice.stale) {
    throw new Error('Live target buys require a fresh USD price; try again when the price provider is reachable.')
  }

  // Jupiter v2 is ExactIn. Start from a price estimate, then increase the
  // input in small BigInt steps until the quoted minimum output reaches the
  // user's requested target. The quote is rebuilt again before signing.
  const estimatedSell =
    (Number(input.targetBuyAmount) * buyPrice.usd) / sellPrice.usd * 1.01
  let inputRaw = parseUnits(estimatedSell.toFixed(TOKEN_DECIMALS[sellSymbol]), TOKEN_DECIMALS[sellSymbol])
  let latest: JupiterOrderResponse | null = null

  for (let attempt = 0; attempt < 5; attempt++) {
    latest = await order(apiKey, sellSymbol, buySymbol, inputRaw.toString(), input.taker, input.slippageBps)
    const outputRaw = BigInt(latest.outAmount!)
    const minimumRaw = BigInt(latest.otherAmountThreshold ?? latest.outAmount!)
    if (outputRaw >= targetRaw && minimumRaw >= targetRaw) {
      const sellAmount = formatUnits(latest.inAmount!, TOKEN_DECIMALS[sellSymbol])
      return {
        sellSymbol,
        buySymbol,
        sellAmount,
        expectedBuyAmount: formatUnits(outputRaw, TOKEN_DECIMALS[buySymbol]),
        targetBuyAmount: input.targetBuyAmount,
        slippageBps: input.slippageBps,
        notionalUsd: Number(sellAmount) * sellPrice.usd,
        source: 'jupiter',
        inputAmountRaw: latest.inAmount!,
        outputAmountRaw: latest.outAmount!,
        minimumOutputAmountRaw: latest.otherAmountThreshold ?? latest.outAmount!,
        requestId: latest.requestId ?? null,
        router: latest.router ?? null
      }
    }

    const observed = outputRaw > 0n ? outputRaw : 1n
    const missing = targetRaw > minimumRaw ? targetRaw - minimumRaw : targetRaw - outputRaw
    inputRaw += (inputRaw * missing) / observed + 1n
  }

  throw new Error(
    `Jupiter could not quote the requested ${input.targetBuyAmount} ${buySymbol} within five attempts.`
  )
}

export async function executeLiveSwap(
  apiKey: string,
  input: {
    sellSymbol: string
    buySymbol: string
    targetBuyAmount?: string
    sellAmount: string
    slippageBps: number
    taker: string
    secretKey: Uint8Array
  }
): Promise<LiveSwapResult> {
  const sellSymbol = supportedSymbol(input.sellSymbol)
  const buySymbol = supportedSymbol(input.buySymbol)
  const requestedTarget = input.targetBuyAmount
    ? parseUnits(input.targetBuyAmount, TOKEN_DECIMALS[buySymbol])
    : null
  const inputRaw = parseUnits(input.sellAmount, TOKEN_DECIMALS[sellSymbol])
  const fresh = await order(apiKey, sellSymbol, buySymbol, inputRaw.toString(), input.taker, input.slippageBps)
  const outputRaw = BigInt(fresh.outAmount!)
  const minimumRaw = BigInt(fresh.otherAmountThreshold ?? fresh.outAmount!)

  if (requestedTarget !== null && minimumRaw < requestedTarget) {
    return {
      ok: false,
      signature: null,
      actualSellAmount: formatUnits(fresh.inAmount!, TOKEN_DECIMALS[sellSymbol]),
      actualBuyAmount: formatUnits(outputRaw, TOKEN_DECIMALS[buySymbol]),
      detail: `Fresh Jupiter quote no longer guarantees ${formatUnits(requestedTarget, TOKEN_DECIMALS[buySymbol])} ${buySymbol}; nothing was signed.`
    }
  }
  if (!fresh.transaction) {
    return { ok: false, signature: null, actualSellAmount: null, actualBuyAmount: null, detail: 'Jupiter returned no transaction; nothing was signed.' }
  }
  if (!fresh.requestId) {
    return { ok: false, signature: null, actualSellAmount: null, actualBuyAmount: null, detail: 'Jupiter returned no request id; nothing was signed.' }
  }

  const transaction = VersionedTransaction.deserialize(Buffer.from(fresh.transaction, 'base64'))
  transaction.sign([Keypair.fromSecretKey(input.secretKey)])
  const executed = await request<JupiterExecuteResponse>(EXECUTE_URL, apiKey, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      signedTransaction: Buffer.from(transaction.serialize()).toString('base64'),
      requestId: fresh.requestId
    })
  })

  const ok = executed.status === 'Success' && Boolean(executed.signature)
  return {
    ok,
    signature: executed.signature ?? null,
    actualSellAmount: executed.inputAmountResult
      ? formatUnits(executed.inputAmountResult, TOKEN_DECIMALS[sellSymbol])
      : formatUnits(fresh.inAmount!, TOKEN_DECIMALS[sellSymbol]),
    actualBuyAmount: executed.outputAmountResult
      ? formatUnits(executed.outputAmountResult, TOKEN_DECIMALS[buySymbol])
      : formatUnits(outputRaw, TOKEN_DECIMALS[buySymbol]),
    detail: ok
      ? `Jupiter executed ${formatUnits(executed.inputAmountResult ?? fresh.inAmount!, TOKEN_DECIMALS[sellSymbol])} ${sellSymbol} for ${formatUnits(executed.outputAmountResult ?? fresh.outAmount!, TOKEN_DECIMALS[buySymbol])} ${buySymbol}.`
      : `Jupiter execution failed${executed.error ? `: ${executed.error}` : '.'}`
  }
}

export async function probe(apiKey: string, taker: string | null = null): Promise<JupiterProbeResult> {
  const started = Date.now()
  try {
    await order(apiKey, 'USDC', 'SOL', '1000000', taker, 100)
    return { ok: true, latencyMs: Date.now() - started, detail: 'Jupiter quote endpoint is reachable.' }
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err)
    }
  }
}
