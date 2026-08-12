import { BrowserWindow, ipcMain, shell } from 'electron'
import { z } from 'zod'
import type { AppSnapshot, BalanceInfo, ChatMessage } from '@shared/types'
import {
  EXECUTION_MODES,
  DEFAULT_EVM_NETWORK,
  DEFAULT_SOLANA_NETWORK,
  NETWORKS,
  findNetwork,
  isAllowedExternalLink
} from '@shared/constants'
import { newId } from './storage/files'
import * as state from './state'
import * as audit from './audit/log'
import * as lessons from './memory/lessons'
import * as keystore from './vault/keystore'
import * as evm from './chains/evm'
import * as solana from './chains/solana'
import * as market from './chains/market'
import * as jupiter from './chains/jupiter'
import { forceTestnets, networkSelectionError } from './networks'
import * as actions from './agent/actions'
import * as mission from './agent/mission'
import * as conversations from './agent/conversations'
import { hasProvider, llmConfig, runTurn } from './agent/runner'
import { probe } from './agent/llm'
import * as embeddings from './memory/embeddings'
import * as updater from './updater'
import { open as openSecret, seal } from './storage/secret-store'
import { checkPasswordStrength } from './vault/crypto'

/**
 * The only surface the renderer can reach. Every channel is listed here, every
 * payload is parsed by zod before it touches privileged code, and no handler
 * returns key material.
 */

let mainWindow: BrowserWindow | null = null
let balanceCache: BalanceInfo[] = []

export function bindWindow(window: BrowserWindow): void {
  mainWindow = window
}

function broadcast(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

export async function pushSnapshot(): Promise<void> {
  broadcast('app:snapshot', await snapshot())
}

/**
 * Resolves the embeddings config, or null when semantic memory is switched off.
 * Wired into the memory module at startup so it stays free of app state.
 */
export function embeddingConfig(): embeddings.EmbeddingConfig | null {
  const s = state.current()
  if (!s.memory.embeddingsEnabled) return null
  return {
    baseUrl: s.llm.baseUrl,
    apiKey: openSecret(s.llm.apiKeyCipher),
    model: s.memory.embeddingModel
  }
}

async function snapshot(): Promise<AppSnapshot> {
  const s = await state.load()
  const sorted = [...s.actions].sort((a, b) => b.createdAt - a.createdAt)
  const coverage = await lessons.coverage()
  return {
    vault: await keystore.status(),
    policy: s.policy,
    mode: s.mode,
    networks: NETWORKS,
    activeEvmNetworkId: s.activeEvmNetworkId,
    activeSolanaNetworkId: s.activeSolanaNetworkId,
    balances: balanceCache,
    pendingActions: sorted.filter((a) => a.status === 'pending'),
    recentActions: sorted.slice(0, 60),
    missions: [...s.missions].sort((a, b) => b.startedAt - a.startedAt).slice(0, 30),
    lessons: await lessons.all(),
    llm: {
      baseUrl: s.llm.baseUrl,
      model: s.llm.model,
      // The key itself never crosses the boundary — only whether one exists.
      hasApiKey: hasProvider(),
      temperature: s.llm.temperature,
      maxTokens: s.llm.maxTokens
    },
    jupiter: {
      hasApiKey: Boolean(openSecret(s.jupiter.apiKeyCipher))
    },
    memory: {
      embeddingsEnabled: s.memory.embeddingsEnabled,
      embeddingModel: s.memory.embeddingModel,
      embeddedCount: coverage.embedded,
      totalCount: coverage.total
    },
    update: updater.current(),
    version: process.env.npm_package_version ?? '0.1.0'
  }
}

async function refreshBalances(): Promise<BalanceInfo[]> {
  const s = state.current()
  const addresses = keystore.publicAddresses()
  const targets = [s.activeEvmNetworkId, s.activeSolanaNetworkId]

  const results = await Promise.all(
    targets.map(async (id) => {
      const network = findNetwork(id)
      if (!network) return null
      const address = network.family === 'evm' ? addresses.evm : addresses.solana
      if (!address) return null
      return network.family === 'evm'
        ? evm.getBalance(network, address)
        : solana.getBalance(network, address)
    })
  )

  balanceCache = results.filter((r): r is BalanceInfo => r !== null)
  return balanceCache
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const passwordSchema = z.object({ password: z.string().min(1).max(512) })

const createVaultSchema = z.object({
  password: z.string().min(1).max(512),
  mnemonic: z.string().max(1000).optional()
})

const policySchema = z.object({
  maxNotionalUsdPerAction: z.number().min(0).max(1_000_000),
  maxNotionalUsdPerMission: z.number().min(0).max(10_000_000),
  maxLossUsd: z.number().min(0).max(1_000_000),
  maxSlippageBps: z.number().int().min(0).max(5000),
  missionDeadlineMinutes: z.number().int().min(1).max(1440),
  maxMissionSteps: z.number().int().min(1).max(200),
  transferAllowlist: z.array(z.string().min(1).max(120)).max(50),
  tokenAllowlist: z.array(z.string().min(1).max(12)).max(50),
  mainnetEnabled: z.boolean(),
  emergencyStop: z.boolean()
})

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  /** null starts a new thread; main owns the history so it survives a restart. */
  threadId: z.string().max(64).nullable()
})

const llmSchema = z.object({
  baseUrl: z.string().url().max(300),
  model: z.string().min(1).max(120),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(64).max(32000),
  /** null leaves the stored key alone; '' clears it. */
  apiKey: z.string().max(400).nullable()
})

const jupiterSchema = z.object({
  /** null leaves the stored key alone; '' clears it. */
  apiKey: z.string().max(400).nullable()
})

const manualActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('transfer'),
    networkId: z.string().min(1),
    to: z.string().min(1).max(120),
    amount: z.string().min(1).max(40),
    symbol: z.string().min(1).max(12)
  }),
  z.object({
    kind: z.literal('swap'),
    networkId: z.string().min(1),
    sellSymbol: z.string().min(1).max(12),
    buySymbol: z.string().min(1).max(12),
    sellAmount: z.string().min(1).max(40)
  })
])

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

type Handler = (payload: unknown) => Promise<unknown>

function handle(channel: string, handler: Handler): void {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      const result = await handler(payload)
      return { ok: true, data: result }
    } catch (err) {
      // Errors surface as data, never as a rejected promise carrying a stack
      // trace across the boundary.
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

export function registerHandlers(): void {
  handle('app:snapshot', async () => snapshot())

  handle('app:refresh-balances', async () => {
    keystore.touch()
    const balances = await refreshBalances()
    await pushSnapshot()
    return balances
  })

  // --- Vault ---------------------------------------------------------------

  handle('vault:status', async () => keystore.status())

  handle('vault:check-password', async (payload) => {
    const { password } = passwordSchema.parse(payload)
    return checkPasswordStrength(password)
  })

  handle('vault:create', async (payload) => {
    const { password, mnemonic } = createVaultSchema.parse(payload)
    const result = await keystore.create(password, mnemonic)
    await audit.record('vault', mnemonic ? 'Vault created from an imported phrase' : 'Vault created', {
      accounts: result.accounts.map((a) => ({ family: a.family, address: a.address }))
    })
    await refreshBalances()
    await pushSnapshot()
    return result
  })

  handle('vault:unlock', async (payload) => {
    const { password } = passwordSchema.parse(payload)
    const status = await keystore.unlock(password)
    await audit.record('vault', 'Vault unlocked', {})
    await refreshBalances()
    await pushSnapshot()
    return status
  })

  handle('vault:lock', async () => {
    keystore.lock()
    balanceCache = []
    await audit.record('vault', 'Vault locked', {})
    await mission.stopAll('operator-stopped')
    await pushSnapshot()
    return keystore.status()
  })

  handle('vault:destroy', async (payload) => {
    const { password } = passwordSchema.parse(payload)
    // Prove the operator holds the password before destroying the keystore.
    await keystore.unlock(password)
    await keystore.destroy()
    balanceCache = []
    await audit.record('vault', 'Vault destroyed', {})
    await pushSnapshot()
    return keystore.status()
  })

  // --- Policy, mode, network ----------------------------------------------

  handle('policy:update', async (payload) => {
    const policy = policySchema.parse(payload)
    const previous = state.current().policy
    let networkFallback: { activeEvmNetworkId?: string; activeSolanaNetworkId?: string } = {}
    await state.update((draft) => {
      draft.policy = policy
      if (!policy.mainnetEnabled) {
        const safe = forceTestnets(draft)
        if (safe.activeEvmNetworkId !== draft.activeEvmNetworkId) {
          networkFallback.activeEvmNetworkId = safe.activeEvmNetworkId
          draft.activeEvmNetworkId = safe.activeEvmNetworkId
        }
        if (safe.activeSolanaNetworkId !== draft.activeSolanaNetworkId) {
          networkFallback.activeSolanaNetworkId = safe.activeSolanaNetworkId
          draft.activeSolanaNetworkId = safe.activeSolanaNetworkId
        }
      }
    })

    await audit.record('policy', 'Guardrail policy updated', {
      changed: Object.keys(policy).filter(
        (k) =>
          JSON.stringify(policy[k as keyof typeof policy]) !==
          JSON.stringify(previous[k as keyof typeof previous])
      )
    })

    if (policy.emergencyStop && !previous.emergencyStop) {
      await actions.expireAllPending('Emergency stop engaged')
      await mission.stopAll('emergency-stop')
    }
    if (Object.keys(networkFallback).length > 0) {
      await audit.record('system', 'Mainnet disabled; active networks returned to testnets', {
        ...networkFallback,
        defaults: { evm: DEFAULT_EVM_NETWORK, solana: DEFAULT_SOLANA_NETWORK }
      })
      await refreshBalances()
    }
    await pushSnapshot()
    return policy
  })

  handle('mode:set', async (payload) => {
    const { mode } = z
      .object({ mode: z.enum(EXECUTION_MODES.map((m) => m.id) as [string, ...string[]]) })
      .parse(payload)
    await state.update((draft) => {
      draft.mode = mode as (typeof EXECUTION_MODES)[number]['id']
    })
    await audit.record('policy', `Execution mode set to ${mode}`, { mode })
    await pushSnapshot()
    return mode
  })

  handle('network:set', async (payload) => {
    const { networkId } = z.object({ networkId: z.string().min(1) }).parse(payload)
    const network = findNetwork(networkId)
    if (!network) throw new Error(`Unknown network "${networkId}".`)
    const selectionError = networkSelectionError(network, state.current().policy.mainnetEnabled)
    if (selectionError) throw new Error(selectionError)

    await state.update((draft) => {
      if (network.family === 'evm') draft.activeEvmNetworkId = networkId
      else draft.activeSolanaNetworkId = networkId
    })
    await audit.record('system', `Active ${network.family} network set to ${network.label}`, {
      networkId
    })
    await refreshBalances()
    await pushSnapshot()
    return networkId
  })

  // --- Actions -------------------------------------------------------------

  handle('action:propose', async (payload) => {
    const input = manualActionSchema.parse(payload)
    keystore.touch()

    if (input.kind === 'transfer') {
      const record = await actions.propose(
        {
          kind: 'transfer',
          networkId: input.networkId,
          to: input.to,
          amount: input.amount,
          symbol: input.symbol.toUpperCase(),
          estimatedUsd: await market.toUsd(input.symbol, input.amount)
        },
        'Proposed manually by the operator.'
      )
      await refreshBalances()
      await pushSnapshot()
      return record
    }

    const quote = await market.quoteSwap(input.sellSymbol, input.buySymbol, input.sellAmount)
    const record = await actions.propose(
      {
        kind: 'swap',
        networkId: input.networkId,
        sellSymbol: quote.sellSymbol,
        buySymbol: quote.buySymbol,
        sellAmount: quote.sellAmount,
        expectedBuyAmount: quote.expectedBuyAmount,
        slippageBps: quote.slippageBps,
        estimatedUsd: quote.notionalUsd
      },
      'Proposed manually by the operator.'
    )
    await pushSnapshot()
    return record
  })

  handle('action:approve', async (payload) => {
    const { actionId } = z.object({ actionId: z.string().min(1) }).parse(payload)
    keystore.touch()
    const record = await actions.approve(actionId)
    if (record.missionId) await mission.resume(record.missionId)
    await refreshBalances()
    await pushSnapshot()
    return record
  })

  handle('action:reject', async (payload) => {
    const { actionId, note } = z
      .object({ actionId: z.string().min(1), note: z.string().max(500).optional() })
      .parse(payload)
    const record = await actions.reject(actionId, note ?? '')
    await pushSnapshot()
    return record
  })

  // --- Missions ------------------------------------------------------------

  handle('mission:start', async (payload) => {
    const { objective, mode } = z
      .object({
        objective: z.string().min(4).max(600),
        mode: z.enum(['mission-restricted', 'mission-full']).optional()
      })
      .parse(payload)
    const started = await mission.start(objective, mode)
    await pushSnapshot()
    return started
  })

  handle('mission:stop', async (payload) => {
    const { missionId } = z.object({ missionId: z.string().min(1) }).parse(payload)
    const stopped = await mission.stop(missionId)
    await pushSnapshot()
    return stopped
  })

  // --- Agent ---------------------------------------------------------------

  handle('agent:chat', async (payload) => {
    const { message, threadId } = chatSchema.parse(payload)
    keystore.touch()

    const thread = await conversations.ensure(threadId)
    const userMessage: ChatMessage = {
      id: newId('msg'),
      role: 'user',
      content: message,
      at: Date.now()
    }
    // Persist the question before answering, so a crash mid-turn still leaves
    // a record of what was asked.
    await conversations.append(thread.id, [userMessage])

    const turn = await runTurn(message, thread.messages)
    await conversations.append(thread.id, turn.messages)

    await refreshBalances()
    await pushSnapshot()
    return { ...turn, threadId: thread.id, userMessage }
  })

  handle('chat:threads', async () => conversations.summaries())

  handle('chat:thread', async (payload) => {
    const { threadId } = z.object({ threadId: z.string().min(1) }).parse(payload)
    return conversations.get(threadId)
  })

  handle('chat:new', async () => conversations.create())

  handle('chat:delete', async (payload) => {
    const { threadId } = z.object({ threadId: z.string().min(1) }).parse(payload)
    await conversations.remove(threadId)
    return true
  })

  handle('chat:clear', async () => {
    await conversations.clear()
    await audit.record('system', 'Conversation history cleared', {})
    return true
  })

  // --- LLM settings --------------------------------------------------------

  handle('llm:update', async (payload) => {
    const input = llmSchema.parse(payload)
    await state.update((draft) => {
      draft.llm.baseUrl = input.baseUrl
      draft.llm.model = input.model
      draft.llm.temperature = input.temperature
      draft.llm.maxTokens = input.maxTokens
      if (input.apiKey !== null) {
        draft.llm.apiKeyCipher = input.apiKey === '' ? null : seal(input.apiKey)
      }
    })
    await audit.record('system', 'Model provider settings updated', {
      baseUrl: input.baseUrl,
      model: input.model,
      keyChanged: input.apiKey !== null
    })
    await pushSnapshot()
    return true
  })

  handle('llm:probe', async () => probe(llmConfig()))

  // --- Jupiter live SOL execution ----------------------------------------

  handle('jupiter:update', async (payload) => {
    const input = jupiterSchema.parse(payload)
    await state.update((draft) => {
      if (input.apiKey !== null) {
        draft.jupiter.apiKeyCipher = input.apiKey === '' ? null : seal(input.apiKey)
      }
    })
    await audit.record('system', 'Jupiter settings updated', {
      keyChanged: input.apiKey !== null,
      configured: Boolean(openSecret(state.current().jupiter.apiKeyCipher))
    })
    await pushSnapshot()
    return true
  })

  handle('jupiter:probe', async () => {
    const s = state.current()
    const apiKey = openSecret(s.jupiter.apiKeyCipher)
    if (!apiKey) return { ok: false, latencyMs: 0, detail: 'Jupiter API key is not configured.' }
    const vault = await keystore.status()
    const solanaAddress = vault.accounts.find((account) => account.family === 'solana')?.address ?? null
    return jupiter.probe(apiKey, solanaAddress)
  })

  // --- Semantic memory -----------------------------------------------------

  handle('memory:settings', async (payload) => {
    const input = z
      .object({ embeddingsEnabled: z.boolean(), embeddingModel: z.string().min(1).max(120) })
      .parse(payload)

    const was = state.current().memory.embeddingsEnabled
    await state.update((draft) => {
      draft.memory.embeddingsEnabled = input.embeddingsEnabled
      draft.memory.embeddingModel = input.embeddingModel
    })
    await audit.record('system', 'Semantic memory settings updated', {
      enabled: input.embeddingsEnabled,
      model: input.embeddingModel
    })

    // Turning it on is only useful once existing lessons have vectors.
    if (input.embeddingsEnabled && !was) {
      const result = await lessons.backfillVectors()
      await audit.record('system', 'Backfilled lesson vectors', result)
      await pushSnapshot()
      return result
    }
    await pushSnapshot()
    return { embedded: 0, failed: 0 }
  })

  handle('memory:probe-embeddings', async () => {
    const s = state.current()
    return embeddings.probe({
      baseUrl: s.llm.baseUrl,
      apiKey: openSecret(s.llm.apiKeyCipher),
      model: s.memory.embeddingModel
    })
  })

  handle('memory:backfill', async () => {
    const result = await lessons.backfillVectors()
    await pushSnapshot()
    return result
  })

  // --- Updates -------------------------------------------------------------

  handle('update:check', async () => updater.check())
  handle('update:download', async () => updater.download())
  handle('update:install', async () => {
    await updater.installNow()
    return true
  })

  // --- Audit & memory ------------------------------------------------------

  handle('audit:list', async (payload) => {
    const { limit } = z.object({ limit: z.number().int().min(1).max(1000).optional() }).parse(payload ?? {})
    return audit.list(limit ?? 250)
  })

  handle('audit:verify', async () => audit.verify())

  handle('memory:forget', async (payload) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(payload)
    await lessons.forget(id)
    await pushSnapshot()
    return true
  })

  handle('memory:clear', async () => {
    await lessons.clear()
    await audit.record('system', 'Agent memory cleared', {})
    await pushSnapshot()
    return true
  })

  // --- Utilities -----------------------------------------------------------

  handle('chain:airdrop', async () => {
    const s = state.current()
    const network = findNetwork(s.activeSolanaNetworkId)
    const address = keystore.publicAddresses().solana
    if (!network || !address) throw new Error('Unlock the vault and select a Solana network first.')
    const signature = await solana.requestAirdrop(network, address)
    await audit.record('system', 'Requested a devnet airdrop', { signature })
    await refreshBalances()
    await pushSnapshot()
    return signature
  })

  handle('shell:open-external', async (payload) => {
    const { url } = z.object({ url: z.string().url().max(500) }).parse(payload)
    const parsed = new URL(url)
    // Only https, and only to explorers this build already knows about plus the
    // handful of complete URLs in EXTERNAL_LINKS. Still no wildcard domains.
    const allowed = isAllowedExternalLink(url)
    if (parsed.protocol !== 'https:' || !allowed) {
      throw new Error('That link is not on the allowlist.')
    }
    await shell.openExternal(url)
    return true
  })
}

/** Wired up in main so a background mission can reach the UI. */
export function wireMissionUpdates(): void {
  mission.onMissionUpdate(() => {
    void pushSnapshot()
  })
}

export { refreshBalances }
