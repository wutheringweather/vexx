export function usd(value: number): string {
  if (!Number.isFinite(value)) return '$0.00'
  const abs = Math.abs(value)
  // Sub-dollar amounts get extra precision, but zero should read as zero
  // rather than as a suspiciously precise $0.0000.
  const digits = abs === 0 ? 2 : abs >= 1000 ? 0 : abs >= 1 ? 2 : 4
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })
}

export function shortAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 2) return address
  return `${address.slice(0, lead)}…${address.slice(-tail)}`
}

export function relativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp
  if (delta < 0) return 'just now'
  const seconds = Math.floor(delta / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

export function clockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function fullTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

export function countdown(target: number): string {
  const remaining = target - Date.now()
  if (remaining <= 0) return 'expired'
  const minutes = Math.floor(remaining / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
