import type { ChatMessage } from '@shared/types'
import { dataPath, newId, readJson, writeJsonAtomic } from '../storage/files'
import { redact } from '../memory/redact'

/**
 * Conversation history, kept on disk so a restart does not throw away what the
 * agent already told you. Threads are redacted on write like everything else
 * that touches storage.
 */

const FILE = 'conversations.json'
const MAX_THREADS = 50
const MAX_MESSAGES_PER_THREAD = 400

export interface Thread {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

export interface ThreadSummary {
  id: string
  title: string
  messageCount: number
  createdAt: number
  updatedAt: number
}

interface Store {
  threads: Thread[]
}

let cache: Store | null = null

async function load(): Promise<Store> {
  if (!cache) cache = await readJson<Store>(dataPath(FILE), { threads: [] })
  return cache
}

async function persist(): Promise<void> {
  await writeJsonAtomic(dataPath(FILE), cache ?? { threads: [] })
}

/** First user message, trimmed to something that fits a sidebar row. */
function deriveTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user')
  if (!first) return 'New conversation'
  const text = first.content.replace(/\s+/g, ' ').trim()
  return text.length > 52 ? `${text.slice(0, 52)}…` : text || 'New conversation'
}

export async function summaries(): Promise<ThreadSummary[]> {
  const store = await load()
  return store.threads
    .map((t) => ({
      id: t.id,
      title: t.title,
      messageCount: t.messages.length,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function get(id: string): Promise<Thread | null> {
  const store = await load()
  return store.threads.find((t) => t.id === id) ?? null
}

export async function create(): Promise<Thread> {
  const store = await load()
  const now = Date.now()
  const thread: Thread = {
    id: newId('thr'),
    title: 'New conversation',
    messages: [],
    createdAt: now,
    updatedAt: now
  }
  store.threads.unshift(thread)
  if (store.threads.length > MAX_THREADS) store.threads.length = MAX_THREADS
  await persist()
  return thread
}

/** Returns the thread the caller should use, creating one if the id is unknown. */
export async function ensure(id: string | null): Promise<Thread> {
  if (id) {
    const existing = await get(id)
    if (existing) return existing
  }
  return create()
}

export async function append(id: string, messages: ChatMessage[]): Promise<Thread> {
  const store = await load()
  const thread = store.threads.find((t) => t.id === id)
  if (!thread) throw new Error('No such conversation.')

  thread.messages.push(...messages.map((m) => redact(m)))
  if (thread.messages.length > MAX_MESSAGES_PER_THREAD) {
    thread.messages = thread.messages.slice(-MAX_MESSAGES_PER_THREAD)
  }
  thread.title = thread.title === 'New conversation' ? deriveTitle(thread.messages) : thread.title
  thread.updatedAt = Date.now()
  await persist()
  return thread
}

export async function remove(id: string): Promise<void> {
  const store = await load()
  store.threads = store.threads.filter((t) => t.id !== id)
  await persist()
}

export async function clear(): Promise<void> {
  cache = { threads: [] }
  await persist()
}

export function resetCacheForTests(): void {
  cache = null
}
