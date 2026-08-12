/**
 * The VexDesk model endpoint.
 *
 * VexDesk desktop speaks the OpenAI chat-completions dialect, so this is a
 * narrow forwarder rather than an API of its own: it authenticates the caller,
 * meters them, swaps in the real provider credential and streams the answer
 * back untouched.
 *
 * Two rules it exists to enforce, and neither can move into the desktop app:
 *   1. The provider key never leaves this server. Anything shipped inside an
 *      installer can be extracted from it, whatever it is sealed with.
 *   2. One access key cannot spend everyone else's budget.
 *
 * It deliberately never logs a request or response body. The prompts carry the
 * operator's portfolio reasoning, and a log line is the easiest way to end up
 * holding data you promised not to keep.
 */

export const config = { runtime: 'edge' }

const UPSTREAM_BASE_URL = process.env.UPSTREAM_BASE_URL ?? 'https://ai.megallm.io/v1'
const UPSTREAM_API_KEY = process.env.UPSTREAM_API_KEY
const KV_URL = process.env.KV_REST_API_URL
const KV_TOKEN = process.env.KV_REST_API_TOKEN

/** Models a caller is allowed to ask for. Anything else is refused. */
const ALLOWED_MODELS = (process.env.ALLOWED_MODELS ?? 'openai-gpt-oss-120b')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean)

/** Ceiling applied whatever the caller asked for, so one request cannot bill like a hundred. */
const MAX_TOKENS_CEILING = Number(process.env.MAX_TOKENS_CEILING ?? 2000)

/** Calls per access key per UTC day. A single mission can spend 72 of these. */
const DAILY_CALL_LIMIT = Number(process.env.DAILY_CALL_LIMIT ?? 500)

interface ErrorShape {
  error: { message: string; type: string }
}

function fail(status: number, message: string, type: string): Response {
  const body: ErrorShape = { error: { message, type } }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function bearer(req: Request): string | null {
  const header = req.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1]!.trim() : null
}

/**
 * Access keys are stored as a SHA-256 hex digest, never in the clear: a leaked
 * database dump should not be a set of working credentials.
 */
async function digest(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function kv(command: string[]): Promise<unknown> {
  if (!KV_URL || !KV_TOKEN) throw new Error('Key store is not configured.')
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${KV_TOKEN}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(command)
  })
  if (!res.ok) throw new Error(`Key store returned ${res.status}`)
  const payload = (await res.json()) as { result?: unknown }
  return payload.result ?? null
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Counts this call and reports the running total. INCR before the upstream call
 * rather than after: a request that fails upstream has still consumed capacity,
 * and counting only successes is how a retry loop drains a budget for free.
 */
async function spendQuota(keyHash: string): Promise<number> {
  const counter = `vexdesk:calls:${keyHash}:${utcDay()}`
  const used = Number(await kv(['INCR', counter]))
  if (used === 1) await kv(['EXPIRE', counter, '172800'])
  return used
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return fail(405, 'This endpoint accepts POST.', 'method_not_allowed')
  }
  if (!UPSTREAM_API_KEY) {
    return fail(500, 'The endpoint is not configured.', 'server_misconfigured')
  }

  const token = bearer(req)
  if (!token) {
    return fail(401, 'Missing access key. Add it in VexDesk under Settings.', 'missing_key')
  }

  let keyHash: string
  let used: number
  try {
    keyHash = await digest(token)
    const active = await kv(['GET', `vexdesk:key:${keyHash}`])
    if (!active) {
      return fail(401, 'That access key is not recognised or has been revoked.', 'invalid_key')
    }
    used = await spendQuota(keyHash)
  } catch {
    return fail(503, 'Could not verify the access key. Try again shortly.', 'key_store_unavailable')
  }

  if (used > DAILY_CALL_LIMIT) {
    return new Response(
      JSON.stringify({
        error: {
          message: `Daily limit of ${DAILY_CALL_LIMIT} requests reached. It resets at 00:00 UTC.`,
          type: 'rate_limited'
        }
      }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '3600',
          'x-vexdesk-daily-limit': String(DAILY_CALL_LIMIT),
          'x-vexdesk-daily-used': String(used)
        }
      }
    )
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return fail(400, 'Body was not valid JSON.', 'invalid_request')
  }

  const model = typeof body.model === 'string' ? body.model : ''
  if (!ALLOWED_MODELS.includes(model)) {
    return fail(400, `Model "${model}" is not available on this endpoint.`, 'model_not_allowed')
  }

  const requested = Number(body.max_tokens)
  const forwarded = {
    ...body,
    max_tokens: Number.isFinite(requested)
      ? Math.min(requested, MAX_TOKENS_CEILING)
      : MAX_TOKENS_CEILING
  }

  let upstream: Response
  try {
    upstream = await fetch(`${UPSTREAM_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${UPSTREAM_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(forwarded)
    })
  } catch {
    return fail(502, 'The model provider could not be reached.', 'upstream_unreachable')
  }

  // Streamed straight through. Buffering here would mean holding a prompt and
  // its answer in memory for no reason, and would break long completions.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
      'x-vexdesk-daily-limit': String(DAILY_CALL_LIMIT),
      'x-vexdesk-daily-used': String(used)
    }
  })
}
