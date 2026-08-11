import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@shared/types'
import type { ThreadSummary } from '../../../preload'
import { api } from '../lib/api'
import { useSnapshot, useStore } from '../lib/store'
import { Tag } from '../components/ui'
import { relativeTime } from '../lib/format'
import { IconAgent, IconSend, IconX } from '../lib/icons'

const SUGGESTIONS = [
  'What is my balance right now?',
  'What are my current guardrails?',
  'Quote 0.05 ETH into USDC',
  'What have you learned so far?'
]

export default function Agent(): React.JSX.Element {
  const snapshot = useSnapshot()
  const { notify, run } = useStore()

  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  const loadThreads = useCallback(async () => {
    try {
      const list = await api.chat.threads()
      setThreads(list)
      return list
    } catch {
      return []
    }
  }, [])

  // Open the most recent conversation on mount — history survives a restart now.
  useEffect(() => {
    void (async () => {
      const list = await loadThreads()
      const latest = list[0]
      if (latest) {
        setThreadId(latest.id)
        const thread = await api.chat.thread(latest.id)
        if (thread) setMessages(thread.messages as ChatMessage[])
      }
    })()
  }, [loadThreads])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  async function openThread(id: string): Promise<void> {
    setThreadId(id)
    const thread = await api.chat.thread(id)
    setMessages((thread?.messages as ChatMessage[]) ?? [])
  }

  function startNew(): void {
    setThreadId(null)
    setMessages([])
    setDraft('')
  }

  async function send(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed || busy) return

    // Echo locally so the input feels instant; main is the source of truth and
    // its copy replaces this one when the turn returns.
    const optimistic: ChatMessage = {
      id: `local_${Date.now()}`,
      role: 'user',
      content: trimmed,
      at: Date.now()
    }
    setMessages((current) => [...current, optimistic])
    setDraft('')
    setBusy(true)

    try {
      const turn = await api.agent.chat(trimmed, threadId)
      setThreadId(turn.threadId)
      const thread = await api.chat.thread(turn.threadId)
      setMessages((thread?.messages as ChatMessage[]) ?? [])
      await loadThreads()

      if (turn.actionIds.length > 0) {
        notify('info', `${turn.actionIds.length} action(s) reached the safety gate. Check Approvals.`)
      }
    } catch (err) {
      setMessages((current) => current.filter((m) => m.id !== optimistic.id))
      setDraft(trimmed)
      notify('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="chat">
      <aside className="threads">
        <div className="threads__head">
          <button className="btn btn--block btn--sm" onClick={startNew}>
            New conversation
          </button>
        </div>
        <div className="threads__list">
          {threads.length === 0 ? (
            <p className="tiny muted" style={{ padding: '10px 12px' }}>
              Conversations are kept on this machine and survive a restart.
            </p>
          ) : (
            threads.map((thread) => (
              <div key={thread.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <button
                  className={`thread${thread.id === threadId ? ' thread--active' : ''}`}
                  onClick={() => void openThread(thread.id)}
                >
                  <div className="thread__title">{thread.title}</div>
                  <div className="thread__meta">
                    {thread.messageCount} messages · {relativeTime(thread.updatedAt)}
                  </div>
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  aria-label="Delete conversation"
                  onClick={async () => {
                    await run(() => api.chat.remove(thread.id))
                    if (thread.id === threadId) startNew()
                    await loadThreads()
                  }}
                >
                  <IconX size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      <div className="conv">
        <div className="conv__log" ref={logRef}>
          {messages.length === 0 && (
            <div className="empty" style={{ margin: 'auto' }}>
              <span className="empty__icon">
                <IconAgent size={19} />
              </span>
              <span className="empty__title">
                {snapshot.llm.hasApiKey ? `Connected to ${snapshot.llm.model}` : 'Local planner mode'}
              </span>
              <span className="empty__text">
                {snapshot.llm.hasApiKey
                  ? 'Ask a question or give it a task. Anything that would move funds goes to the safety gate first, and in restricted modes to you.'
                  : 'No model provider is configured, so read-only questions are answered by the deterministic local planner. Add an API key in Settings for full reasoning.'}
              </span>
              <div
                className="inline inline--wrap"
                style={{ justifyContent: 'center', marginTop: 14 }}
              >
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    className="btn btn--sm"
                    onClick={() => void send(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => {
            if (message.role === 'tool') {
              return (
                <div className="msg msg--tool" key={message.id}>
                  <div className="msg__bubble">
                    <span className="msg__tool-name">{message.toolName}</span>
                    {message.content}
                  </div>
                </div>
              )
            }
            return (
              <div className={`msg msg--${message.role}`} key={message.id}>
                <div className="msg__avatar">{message.role === 'user' ? 'YOU' : 'VX'}</div>
                <div className="msg__bubble">
                  {message.content}
                  {message.offline && (
                    <div style={{ marginTop: 8 }}>
                      <Tag tone="accent">local planner</Tag>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {busy && (
            <div className="msg msg--assistant">
              <div className="msg__avatar">VX</div>
              <div className="msg__bubble muted">Thinking…</div>
            </div>
          )}
        </div>

        <div className="composer-bar">
          <div className="composer">
            <textarea
              className="textarea"
              value={draft}
              placeholder="Ask about balances, prices, guardrails — or give the agent a task."
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send(draft)
                }
              }}
            />
            <button
              className="btn btn--primary"
              style={{ height: 42 }}
              disabled={busy || draft.trim().length === 0}
              onClick={() => void send(draft)}
            >
              <IconSend size={14} />
              Send
            </button>
          </div>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            Enter sends · Shift+Enter for a new line. Agent output is directional and can be wrong —
            you are responsible for anything you approve.
          </p>
        </div>
      </div>
    </div>
  )
}
