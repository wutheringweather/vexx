import { z } from 'zod'
import type { ProposedAction } from '@shared/types'
import { NETWORKS, findNetwork } from '@shared/constants'
import type { LlmToolDef } from './llm'
import * as market from '../chains/market'
import * as evm from '../chains/evm'
import * as solana from '../chains/solana'
import * as jupiter from '../chains/jupiter'
import * as lessons from '../memory/lessons'
import * as state from '../state'
import { publicAddresses } from '../vault/keystore'
import { propose } from './actions'
import { open as openSecret } from '../storage/secret-store'

export interface ToolResult {
  summary: string
  data: Record<string, unknown>
  /** Set when the tool put something into the approval pipeline. */
  actionId?: string
}

export interface ToolContext {
  missionId: string | null
}

interface ToolSpec<S extends z.ZodTypeAny> {
  name: string
  description: string
  schema: S
  /** Read tools are free. Write tools always land in the gate. */
  movesFunds: boolean
  /** Declared as a method so specs with narrower schemas stay assignable. */
  run(args: z.infer<S>, ctx: ToolContext): Promise<ToolResult>
}

function def<S extends z.ZodTypeAny>(spec: ToolSpec<S>): ToolSpec<S> {
  return spec
}

// ---------------------------------------------------------------------------
// Read-only research tools
// ---------------------------------------------------------------------------

const getPortfolio = def({
  name: 'get_portfolio',
  description:
    'Read the current wallet addresses and native-token balances on the active networks. Always call this before proposing anything that spends.',
  schema: z.object({}),
  movesFunds: false,
  async run() {
    const s = state.current()
    const addresses = publicAddresses()
    const networkIds = [s.activeEvmNetworkId, s.activeSolanaNetworkId]

    const balances = await Promise.all(
      networkIds.map(async (id) => {
        const network = findNetwork(id)
        if (!network) return null
        const address = network.family === 'evm' ? addresses.evm : addresses.solana
        if (!address) return null
        return network.family === 'evm'
          ? evm.getBalance(network, address)
          : solana.getBalance(network, address)
      })
    )

    const rows = balances.filter((b) => b !== null)
    return {
      summary:
        rows.length === 0
          ? 'The vault is locked, so no balances are readable.'
          : rows
              .map((b) => `${b.formatted} ${b.symbol} on ${findNetwork(b.networkId)?.label}`)
              .join('; '),
      data: { addresses, balances: rows }
    }
  }
})

const getPrice = def({
  name: 'get_price',
  description: 'Get the current USD spot price for one asset symbol, for example ETH, SOL or USDC.',
  schema: z.object({ symbol: z.string().min(1).max(12) }),
  movesFunds: false,
  async run({ symbol }) {
    const quote = await market.getPrice(symbol)
    return {
      summary: `${quote.symbol} is $${quote.usd.toLocaleString()} (source: ${quote.source}${
        quote.stale ? ', stale' : ''
      }).`,
      data: { ...quote }
    }
  }
})

const quoteSwap = def({
  name: 'quote_swap',
  description:
    'Get an indicative price-derived quote for swapping one asset into another. This is not a routed DEX quote and executing it runs as a simulation.',
  schema: z.object({
    sellSymbol: z.string().min(1).max(12),
    buySymbol: z.string().min(1).max(12),
    sellAmount: z.string().min(1)
  }),
  movesFunds: false,
  async run({ sellSymbol, buySymbol, sellAmount }) {
    const quote = await market.quoteSwap(sellSymbol, buySymbol, sellAmount)
    return {
      summary: `${quote.sellAmount} ${quote.sellSymbol} is worth about ${quote.expectedBuyAmount} ${quote.buySymbol} (~$${quote.notionalUsd.toFixed(2)}, ${quote.slippageBps} bps assumed).`,
      data: { ...quote }
    }
  }
})

const getGuardrails = def({
  name: 'get_guardrails',
  description:
    'Read the active guardrail policy and execution mode. Use it to understand what you are permitted to propose before you propose it.',
  schema: z.object({}),
  movesFunds: false,
  async run() {
    const s = state.current()
    const p = s.policy
    return {
      summary: `Mode ${s.mode}. Caps: $${p.maxNotionalUsdPerAction}/action, $${p.maxNotionalUsdPerMission}/mission, max loss $${p.maxLossUsd}, slippage ${p.maxSlippageBps} bps. Mainnet ${p.mainnetEnabled ? 'enabled' : 'disabled'}. Tokens: ${p.tokenAllowlist.join(', ') || 'none'}. Transfer destinations: ${p.transferAllowlist.length || 'none'}.`,
      data: { policy: p, mode: s.mode, networks: NETWORKS.map((n) => n.id) }
    }
  }
})

const recallMemory = def({
  name: 'recall_memory',
  description: 'Search your own past lessons for anything relevant to a topic.',
  schema: z.object({ query: z.string().min(1).max(200) }),
  movesFunds: false,
  async run({ query }) {
    const hits = await lessons.recall(query)
    return {
      summary:
        hits.length === 0
          ? 'Nothing relevant in memory yet.'
          : hits.map((l) => `[${l.tier}, ${l.strength.toFixed(2)}] ${l.text}`).join('\n'),
      data: { lessons: hits }
    }
  }
})

const rememberLesson = def({
  name: 'remember_lesson',
  description:
    'Store a durable lesson. Record judgements and rules that will still be true next week, never balances, prices or secrets.',
  schema: z.object({
    tier: z.enum(['episodic', 'semantic', 'procedural']),
    text: z.string().min(4).max(400),
    tags: z.array(z.string().max(32)).max(6).optional()
  }),
  movesFunds: false,
  async run({ tier, text, tags }) {
    const lesson = await lessons.remember(tier, text, tags ?? [])
    return { summary: `Stored a ${tier} lesson.`, data: { id: lesson.id } }
  }
})

// ---------------------------------------------------------------------------
// Fund-moving proposals — these end at the gate, never at a signature
// ---------------------------------------------------------------------------

const proposeTransfer = def({
  name: 'propose_transfer',
  description:
    'Propose sending native tokens to an address. This does not execute: it is judged by the safety gate and, in restricted modes, queued for human approval.',
  schema: z.object({
    networkId: z.string().min(1),
    to: z.string().min(1),
    amount: z.string().min(1),
    symbol: z.string().min(1).max(12),
    rationale: z.string().min(4).max(500)
  }),
  movesFunds: true,
  async run({ networkId, to, amount, symbol, rationale }, ctx) {
    const action: ProposedAction = {
      kind: 'transfer',
      networkId,
      to,
      amount,
      symbol: symbol.toUpperCase(),
      estimatedUsd: await market.toUsd(symbol, amount)
    }
    const record = await propose(action, rationale, ctx.missionId)
    return {
      summary: describeOutcome(record.status, record.verdict.reason),
      data: { actionId: record.id, status: record.status, decision: record.verdict.decision },
      actionId: record.id
    }
  }
})

const proposeSwap = def({
  name: 'propose_swap',
  description:
    'Propose swapping one asset for another. This does not execute: it is judged by the safety gate and, in restricted modes, queued for human approval.',
  schema: z.object({
    networkId: z.string().min(1),
    sellSymbol: z.string().min(1).max(12),
    buySymbol: z.string().min(1).max(12),
    sellAmount: z.string().min(1),
    rationale: z.string().min(4).max(500)
  }),
  movesFunds: true,
  async run({ networkId, sellSymbol, buySymbol, sellAmount, rationale }, ctx) {
    const quote = await market.quoteSwap(sellSymbol, buySymbol, sellAmount)
    const action: ProposedAction = {
      kind: 'swap',
      networkId,
      sellSymbol: quote.sellSymbol,
      buySymbol: quote.buySymbol,
      sellAmount: quote.sellAmount,
      execution: 'simulation',
      expectedBuyAmount: quote.expectedBuyAmount,
      slippageBps: quote.slippageBps,
      estimatedUsd: quote.notionalUsd
    }
    const record = await propose(action, rationale, ctx.missionId)
    return {
      summary: describeOutcome(record.status, record.verdict.reason),
      data: { actionId: record.id, status: record.status, decision: record.verdict.decision },
      actionId: record.id
    }
  }
})

const proposeBuy = def({
  name: 'propose_buy',
  description:
    'Propose a live Jupiter buy target on Solana mainnet. The quote uses USDC by default, is re-quoted immediately before signing, and still passes through the safety gate.',
  schema: z.object({
    networkId: z.string().min(1),
    buySymbol: z.literal('SOL'),
    buyAmount: z.string().min(1),
    sellSymbol: z.literal('USDC'),
    rationale: z.string().min(4).max(500)
  }),
  movesFunds: true,
  async run({ networkId, buySymbol, buyAmount, sellSymbol, rationale }, ctx) {
    if (networkId !== 'sol-mainnet') {
      throw new Error('Live target buys require Solana mainnet. Select it and enable mainnet in Guardrails first.')
    }
    const apiKey = openSecret(state.current().jupiter.apiKeyCipher)
    if (!apiKey) throw new Error('Jupiter API key is not configured. Add it in Settings first.')
    const wallet = publicAddresses().solana
    if (!wallet) throw new Error('Unlock the vault before requesting a live buy quote.')
    const s = state.current()
    const quote = await jupiter.quoteTargetBuy(apiKey, {
      sellSymbol,
      buySymbol,
      targetBuyAmount: buyAmount,
      slippageBps: s.policy.maxSlippageBps,
      taker: wallet
    })
    const action: ProposedAction = {
      kind: 'swap',
      networkId,
      sellSymbol: quote.sellSymbol,
      buySymbol: quote.buySymbol,
      sellAmount: quote.sellAmount,
      targetBuyAmount: quote.targetBuyAmount,
      execution: 'live',
      expectedBuyAmount: quote.expectedBuyAmount,
      slippageBps: quote.slippageBps,
      estimatedUsd: quote.notionalUsd
    }
    const record = await propose(action, rationale, ctx.missionId)
    return {
      summary:
        `${describeOutcome(record.status, record.verdict.reason)} Target ${buyAmount} ${buySymbol} using approximately ${quote.sellAmount} ${sellSymbol}. Jupiter will re-quote before signing.`,
      data: {
        actionId: record.id,
        status: record.status,
        decision: record.verdict.decision,
        targetBuyAmount: buyAmount,
        estimatedSellAmount: quote.sellAmount,
        expectedBuyAmount: quote.expectedBuyAmount
      },
      actionId: record.id
    }
  }
})

function describeOutcome(status: string, reason: string | null): string {
  switch (status) {
    case 'blocked':
      return `BLOCKED by the safety gate. ${reason ?? ''} Do not retry the same action; either change it to fit the policy or explain to the operator why the policy is in the way.`
    case 'pending':
      return 'Queued for human approval. Stop here and tell the operator what you are waiting on.'
    case 'executed':
      return 'Executed. Report the outcome.'
    case 'simulated':
      return 'Simulation complete. No funds moved and no transaction was broadcast.'
    case 'failed':
      return 'Execution failed. Report why, and do not blindly retry.'
    default:
      return `Action status: ${status}.`
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const REGISTRY: ToolSpec<z.ZodTypeAny>[] = [
  getPortfolio,
  getPrice,
  quoteSwap,
  getGuardrails,
  recallMemory,
  rememberLesson,
  proposeTransfer,
  proposeSwap,
  proposeBuy
]

export const TOOL_NAMES = REGISTRY.map((t) => t.name)

function jsonSchemaFor(spec: ToolSpec<z.ZodTypeAny>): Record<string, unknown> {
  // Hand-rolled rather than pulled from a converter dependency: the schemas are
  // small, and the wire format has to match what OpenAI-compatible servers want.
  const shape = (spec.schema as unknown as z.ZodObject<z.ZodRawShape>).shape ?? {}
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [key, value] of Object.entries(shape)) {
    const field = value as z.ZodTypeAny
    const inner = field instanceof z.ZodOptional ? field.unwrap() : field
    if (inner instanceof z.ZodEnum) {
      properties[key] = { type: 'string', enum: inner.options }
    } else if (inner instanceof z.ZodArray) {
      properties[key] = { type: 'array', items: { type: 'string' } }
    } else {
      properties[key] = { type: 'string' }
    }
    if (!(field instanceof z.ZodOptional)) required.push(key)
  }

  return { type: 'object', properties, required, additionalProperties: false }
}

export function toolDefinitions(): LlmToolDef[] {
  return REGISTRY.map((spec) => ({
    name: spec.name,
    description: spec.description,
    parameters: jsonSchemaFor(spec)
  }))
}

export async function dispatch(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const spec = REGISTRY.find((t) => t.name === name)
  if (!spec) {
    return { summary: `No tool named "${name}" exists.`, data: { error: 'unknown-tool' } }
  }

  // The model's arguments are untrusted input. Validate before they reach any
  // code that can talk to a chain.
  const parsed = spec.schema.safeParse(args)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'args'}: ${i.message}`)
    return {
      summary: `Rejected the call to ${name}. ${issues.join('; ')}`,
      data: { error: 'invalid-arguments', issues }
    }
  }

  try {
    return await spec.run(parsed.data, ctx)
  } catch (err) {
    return {
      summary: `${name} failed: ${err instanceof Error ? err.message : String(err)}`,
      data: { error: 'tool-threw' }
    }
  }
}
