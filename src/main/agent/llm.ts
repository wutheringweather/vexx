import type { LlmProbeResult } from '@shared/types'
import { redact } from '../memory/redact'

/**
 * MegaLLM speaks the OpenAI chat-completions dialect, so this client is
 * provider-agnostic: point `baseUrl` at any OpenAI-compatible endpoint.
 */

export interface LlmToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

export interface LlmConfig {
  baseUrl: string
  model: string
  apiKey: string | null
  temperature: number
  maxTokens: number
}

export interface LlmToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface LlmReply {
  content: string
  toolCalls: LlmToolCall[]
  raw: LlmMessage | null
}

interface OpenAiCompatibleMessage {
  role?: string
  content?: string | Array<{ type?: string; text?: string }>
  tool_calls?: Array<{
    id?: string
    type?: string
    function?: { name?: string; arguments?: string }
  }>
}

interface OpenAiCompatibleResponse {
  choices?: Array<{ message?: OpenAiCompatibleMessage }>
  error?: { message?: string; type?: string }
}

export class LlmUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmUnavailableError'
  }
}

function readContent(message: OpenAiCompatibleMessage | undefined): string {
  const content = message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim()
  }
  return ''
}

function parseToolCalls(message: OpenAiCompatibleMessage | undefined): LlmToolCall[] {
  const calls = message?.tool_calls ?? []
  const out: LlmToolCall[] = []
  for (const call of calls) {
    const name = call.function?.name
    if (!name) continue
    let args: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(call.function?.arguments || '{}')
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>
      }
    } catch {
      // A model that emits malformed JSON gets an empty argument set, and the
      // tool layer rejects it rather than guessing what was meant.
    }
    out.push({ id: call.id || `call_${out.length}`, name, args })
  }
  return out
}

export async function complete(
  config: LlmConfig,
  messages: LlmMessage[],
  tools: LlmToolDef[] = [],
  signal?: AbortSignal
): Promise<LlmReply> {
  if (!config.apiKey) {
    throw new LlmUnavailableError('No API key configured for the model provider.')
  }

  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: config.temperature,
    max_tokens: config.maxTokens
  }
  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters }
    }))
    body.tool_choice = 'auto'
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 90_000)
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true })

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
  } catch (err) {
    throw new LlmUnavailableError(
      err instanceof Error && err.name === 'AbortError'
        ? 'The model provider timed out.'
        : `Could not reach the model provider: ${err instanceof Error ? err.message : String(err)}`
    )
  } finally {
    clearTimeout(timeout)
  }

  const payload = (await response.json().catch(() => ({}))) as OpenAiCompatibleResponse

  if (!response.ok) {
    const detail =
      payload.error?.message ||
      (response.status === 401
        ? 'Provider rejected the API key (401). Check the key in Settings.'
        : `Provider returned ${response.status}.`)
    // Redact in case the provider echoed the key back in its error.
    throw new LlmUnavailableError(redact(detail))
  }

  const message = payload.choices?.[0]?.message
  const content = readContent(message)
  const toolCalls = parseToolCalls(message)

  if (!content && toolCalls.length === 0) {
    throw new LlmUnavailableError('The provider returned an empty reply.')
  }

  return {
    content,
    toolCalls,
    raw: message
      ? {
          role: 'assistant',
          content,
          ...(message.tool_calls?.length
            ? {
                tool_calls: message.tool_calls.map((c, i) => ({
                  id: c.id || `call_${i}`,
                  type: 'function' as const,
                  function: {
                    name: c.function?.name ?? '',
                    arguments: c.function?.arguments ?? '{}'
                  }
                }))
              }
            : {})
        }
      : null
  }
}

export async function probe(config: LlmConfig): Promise<LlmProbeResult> {
  const started = Date.now()
  try {
    const reply = await complete(config, [
      { role: 'system', content: 'Reply with the single word: ready' },
      { role: 'user', content: 'ping' }
    ])
    return {
      ok: true,
      model: config.model,
      latencyMs: Date.now() - started,
      detail: reply.content.slice(0, 120) || 'Responded.'
    }
  } catch (err) {
    return {
      ok: false,
      model: config.model,
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err)
    }
  }
}
