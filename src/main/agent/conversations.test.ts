import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/types'
import { append, clear, create, ensure, get, remove, resetCacheForTests, summaries } from './conversations'

function msg(role: ChatMessage['role'], content: string): ChatMessage {
  return { id: `${role}_${Math.random().toString(36).slice(2)}`, role, content, at: Date.now() }
}

describe('conversation history', () => {
  beforeEach(async () => {
    resetCacheForTests()
    await clear()
  })

  it('persists a thread and reads it back', async () => {
    const thread = await create()
    await append(thread.id, [msg('user', 'what is my balance'), msg('assistant', '0.18 ETH')])

    // Drop the in-memory copy so this reads from disk, not the cache.
    resetCacheForTests()
    const reloaded = await get(thread.id)
    expect(reloaded?.messages).toHaveLength(2)
    expect(reloaded?.messages[1]!.content).toBe('0.18 ETH')
  })

  it('titles a thread from its first user message', async () => {
    const thread = await create()
    await append(thread.id, [msg('user', 'quote 0.05 ETH into USDC')])
    expect((await get(thread.id))?.title).toBe('quote 0.05 ETH into USDC')
  })

  it('truncates a long title rather than breaking the layout', async () => {
    const thread = await create()
    await append(thread.id, [msg('user', 'x'.repeat(200))])
    const title = (await get(thread.id))!.title
    expect(title.length).toBeLessThanOrEqual(53)
    expect(title.endsWith('…')).toBe(true)
  })

  it('strips secrets before a message reaches disk', async () => {
    const key = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318'
    const thread = await create()
    await append(thread.id, [msg('user', `my key is ${key}`)])

    resetCacheForTests()
    const reloaded = await get(thread.id)
    expect(reloaded?.messages[0]!.content).not.toContain(key)
    expect(reloaded?.messages[0]!.content).toContain('[redacted]')
  })

  it('creates a thread when the id is unknown', async () => {
    const thread = await ensure('thr_does_not_exist')
    expect(thread.id).not.toBe('thr_does_not_exist')
    expect(thread.messages).toHaveLength(0)
  })

  it('reuses the thread when the id is known', async () => {
    const created = await create()
    expect((await ensure(created.id)).id).toBe(created.id)
  })

  it('orders summaries with the most recently used first', async () => {
    const older = await create()
    await append(older.id, [msg('user', 'older question')])
    const newer = await create()
    await append(newer.id, [msg('user', 'newer question')])

    const list = await summaries()
    expect(list[0]!.id).toBe(newer.id)
    expect(list[0]!.messageCount).toBe(1)
  })

  it('deletes a thread on request', async () => {
    const thread = await create()
    await remove(thread.id)
    expect(await get(thread.id)).toBeNull()
  })

  it('refuses to append to a thread that does not exist', async () => {
    await expect(append('thr_nope', [msg('user', 'hi')])).rejects.toThrow(/No such conversation/)
  })
})
