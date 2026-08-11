/**
 * Last line of defence before anything is written to disk or sent to an LLM.
 *
 * The agent runtime handles mnemonics, private keys and API keys. A stray
 * template string or a verbose error is all it would take to leak one into the
 * audit log. Everything on those paths goes through `redact` first.
 */

const PLACEHOLDER = '[redacted]'

const PATTERNS: Array<{ re: RegExp; label: string }> = [
  // 12/15/18/21/24-word BIP-39 phrases.
  { re: /\b(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/gi, label: 'mnemonic' },
  // 0x-prefixed 32-byte private keys. Checked before generic hex so it wins.
  { re: /\b0x[a-fA-F0-9]{64}\b/g, label: 'private-key' },
  // Bare 64-char hex.
  { re: /\b[a-fA-F0-9]{64}\b/g, label: 'hex-secret' },
  // Solana secret keys serialised as a byte array.
  { re: /\[(?:\s*\d{1,3}\s*,){31,}\s*\d{1,3}\s*\]/g, label: 'secret-bytes' },
  // Common API-key shapes, including MegaLLM/OpenAI-style tokens.
  { re: /\bsk-[A-Za-z0-9_-]{16,}\b/g, label: 'api-key' },
  { re: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi, label: 'bearer-token' }
]

/** Keys whose values are dropped wholesale, whatever they look like. */
const SENSITIVE_KEYS = new Set([
  'mnemonic',
  'seed',
  'seedphrase',
  'privatekey',
  'private_key',
  'privkey',
  'secretkey',
  'secret_key',
  'secret',
  'password',
  'passphrase',
  'apikey',
  'api_key',
  'authorization',
  'token'
])

function redactString(input: string): string {
  let out = input
  for (const { re } of PATTERNS) {
    out = out.replace(re, PLACEHOLDER)
  }
  return out
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return PLACEHOLDER as unknown as T
  if (typeof value === 'string') return redactString(value) as unknown as T
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T

  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase().replace(/[^a-z_]/g, ''))
      ? PLACEHOLDER
      : redact(val, depth + 1)
  }
  return out as unknown as T
}

/** True when a string still contains something that looks like a secret. */
export function containsSecret(input: string): boolean {
  return PATTERNS.some(({ re }) => {
    re.lastIndex = 0
    return re.test(input)
  })
}
