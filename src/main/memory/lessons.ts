import type { Lesson, MemoryTier } from '@shared/types'
import { MEMORY_HALF_LIFE_MS } from '@shared/constants'
import { dataPath, newId, readJson, writeJsonAtomic } from '../storage/files'
import { redact } from './redact'
import { cosine, embed, type EmbeddingConfig } from './embeddings'

const LESSONS_FILE = 'lessons.json'
const MAX_LESSONS = 500
/** Below this a lesson is no longer worth recalling and gets pruned. */
const FORGET_THRESHOLD = 0.05

interface StoredLesson extends Omit<Lesson, 'strength'> {
  /** Present only when semantic memory is enabled and the provider answered. */
  vector?: number[]
}

let cache: StoredLesson[] | null = null

/**
 * Supplied by the runtime so this module stays independent of app state — and
 * so tests can exercise memory without a provider. Returning null means
 * "semantic memory is off", which is the default.
 */
type ConfigResolver = () => EmbeddingConfig | null
let resolveConfig: ConfigResolver = () => null

export function setEmbeddingConfigResolver(resolver: ConfigResolver): void {
  resolveConfig = resolver
}

function path(): string {
  return dataPath(LESSONS_FILE)
}

async function load(): Promise<StoredLesson[]> {
  if (!cache) cache = await readJson<StoredLesson[]>(path(), [])
  return cache
}

async function persist(): Promise<void> {
  await writeJsonAtomic(path(), cache ?? [])
}

/**
 * Exponential decay with a 30-day half-life: a lesson learned today is worth
 * 1.0, the same lesson a month later is worth 0.5, two months later 0.25.
 * Reinforcing it resets the clock and pushes the base strength up.
 */
export function effectiveStrength(lesson: Omit<StoredLesson, 'vector'>, now = Date.now()): number {
  const elapsed = Math.max(0, now - lesson.lastReinforcedAt)
  return lesson.baseStrength * Math.pow(0.5, elapsed / MEMORY_HALF_LIFE_MS)
}

function hydrate(stored: StoredLesson, now = Date.now()): Lesson {
  // The vector stays in main — it is large and the UI has no use for it.
  const { vector: _vector, ...rest } = stored
  return { ...rest, strength: Number(effectiveStrength(stored, now).toFixed(4)) }
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

function lexical(a: string, b: string): number {
  const setA = new Set(normalise(a).split(' ').filter((w) => w.length > 2))
  const setB = new Set(normalise(b).split(' ').filter((w) => w.length > 2))
  if (setA.size === 0 || setB.size === 0) return 0
  let shared = 0
  for (const word of setA) if (setB.has(word)) shared += 1
  return shared / (setA.size + setB.size - shared)
}

/** Never throws: a provider outage must not stop a lesson being written. */
async function tryEmbed(texts: string[]): Promise<number[][] | null> {
  const config = resolveConfig()
  if (!config) return null
  try {
    return await embed(config, texts)
  } catch {
    return null
  }
}

export async function remember(
  tier: MemoryTier,
  text: string,
  tags: string[] = []
): Promise<Lesson> {
  const lessons = await load()
  // Secrets are stripped before a lesson is ever written.
  const clean = redact(text.trim())
  const now = Date.now()

  // Re-learning something you already know reinforces it instead of duplicating it.
  const existing = lessons.find((l) => l.tier === tier && lexical(l.text, clean) > 0.6)
  if (existing) {
    existing.lastReinforcedAt = now
    existing.baseStrength = Math.min(1, effectiveStrength(existing, now) + 0.35)
    existing.tags = [...new Set([...existing.tags, ...tags])]
    await persist()
    return hydrate(existing, now)
  }

  const lesson: StoredLesson = {
    id: newId('lsn'),
    tier,
    text: clean,
    tags,
    createdAt: now,
    lastReinforcedAt: now,
    baseStrength: 1
  }

  const vectors = await tryEmbed([clean])
  if (vectors?.[0]) lesson.vector = vectors[0]

  lessons.push(lesson)
  await prune()
  await persist()
  return hydrate(lesson, now)
}

async function prune(): Promise<void> {
  const lessons = await load()
  const now = Date.now()
  let kept = lessons.filter((l) => effectiveStrength(l, now) >= FORGET_THRESHOLD)
  if (kept.length > MAX_LESSONS) {
    kept = kept
      .sort((a, b) => effectiveStrength(b, now) - effectiveStrength(a, now))
      .slice(0, MAX_LESSONS)
  }
  cache = kept
}

export async function recall(query: string, limit = 6): Promise<Lesson[]> {
  const lessons = await load()
  const now = Date.now()
  if (lessons.length === 0) return []

  // One embedding call per recall, and only when some lesson has a vector to
  // compare against.
  const haveVectors = lessons.some((l) => l.vector)
  const queryVector = haveVectors ? (await tryEmbed([query]))?.[0] : undefined

  return lessons
    .map((lesson) => {
      const lex = lexical(lesson.text, query)
      const strength = effectiveStrength(lesson, now)
      const semantic =
        queryVector && lesson.vector ? cosine(queryVector, lesson.vector) : null

      // With a vector, meaning leads and wording only nudges. Without one, the
      // original lexical weighting applies unchanged.
      const score =
        semantic === null
          ? lex * 0.7 + strength * 0.3
          : semantic * 0.55 + lex * 0.2 + strength * 0.25

      return { lesson, score, semantic }
    })
    // A semantic hit clears a lower bar than a lexical one, because cosine
    // never returns the near-zero scores that word overlap does.
    .filter((s) => (s.semantic === null ? s.score > 0.05 : s.score > 0.45))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => hydrate(s.lesson, now))
}

export async function all(): Promise<Lesson[]> {
  const lessons = await load()
  const now = Date.now()
  return lessons.map((l) => hydrate(l, now)).sort((a, b) => b.strength - a.strength)
}

export async function forget(id: string): Promise<void> {
  const lessons = await load()
  cache = lessons.filter((l) => l.id !== id)
  await persist()
}

export async function clear(): Promise<void> {
  cache = []
  await persist()
}

/** How much of memory is semantically searchable right now. */
export async function coverage(): Promise<{ total: number; embedded: number }> {
  const lessons = await load()
  return { total: lessons.length, embedded: lessons.filter((l) => l.vector).length }
}

/** Backfills vectors for lessons stored before semantic memory was switched on. */
export async function backfillVectors(): Promise<{ embedded: number; failed: number }> {
  const lessons = await load()
  const missing = lessons.filter((l) => !l.vector)
  if (missing.length === 0) return { embedded: 0, failed: 0 }

  let embedded = 0
  let failed = 0
  // Batched so one long request cannot stall the whole backfill.
  const BATCH = 32
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH)
    const vectors = await tryEmbed(batch.map((l) => l.text))
    if (!vectors) {
      failed += batch.length
      continue
    }
    batch.forEach((lesson, index) => {
      const vector = vectors[index]
      if (vector) {
        lesson.vector = vector
        embedded += 1
      } else {
        failed += 1
      }
    })
  }
  await persist()
  return { embedded, failed }
}

export function resetCacheForTests(): void {
  cache = null
  resolveConfig = () => null
}
