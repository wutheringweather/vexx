import type {
  ActionRecord,
  ExecutionMode,
  Mission,
  Policy
} from '@shared/types'
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EVM_NETWORK,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  DEFAULT_POLICY,
  DEFAULT_SOLANA_NETWORK
} from '@shared/constants'
import { dataPath, readJson, writeJsonAtomic } from './storage/files'

const STATE_FILE = 'state.json'
const MAX_RETAINED_ACTIONS = 300

export interface PersistedState {
  version: 1
  policy: Policy
  mode: ExecutionMode
  activeEvmNetworkId: string
  activeSolanaNetworkId: string
  actions: ActionRecord[]
  missions: Mission[]
  llm: {
    baseUrl: string
    model: string
    temperature: number
    maxTokens: number
    /** Encrypted with a machine-bound key, not with the master password. */
    apiKeyCipher: string | null
  }
  jupiter: {
    /** Encrypted with the OS keychain, never with the vault password. */
    apiKeyCipher: string | null
  }
  memory: {
    /**
     * Off by default. Turning it on sends lesson text to the provider to be
     * embedded, which is the only path in the app where memory leaves the
     * machine — so it stays an explicit choice.
     */
    embeddingsEnabled: boolean
    embeddingModel: string
  }
}

function defaults(): PersistedState {
  return {
    version: 1,
    policy: { ...DEFAULT_POLICY },
    mode: 'agent-restricted',
    activeEvmNetworkId: DEFAULT_EVM_NETWORK,
    activeSolanaNetworkId: DEFAULT_SOLANA_NETWORK,
    actions: [],
    missions: [],
    llm: {
      baseUrl: DEFAULT_LLM_BASE_URL,
      model: DEFAULT_LLM_MODEL,
      temperature: 0.3,
      maxTokens: 1200,
      apiKeyCipher: null
    },
    jupiter: {
      apiKeyCipher: null
    },
    memory: {
      embeddingsEnabled: false,
      embeddingModel: DEFAULT_EMBEDDING_MODEL
    }
  }
}

let state: PersistedState | null = null
let saveQueue: Promise<void> = Promise.resolve()

export async function load(): Promise<PersistedState> {
  if (!state) {
    const loaded = await readJson<PersistedState | null>(dataPath(STATE_FILE), null)
    // Merge over defaults so a state file from an older build stays usable.
    state = loaded
      ? {
          ...defaults(),
          ...loaded,
          policy: { ...DEFAULT_POLICY, ...loaded.policy },
          llm: { ...defaults().llm, ...loaded.llm },
          jupiter: { ...defaults().jupiter, ...loaded.jupiter },
          memory: { ...defaults().memory, ...loaded.memory }
        }
      : defaults()
  }
  return state
}

export function current(): PersistedState {
  if (!state) throw new Error('State accessed before load()')
  return state
}

export function save(): Promise<void> {
  saveQueue = saveQueue.then(async () => {
    if (!state) return
    // Trim history on the way out rather than growing the file forever.
    if (state.actions.length > MAX_RETAINED_ACTIONS) {
      state.actions = state.actions.slice(-MAX_RETAINED_ACTIONS)
    }
    await writeJsonAtomic(dataPath(STATE_FILE), state)
  })
  return saveQueue
}

export async function update(mutator: (draft: PersistedState) => void): Promise<PersistedState> {
  const s = await load()
  mutator(s)
  await save()
  return s
}

export function findAction(id: string): ActionRecord | undefined {
  return current().actions.find((a) => a.id === id)
}

export function findMission(id: string): Mission | undefined {
  return current().missions.find((m) => m.id === id)
}

export function pendingActions(): ActionRecord[] {
  return current().actions.filter((a) => a.status === 'pending')
}

export function resetForTests(): void {
  state = null
}
