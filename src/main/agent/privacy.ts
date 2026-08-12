/**
 * Keeps wallet addresses out of anything sent to a model provider.
 *
 * `redact` next door strips secrets — mnemonics, private keys, API tokens. A
 * public address is not a secret, and the audit log is right to keep it. But a
 * hosted provider is a different threat model: an address plus a balance is a
 * durable identifier for the person holding it, and the operator never agreed
 * to hand that to a third party just by asking the agent a question.
 *
 * Nothing here is load-bearing for correctness. The agent never needs its own
 * address — signing happens in main, from the vault, whatever the model thinks.
 * Transfer destinations are the one case the agent does need, so those become
 * aliases it can quote back and main resolves before the gate ever sees them.
 */

const ADDRESS_KEYS = new Set([
  'address',
  'addresses',
  'from',
  'to',
  'owner',
  'payer',
  // Policy carries these as plain arrays of addresses.
  'transferallowlist'
])

/** `0x9858EfFD…Eda94` — enough to recognise, not enough to look up. */
export function maskAddress(address: string): string {
  const value = address.trim()
  if (value.length <= 14) return value
  return `${value.slice(0, 8)}…${value.slice(-5)}`
}

/**
 * Recursively masks address-shaped fields. Used on tool output before it is
 * appended to the model conversation.
 */
export function maskAddresses<T>(value: T, depth = 0): T {
  if (depth > 8) return value
  if (typeof value === 'string') return value as unknown as T
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => maskAddresses(v, depth + 1)) as unknown as T

  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = ADDRESS_KEYS.has(key.toLowerCase())
      ? maskEveryString(val, depth + 1)
      : maskAddresses(val, depth + 1)
  }
  return out as unknown as T
}

/**
 * Once a key says "this holds addresses", every string underneath it is one —
 * whether it arrived as a bare string, an array like the transfer allowlist, or
 * an object like `{ evm, solana }` whose own keys give nothing away.
 */
function maskEveryString<T>(value: T, depth = 0): T {
  if (depth > 8) return value
  if (typeof value === 'string') return maskAddress(value) as unknown as T
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => maskEveryString(v, depth + 1)) as unknown as T

  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = maskEveryString(val, depth + 1)
  }
  return out as unknown as T
}

export const TRANSFER_ALIAS_PREFIX = 'allowlist:'

/**
 * How a destination is shown to the model: an alias it can quote, plus a masked
 * address so the operator reading the transcript can still tell them apart.
 */
export function describeTransferAllowlist(allowlist: string[]): string {
  if (allowlist.length === 0) return 'none — every transfer will be refused'
  return allowlist
    .map((addr, i) => `${TRANSFER_ALIAS_PREFIX}${i + 1} (${maskAddress(addr)})`)
    .join(', ')
}

/**
 * Turns `allowlist:2` back into the address it stands for. Anything else is
 * passed through untouched, so an operator-typed address still works and an
 * unknown alias reaches the gate as-is and is refused there rather than here.
 */
export function resolveTransferAlias(value: string, allowlist: string[]): string {
  const trimmed = value.trim()
  if (!trimmed.toLowerCase().startsWith(TRANSFER_ALIAS_PREFIX)) return trimmed

  const index = Number(trimmed.slice(TRANSFER_ALIAS_PREFIX.length))
  if (!Number.isInteger(index) || index < 1 || index > allowlist.length) return trimmed
  return allowlist[index - 1]!
}
