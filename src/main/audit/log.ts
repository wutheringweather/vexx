import type { AuditEntry, AuditKind, AuditVerification } from '@shared/types'
import { appendJsonl, dataPath, readJsonl, sha256 } from '../storage/files'
import { redact } from '../memory/redact'

const AUDIT_FILE = 'audit.jsonl'
const GENESIS = '0'.repeat(64)

let cache: AuditEntry[] | null = null
let writeChain: Promise<void> = Promise.resolve()

function auditPath(): string {
  return dataPath(AUDIT_FILE)
}

/**
 * Hash over the entry body plus the previous hash. Any edit to a past line
 * breaks every hash after it, which `verify` reports with the exact sequence
 * number. This is tamper-evidence, not tamper-proofing — a local file can
 * always be deleted, but it cannot be quietly rewritten.
 */
function computeHash(entry: Omit<AuditEntry, 'hash'>): string {
  const body = JSON.stringify({
    seq: entry.seq,
    at: entry.at,
    kind: entry.kind,
    summary: entry.summary,
    detail: entry.detail,
    prevHash: entry.prevHash
  })
  return sha256(body)
}

async function loadAll(): Promise<AuditEntry[]> {
  if (!cache) cache = await readJsonl<AuditEntry>(auditPath())
  return cache
}

export async function record(
  kind: AuditKind,
  summary: string,
  detail: Record<string, unknown> = {}
): Promise<AuditEntry> {
  // Serialise writes so two concurrent callers cannot claim the same seq.
  let resolveOuter!: (entry: AuditEntry) => void
  let rejectOuter!: (err: unknown) => void
  const result = new Promise<AuditEntry>((res, rej) => {
    resolveOuter = res
    rejectOuter = rej
  })

  writeChain = writeChain.then(async () => {
    try {
      const entries = await loadAll()
      const prev = entries[entries.length - 1]
      const base: Omit<AuditEntry, 'hash'> = {
        seq: prev ? prev.seq + 1 : 1,
        at: Date.now(),
        kind,
        summary: redact(summary),
        // Secrets must never reach disk, not even inside a debug field.
        detail: redact(detail) as Record<string, unknown>,
        prevHash: prev ? prev.hash : GENESIS
      }
      const entry: AuditEntry = { ...base, hash: computeHash(base) }
      await appendJsonl(auditPath(), entry)
      entries.push(entry)
      resolveOuter(entry)
    } catch (err) {
      rejectOuter(err)
    }
  })

  return result
}

export async function list(limit = 250): Promise<AuditEntry[]> {
  const entries = await loadAll()
  return entries.slice(-limit).reverse()
}

export async function verify(): Promise<AuditVerification> {
  const entries = await loadAll()
  let prevHash = GENESIS
  for (const entry of entries) {
    const expected = computeHash({ ...entry, prevHash })
    if (entry.prevHash !== prevHash || entry.hash !== expected) {
      return { ok: false, entries: entries.length, brokenAtSeq: entry.seq }
    }
    prevHash = entry.hash
  }
  return { ok: true, entries: entries.length, brokenAtSeq: null }
}

export function resetCacheForTests(): void {
  cache = null
}
