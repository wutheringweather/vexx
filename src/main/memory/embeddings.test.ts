import { afterEach, describe, expect, it, vi } from 'vitest'
import { cosine, embed, EmbeddingsUnavailableError, probe } from './embeddings'

const CONFIG = { baseUrl: 'https://example.test/v1', apiKey: 'sk-test-key', model: 'embed-1' }

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    }))
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cosine similarity', () => {
  it('maps identical vectors to 1', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6)
  })

  it('maps opposed vectors to 0', () => {
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(0, 6)
  })

  it('maps orthogonal vectors to the midpoint', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0.5, 6)
  })

  it('is scale invariant', () => {
    expect(cosine([1, 2, 3], [10, 20, 30])).toBeCloseTo(1, 6)
  })

  it('returns 0 rather than NaN for a zero vector', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0)
  })

  it('returns 0 for mismatched dimensions instead of throwing', () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0)
  })
})

describe('embeddings client', () => {
  it('refuses to call without an API key', async () => {
    await expect(embed({ ...CONFIG, apiKey: null }, ['x'])).rejects.toThrow(
      EmbeddingsUnavailableError
    )
  })

  it('returns an empty array for no input without calling out', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await embed(CONFIG, [])).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns one vector per input', async () => {
    mockFetch(200, {
      data: [
        { index: 0, embedding: [0.1, 0.2] },
        { index: 1, embedding: [0.3, 0.4] }
      ]
    })
    expect(await embed(CONFIG, ['a', 'b'])).toEqual([
      [0.1, 0.2],
      [0.3, 0.4]
    ])
  })

  it('restores request order when the provider returns rows shuffled', async () => {
    mockFetch(200, {
      data: [
        { index: 1, embedding: [9, 9] },
        { index: 0, embedding: [1, 1] }
      ]
    })
    expect(await embed(CONFIG, ['first', 'second'])).toEqual([
      [1, 1],
      [9, 9]
    ])
  })

  it('reports a missing endpoint plainly on 404', async () => {
    mockFetch(404, {})
    await expect(embed(CONFIG, ['x'])).rejects.toThrow(/no \/embeddings endpoint/i)
  })

  it('throws when the provider returns the wrong number of vectors', async () => {
    mockFetch(200, { data: [{ index: 0, embedding: [1] }] })
    await expect(embed(CONFIG, ['a', 'b'])).rejects.toThrow(/Expected 2 vectors/)
  })

  it('throws on a malformed embedding rather than storing junk', async () => {
    mockFetch(200, { data: [{ index: 0, embedding: [] }] })
    await expect(embed(CONFIG, ['a'])).rejects.toThrow(/malformed/i)
  })

  it('redacts secrets out of the request body', async () => {
    // Typed parameters so the assertion below can read the request body off the
    // recorded call rather than inferring an empty argument tuple.
    const spy = vi.fn(async (url: string, init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ index: 0, embedding: [1, 2] }] })
    }))
    vi.stubGlobal('fetch', spy)

    const key = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318'
    await embed(CONFIG, [`the key is ${key}`])

    const body = String(spy.mock.calls[0]![1].body)
    expect(body).not.toContain(key)
    expect(body).toContain('[redacted]')
  })

  it('reports failure from probe instead of throwing', async () => {
    mockFetch(500, { error: { message: 'boom' } })
    const result = await probe(CONFIG)
    expect(result.ok).toBe(false)
    expect(result.dimensions).toBeNull()
  })

  it('reports dimensions from a successful probe', async () => {
    mockFetch(200, { data: [{ index: 0, embedding: [1, 2, 3, 4] }] })
    const result = await probe(CONFIG)
    expect(result.ok).toBe(true)
    expect(result.dimensions).toBe(4)
  })
})
