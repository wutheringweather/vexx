import { contextBridge, ipcRenderer } from 'electron'
import type {
  AccountInfo,
  ActionRecord,
  AppSnapshot,
  AuditEntry,
  AuditVerification,
  BalanceInfo,
  EmbeddingProbeResult,
  ExecutionMode,
  LlmProbeResult,
  Mission,
  Policy,
  UpdateStatus,
  VaultCreateResult,
  VaultStatus
} from '../shared/types'

/**
 * The entire renderer-facing API. It is a fixed list of named methods over a
 * fixed list of channels — the renderer cannot reach `ipcRenderer.invoke`
 * directly, so it cannot call a channel that is not written out below.
 */

export interface IpcResult<T> {
  ok: boolean
  data?: T
  error?: string
}

async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, payload)) as IpcResult<T>
  if (!result?.ok) throw new Error(result?.error ?? 'The request failed.')
  return result.data as T
}

export interface PasswordStrength {
  ok: boolean
  score: number
  problems: string[]
}

export interface ChatMessageDto {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  at: number
  toolName?: string
  actionId?: string
  offline?: boolean
}

export interface ChatTurn {
  messages: ChatMessageDto[]
  actionIds: string[]
  threadId: string
  userMessage: ChatMessageDto
}

export interface ThreadSummary {
  id: string
  title: string
  messageCount: number
  createdAt: number
  updatedAt: number
}

export interface Thread extends ThreadSummary {
  messages: ChatMessageDto[]
}

const api = {
  snapshot: () => call<AppSnapshot>('app:snapshot'),
  refreshBalances: () => call<BalanceInfo[]>('app:refresh-balances'),

  vault: {
    status: () => call<VaultStatus>('vault:status'),
    checkPassword: (password: string) =>
      call<PasswordStrength>('vault:check-password', { password }),
    create: (password: string, mnemonic?: string) =>
      call<VaultCreateResult>('vault:create', { password, mnemonic }),
    unlock: (password: string) => call<VaultStatus>('vault:unlock', { password }),
    lock: () => call<VaultStatus>('vault:lock'),
    destroy: (password: string) => call<VaultStatus>('vault:destroy', { password })
  },

  policy: {
    update: (policy: Policy) => call<Policy>('policy:update', policy)
  },

  setMode: (mode: ExecutionMode) => call<ExecutionMode>('mode:set', { mode }),
  setNetwork: (networkId: string) => call<string>('network:set', { networkId }),

  actions: {
    propose: (
      input:
        | { kind: 'transfer'; networkId: string; to: string; amount: string; symbol: string }
        | { kind: 'swap'; networkId: string; sellSymbol: string; buySymbol: string; sellAmount: string }
    ) => call<ActionRecord>('action:propose', input),
    approve: (actionId: string) => call<ActionRecord>('action:approve', { actionId }),
    reject: (actionId: string, note?: string) =>
      call<ActionRecord>('action:reject', { actionId, note })
  },

  missions: {
    start: (objective: string, mode?: 'mission-restricted' | 'mission-full') =>
      call<Mission>('mission:start', { objective, mode }),
    stop: (missionId: string) => call<Mission>('mission:stop', { missionId })
  },

  agent: {
    chat: (message: string, threadId: string | null) =>
      call<ChatTurn>('agent:chat', { message, threadId })
  },

  chat: {
    threads: () => call<ThreadSummary[]>('chat:threads'),
    thread: (threadId: string) => call<Thread | null>('chat:thread', { threadId }),
    create: () => call<Thread>('chat:new'),
    remove: (threadId: string) => call<boolean>('chat:delete', { threadId }),
    clear: () => call<boolean>('chat:clear')
  },

  llm: {
    update: (input: {
      baseUrl: string
      model: string
      temperature: number
      maxTokens: number
      apiKey: string | null
    }) => call<boolean>('llm:update', input),
    probe: () => call<LlmProbeResult>('llm:probe')
  },

  audit: {
    list: (limit?: number) => call<AuditEntry[]>('audit:list', { limit }),
    verify: () => call<AuditVerification>('audit:verify')
  },

  memory: {
    forget: (id: string) => call<boolean>('memory:forget', { id }),
    clear: () => call<boolean>('memory:clear'),
    updateSettings: (input: { embeddingsEnabled: boolean; embeddingModel: string }) =>
      call<{ embedded: number; failed: number }>('memory:settings', input),
    probeEmbeddings: () => call<EmbeddingProbeResult>('memory:probe-embeddings'),
    backfill: () => call<{ embedded: number; failed: number }>('memory:backfill')
  },

  update: {
    check: () => call<UpdateStatus>('update:check'),
    download: () => call<UpdateStatus>('update:download'),
    install: () => call<boolean>('update:install')
  },

  airdrop: () => call<string>('chain:airdrop'),
  openExternal: (url: string) => call<boolean>('shell:open-external', { url }),

  /** Push channel for state main considers changed. Returns an unsubscribe fn. */
  onSnapshot: (handler: (snapshot: AppSnapshot) => void): (() => void) => {
    const listener = (_event: unknown, snapshot: AppSnapshot): void => handler(snapshot)
    ipcRenderer.on('app:snapshot', listener)
    return () => {
      ipcRenderer.removeListener('app:snapshot', listener)
    }
  }
}

export type VexApi = typeof api
export type { AccountInfo }

contextBridge.exposeInMainWorld('vex', api)
