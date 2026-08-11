import { redact } from './redact'

/**
 * Semantic recall via an OpenAI-compatible /embeddings endpoint.
 *
 * This is the one feature that sends memory text off the machine, so it is
 * opt-in and off by default. Everything else in VexDesk stays local, and when
 * this is disabled or the provider has no embeddings endpoint, recall falls
 * back to lexical matching rather than failing.
 *
 * Vectors live next to the lessons in plain JSON — no Postgres, no pgvector,
 * no native module. At local scale (a few hundred lessons) a brute-force
 * cosine scan is microseconds, and an index would be pure overhead.
 */

export interface EmbeddingConfig {
  baseUrl: string
  apiKey: string | null
  model: string
}

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[]; index?: number }>
  error?: { message?: string }
}

export class EmbeddingsUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmbeddingsUnavailableError'
  }
}

/**
 * Returns one vector per input, or throws EmbeddingsUnavailableError. Callers
 * treat a throw as "carry on lexically", never as a hard failure.
 */
export async function embed(config: EmbeddingConfig, texts: string[]): Promise<number[][]> {
  if (!config.apiKey) throw new EmbeddingsUnavailableError('No API key configured.')
  if (texts.length === 0) return []

  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/embeddings`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      // Redact before sending: a lesson should never carry a secret anyway,
      // but this is the last point where one could leave the machine.
      body: JSON.stringify({ model: config.model, input: texts.map((t) => redact(t)) }),
      signal: controller.signal
    })
  } catch (err) {
    throw new EmbeddingsUnavailableError(
      err instanceof Error && err.name === 'AbortError'
        ? 'The embeddings endpoint timed out.'
        : `Could not reach the embeddings endpoint: ${err instanceof Error ? err.message : String(err)}`
    )
  } finally {
    clearTimeout(timeout)
  }

  const payload = (await response.json().catch(() => ({}))) as EmbeddingResponse

  if (!response.ok) {
    throw new EmbeddingsUnavailableError(
      redact(
        payload.error?.message ??
          (response.status === 404
            ? 'This provider has no /embeddings endpoint.'
            : `Embeddings request returned ${response.status}.`)
      )
    )
  }

  const rows = payload.data ?? []
  if (rows.length !== texts.length) {
    throw new EmbeddingsUnavailableError(
      `Expected ${texts.length} vectors, provider returned ${rows.length}.`
    )
  }

  // Preserve request order: the spec allows results to come back out of order.
  const ordered = [...rows].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  const vectors = ordered.map((row) => row.embedding)

  if (vectors.some((v) => !Array.isArray(v) || v.length === 0)) {
    throw new EmbeddingsUnavailableError('Provider returned a malformed embedding.')
  }
  return vectors as number[][]
}

/** Cosine similarity, mapped from [-1,1] into [0,1] so it composes with lexical scores. */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number
    const y = b[i] as number
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  const raw = dot / (Math.sqrt(normA) * Math.sqrt(normB))
  return (Math.max(-1, Math.min(1, raw)) + 1) / 2
}

export interface EmbeddingProbe {
  ok: boolean
  model: string
  dimensions: number | null
  latencyMs: number
  detail: string
}

export async function probe(config: EmbeddingConfig): Promise<EmbeddingProbe> {
  const started = Date.now()
  try {
    const [vector] = await embed(config, ['vexdesk embedding probe'])
    return {
      ok: true,
      model: config.model,
      dimensions: vector?.length ?? null,
      latencyMs: Date.now() - started,
      detail: `Returned a ${vector?.length ?? 0}-dimension vector.`
    }
  } catch (err) {
    return {
      ok: false,
      model: config.model,
      dimensions: null,
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err)
    }
  }
}
