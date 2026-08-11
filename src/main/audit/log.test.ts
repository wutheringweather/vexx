import { describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { dataPath } from '../storage/files'
import { list, record, resetCacheForTests, verify } from './log'

describe('audit log', () => {
  it('appends entries with a linked hash chain', async () => {
    const first = await record('system', 'first entry', { a: 1 })
    const second = await record('gate', 'second entry', { b: 2 })

    expect(second.seq).toBe(first.seq + 1)
    expect(second.prevHash).toBe(first.hash)
    expect((await verify()).ok).toBe(true)
  })

  it('keeps sequence numbers unique under concurrent writes', async () => {
    const written = await Promise.all(
      Array.from({ length: 12 }, (_, i) => record('system', `concurrent ${i}`))
    )
    const seqs = written.map((e) => e.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
    expect((await verify()).ok).toBe(true)
  })

  it('redacts secrets before they reach disk', async () => {
    const key = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318'
    await record('execution', `signed with ${key}`, { privateKey: key, networkId: 'eth-sepolia' })

    const raw = await readFile(dataPath('audit.jsonl'), 'utf8')
    expect(raw).not.toContain(key)
    expect(raw).toContain('eth-sepolia')
  })

  it('reports the exact entry where the chain was tampered with', async () => {
    await record('system', 'before tamper')
    const target = await record('system', 'this line gets edited')
    await record('system', 'after tamper')

    const path = dataPath('audit.jsonl')
    const lines = (await readFile(path, 'utf8')).trim().split('\n')
    const edited = lines.map((line) => {
      const entry = JSON.parse(line)
      return entry.seq === target.seq
        ? JSON.stringify({ ...entry, summary: 'a quietly different story' })
        : line
    })
    await writeFile(path, `${edited.join('\n')}\n`, 'utf8')

    resetCacheForTests()
    const result = await verify()
    expect(result.ok).toBe(false)
    expect(result.brokenAtSeq).toBe(target.seq)
  })

  it('returns newest entries first', async () => {
    await record('system', 'older')
    await record('system', 'newest')
    const entries = await list(5)
    expect(entries[0]!.summary).toBe('newest')
  })
})
