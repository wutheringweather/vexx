import type { ChatMessage } from '@shared/types'
import { newId } from '../storage/files'
import * as state from '../state'
import * as audit from '../audit/log'
import * as lessons from '../memory/lessons'
import { publicAddresses } from '../vault/keystore'
import { open as openSecret } from '../storage/secret-store'
import { redact } from '../memory/redact'
import { complete, LlmUnavailableError, type LlmConfig, type LlmMessage } from './llm'
import { dispatch, toolDefinitions } from './tools'
import { systemPrompt } from './prompt'
import * as fallback from './fallback'
import { parseDirectBuyCommand } from './commands'

/** Bounds one turn so a looping model cannot spend the operator's credits forever. */
const MAX_TOOL_ROUNDS = 6

export function llmConfig(): LlmConfig {
  const s = state.current()
  return {
    baseUrl: s.llm.baseUrl,
    model: s.llm.model,
    apiKey: openSecret(s.llm.apiKeyCipher),
    temperature: s.llm.temperature,
    maxTokens: s.llm.maxTokens
  }
}

export function hasProvider(): boolean {
  return Boolean(openSecret(state.current().llm.apiKeyCipher))
}

export interface TurnResult {
  messages: ChatMessage[]
  /** Action ids created during this turn, so the UI can jump to Approvals. */
  actionIds: string[]
}

/**
 * One agent turn: think, optionally call tools, answer.
 *
 * `history` is the visible conversation. Tool traffic is rebuilt each turn
 * rather than persisted, which keeps the transcript readable and keeps stale
 * tool output from being replayed as if it were current.
 */
export async function runTurn(
  userMessage: string,
  history: ChatMessage[],
  missionId: string | null = null,
  missionObjective?: string
): Promise<TurnResult> {
  const s = await state.load()

  const directBuy = parseDirectBuyCommand(userMessage)
  if (directBuy) {
    const result = await dispatch(
      'propose_buy',
      {
        networkId: directBuy.networkId ?? s.activeSolanaNetworkId,
        buySymbol: directBuy.buySymbol,
        buyAmount: directBuy.buyAmount,
        sellSymbol: directBuy.sellSymbol,
        rationale: `Direct command: ${userMessage.trim()}`
      },
      { missionId }
    )
    await audit.record('agent', 'Direct buy command processed', {
      command: userMessage,
      actionId: result.actionId ?? null,
      summary: result.summary
    })
    const toolMessage: ChatMessage = {
      id: newId('msg'),
      role: 'tool',
      content: result.summary,
      at: Date.now(),
      toolName: 'propose_buy',
      ...(result.actionId ? { actionId: result.actionId } : {}),
      offline: !hasProvider()
    }
    const assistantMessage: ChatMessage = {
      id: newId('msg'),
      role: 'assistant',
      content: result.summary,
      at: Date.now(),
      offline: !hasProvider()
    }
    return { messages: [assistantMessage, toolMessage], actionIds: result.actionId ? [result.actionId] : [] }
  }

  if (!hasProvider()) {
    const reply = await fallback.respond(userMessage)
    return { messages: [reply], actionIds: [] }
  }

  const recalled = await lessons.recall(userMessage, 6)
  const conversation: LlmMessage[] = [
    {
      role: 'system',
      content: systemPrompt({
        mode: s.mode,
        policy: s.policy,
        evmNetworkId: s.activeEvmNetworkId,
        solanaNetworkId: s.activeSolanaNetworkId,
        addresses: publicAddresses(),
        lessons: recalled,
        missionObjective
      })
    },
    ...history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-12)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: userMessage }
  ]

  const emitted: ChatMessage[] = []
  const actionIds: string[] = []
  const tools = toolDefinitions()

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let reply
    try {
      reply = await complete(llmConfig(), conversation, tools)
    } catch (err) {
      if (err instanceof LlmUnavailableError) {
        await audit.record('agent', 'Model provider unavailable, using local planner', {
          detail: err.message
        })
        const offline = await fallback.respond(userMessage)
        emitted.push({
          id: newId('msg'),
          role: 'assistant',
          content: `The model provider is unavailable (${err.message}) — answering with the local planner instead.`,
          at: Date.now(),
          offline: true
        })
        emitted.push(offline)
        return { messages: emitted, actionIds }
      }
      throw err
    }

    if (reply.content) {
      emitted.push({
        id: newId('msg'),
        role: 'assistant',
        content: reply.content,
        at: Date.now()
      })
    }

    if (reply.toolCalls.length === 0) {
      await audit.record('agent', 'Agent turn completed', {
        rounds: round + 1,
        actionIds
      })
      return { messages: emitted, actionIds }
    }

    conversation.push(
      reply.raw ?? { role: 'assistant', content: reply.content }
    )

    for (const call of reply.toolCalls) {
      const result = await dispatch(call.name, call.args, { missionId })

      await audit.record('agent', `Tool ${call.name}`, {
        tool: call.name,
        args: call.args,
        summary: result.summary
      })

      emitted.push({
        id: newId('msg'),
        role: 'tool',
        content: result.summary,
        at: Date.now(),
        toolName: call.name,
        ...(result.actionId ? { actionId: result.actionId } : {})
      })

      if (result.actionId) actionIds.push(result.actionId)

      conversation.push({
        role: 'tool',
        tool_call_id: call.id,
        // Redact again on the way back into the prompt: tool output is the most
        // likely place for an address or key to sneak into model context.
        content: redact(JSON.stringify({ summary: result.summary, data: result.data })).slice(0, 4000)
      })
    }
  }

  emitted.push({
    id: newId('msg'),
    role: 'assistant',
    content: `Stopped after ${MAX_TOOL_ROUNDS} tool rounds without reaching a conclusion. Narrow the request and try again.`,
    at: Date.now()
  })
  await audit.record('agent', 'Agent turn hit the tool-round limit', { rounds: MAX_TOOL_ROUNDS })
  return { messages: emitted, actionIds }
}
