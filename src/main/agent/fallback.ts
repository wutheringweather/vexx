import type { ChatMessage } from '@shared/types'
import { EXECUTION_MODES, findNetwork } from '@shared/constants'
import * as state from '../state'
import * as lessons from '../memory/lessons'
import { dispatch } from './tools'
import { newId } from '../storage/files'

/**
 * The deterministic planner that answers when no model provider is configured
 * or the provider is unreachable.
 *
 * It handles the read-only side of the job — balances, prices, quotes, policy,
 * memory — by matching intent and calling the same tools the model would. It
 * deliberately never proposes a fund-moving action: an action nobody reasoned
 * about should not reach the gate just because the network was down.
 */

interface Intent {
  test: RegExp
  run: (message: string) => Promise<string>
}

function symbolFrom(message: string, fallback = 'ETH'): string {
  const match = message.toUpperCase().match(/\b(ETH|WETH|SOL|USDC|USDT|DAI|BTC|WBTC)\b/)
  return match?.[1] ?? fallback
}

function amountFrom(message: string): string | null {
  const match = message.match(/\b(\d+(?:\.\d+)?)\b/)
  return match?.[1] ?? null
}

const INTENTS: Intent[] = [
  {
    test: /\b(balance|portfolio|holding|wallet|saldo|dompet)\b/i,
    async run() {
      const result = await dispatch('get_portfolio', {}, { missionId: null })
      return `Portfolio: ${result.summary}`
    }
  },
  {
    test: /\b(price|harga|worth|quote|rate)\b/i,
    async run(message) {
      if (/\b(swap|tukar|convert|into|to)\b/i.test(message)) {
        const symbols = message.toUpperCase().match(/\b(ETH|WETH|SOL|USDC|USDT|DAI)\b/g)
        const amount = amountFrom(message)
        if (symbols && symbols.length >= 2 && amount) {
          const result = await dispatch(
            'quote_swap',
            { sellSymbol: symbols[0], buySymbol: symbols[1], sellAmount: amount },
            { missionId: null }
          )
          return result.summary
        }
      }
      const result = await dispatch('get_price', { symbol: symbolFrom(message) }, { missionId: null })
      return result.summary
    }
  },
  {
    test: /\b(policy|guardrail|limit|rule|cap|batas|aturan)\b/i,
    async run() {
      const result = await dispatch('get_guardrails', {}, { missionId: null })
      return `Active guardrails — ${result.summary}`
    }
  },
  {
    test: /\b(remember|memory|lesson|learned|ingat|pelajaran)\b/i,
    async run(message) {
      const result = await dispatch('recall_memory', { query: message.slice(0, 200) }, { missionId: null })
      return `From memory:\n${result.summary}`
    }
  },
  {
    test: /\b(mode|autonomy|approval)\b/i,
    async run() {
      const s = state.current()
      const info = EXECUTION_MODES.find((m) => m.id === s.mode)
      return `Running in ${info?.label ?? s.mode}. ${info?.blurb ?? ''}`
    }
  },
  {
    test: /\b(network|chain|jaringan)\b/i,
    async run() {
      const s = state.current()
      const evm = findNetwork(s.activeEvmNetworkId)
      const sol = findNetwork(s.activeSolanaNetworkId)
      return `Active networks: ${evm?.label} (${evm?.isMainnet ? 'mainnet' : 'testnet'}) and ${sol?.label} (${sol?.isMainnet ? 'mainnet' : 'testnet'}).`
    }
  },
  {
    test: /\b(swap|transfer|send|buy|sell|trade|kirim|beli|jual)\b/i,
    async run() {
      return [
        'I can read and quote without a model provider, but I will not propose a fund-moving action from pattern matching alone.',
        'Add an API key in Settings to enable the reasoning agent, or use the manual action form on the Wallet screen — either way the safety gate still applies.'
      ].join(' ')
    }
  }
]

export async function respond(userMessage: string): Promise<ChatMessage> {
  const trimmed = userMessage.trim()

  let content: string
  const intent = INTENTS.find((i) => i.test.test(trimmed))
  if (intent) {
    try {
      content = await intent.run(trimmed)
    } catch (err) {
      content = `That lookup failed: ${err instanceof Error ? err.message : String(err)}`
    }
  } else {
    const recalled = await lessons.recall(trimmed, 3)
    content = [
      'No model provider is configured, so I am running the local planner. It answers read-only questions.',
      'Try: "what is my balance", "price of SOL", "quote 0.1 ETH to USDC", "what are my guardrails".',
      recalled.length > 0
        ? `\nRelated lessons:\n${recalled.map((l) => `• ${l.text}`).join('\n')}`
        : ''
    ]
      .filter(Boolean)
      .join(' ')
  }

  return {
    id: newId('msg'),
    role: 'assistant',
    content,
    at: Date.now(),
    offline: true
  }
}
