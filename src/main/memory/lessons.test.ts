import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEMORY_HALF_LIFE_MS } from '@shared/constants'
import {
  all,
  backfillVectors,
  clear,
  coverage,
  effectiveStrength,
  forget,
  recall,
  remember,
  resetCacheForTests,
  setEmbeddingConfigResolver
} from './lessons'

describe('lesson memory', () => {
  beforeEach(async () => {
    resetCacheForTests()
    await clear()
  })

  it('halves strength every 30 days', () => {
    const now = Date.now()
    const lesson = {
      id: 'x',
      tier: 'semantic' as const,
      text: 'anything',
      tags: [],
      createdAt: now,
      lastReinforcedAt: now,
      baseStrength: 1
    }
    expect(effectiveStrength(lesson, now)).toBeCloseTo(1, 5)
    expect(effectiveStrength(lesson, now + MEMORY_HALF_LIFE_MS)).toBeCloseTo(0.5, 5)
    expect(effectiveStrength(lesson, now + MEMORY_HALF_LIFE_MS * 2)).toBeCloseTo(0.25, 5)
  })

  it('stores a lesson and recalls it by topic', async () => {
    await remember('procedural', 'Sepolia RPC endpoints time out under load, retry once', ['rpc'])
    const hits = await recall('sepolia rpc timeout')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.text).toContain('Sepolia')
  })

  it('reinforces a near-duplicate instead of storing it twice', async () => {
    await remember('procedural', 'Swaps above 100 bps of slippage get blocked by the gate')
    await remember('procedural', 'Swaps above 100 bps of slippage get blocked by the gate again')
    const lessons = await all()
    expect(lessons.length).toBe(1)
  })

  it('keeps genuinely different lessons apart', async () => {
    await remember('semantic', 'ETH gas on Sepolia is negligible')
    await remember('episodic', 'The operator rejected a transfer to an unknown address')
    expect((await all()).length).toBe(2)
  })

  it('strips secrets before writing a lesson', async () => {
    const key = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318'
    await remember('episodic', `Signed using ${key} which should never be stored`)
    const stored = await all()
    expect(stored[0]!.text).not.toContain(key)
    expect(stored[0]!.text).toContain('[redacted]')
  })

  it('forgets a specific lesson on request', async () => {
    const lesson = await remember('semantic', 'Base Sepolia is cheaper than Ethereum Sepolia')
    await forget(lesson.id)
    expect((await all()).length).toBe(0)
  })

  it('stores no vectors while semantic memory is off', async () => {
    await remember('semantic', 'Gas on Base Sepolia is negligible')
    expect(await coverage()).toEqual({ total: 1, embedded: 0 })
  })
})

/**
 * Semantic recall is the one path that talks to a provider, so these drive it
 * through a stubbed embeddings endpoint rather than the network.
 */
describe('semantic recall', () => {
  /** Deterministic stand-in for an embedding: a bag-of-words vector. */
  const VOCAB = ['gas', 'fee', 'cheap', 'slippage', 'swap', 'refused']
  function fakeVector(text: string): number[] {
    const lower = text.toLowerCase()
    return VOCAB.map((word) => (lower.includes(word) ? 1 : 0))
  }

  beforeEach(async () => {
    resetCacheForTests()
    await clear()

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const { input } = JSON.parse(init.body) as { input: string[] }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: input.map((text, index) => ({ index, embedding: fakeVector(text) }))
          })
        }
      })
    )
    setEmbeddingConfigResolver(() => ({
      baseUrl: 'https://example.test/v1',
      apiKey: 'sk-test',
      model: 'embed-1'
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetCacheForTests()
  })

  it('embeds a lesson when semantic memory is enabled', async () => {
    await remember('semantic', 'Transaction fee on this chain is cheap')
    expect(await coverage()).toEqual({ total: 1, embedded: 1 })
  })

  it('recalls by meaning when the wording does not overlap', async () => {
    await remember('semantic', 'Transaction fee here is cheap')
    await remember('procedural', 'A swap was refused for slippage')

    // "gas" shares no words with the fee lesson, but shares vector dimensions.
    const hits = await recall('gas cheap')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.text).toContain('fee')
  })

  it('falls back to lexical recall when the provider fails', async () => {
    await remember('semantic', 'Sepolia RPC endpoints rate limit under load')

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    const hits = await recall('sepolia rpc endpoints rate limit')
    expect(hits.length).toBeGreaterThan(0)
  })

  it('backfills vectors for lessons stored before it was switched on', async () => {
    setEmbeddingConfigResolver(() => null)
    await remember('semantic', 'Slippage above the cap gets refused')
    expect((await coverage()).embedded).toBe(0)

    setEmbeddingConfigResolver(() => ({
      baseUrl: 'https://example.test/v1',
      apiKey: 'sk-test',
      model: 'embed-1'
    }))
    expect(await backfillVectors()).toEqual({ embedded: 1, failed: 0 })
    expect((await coverage()).embedded).toBe(1)
  })

  it('keeps vectors out of what the UI receives', async () => {
    await remember('semantic', 'Gas is cheap right now')
    const lessons = await all()
    expect(lessons[0]).not.toHaveProperty('vector')
  })
})
