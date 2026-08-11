import type { AppSnapshot } from '@shared/types'
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  DEFAULT_POLICY,
  NETWORKS
} from '@shared/constants'
import type { VexApi } from '../../../preload'

/**
 * A stand-in for the preload bridge, used only when the UI is opened in a plain
 * browser instead of Electron — which is how the visual design gets reviewed
 * without booting the whole runtime.
 *
 * It is guarded by `import.meta.env.DEV` at the only call site, so Vite strips
 * this module out of the production bundle entirely. It can never serve fake
 * balances to a real user.
 */

function snapshot(): AppSnapshot {
  const now = Date.now()
  return {
    vault: {
      state: 'unlocked',
      accounts: [
        {
          family: 'evm',
          label: 'EVM Account 1',
          address: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
          derivationPath: "m/44'/60'/0'/0/0"
        },
        {
          family: 'solana',
          label: 'Solana Account 1',
          address: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
          derivationPath: "m/44'/501'/0'/0'"
        }
      ],
      autoLockAt: now + 12 * 60 * 1000,
      createdAt: now - 86_400_000
    },
    policy: { ...DEFAULT_POLICY, transferAllowlist: ['0x1111111111111111111111111111111111111111'] },
    mode: 'agent-restricted',
    networks: NETWORKS,
    activeEvmNetworkId: 'eth-sepolia',
    activeSolanaNetworkId: 'sol-devnet',
    balances: [
      {
        networkId: 'eth-sepolia',
        address: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
        raw: '184000000000000000',
        formatted: '0.184000',
        symbol: 'ETH',
        decimals: 18,
        fetchedAt: now - 40_000
      },
      {
        networkId: 'sol-devnet',
        address: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
        raw: '2140000000',
        formatted: '2.140000',
        symbol: 'SOL',
        decimals: 9,
        fetchedAt: now - 40_000
      }
    ],
    pendingActions: [
      {
        id: 'act_preview_pending',
        action: {
          kind: 'swap',
          networkId: 'eth-sepolia',
          sellSymbol: 'ETH',
          buySymbol: 'USDC',
          sellAmount: '0.01',
          expectedBuyAmount: '29.912',
          slippageBps: 30,
          estimatedUsd: 30.02
        },
        rationale:
          'ETH is 2.1% below its 24h mean and the position sits well inside the per-action cap. Rotating a small slice into USDC reduces exposure without touching the mission allocation.',
        status: 'pending',
        verdict: {
          decision: 'needs-approval',
          checks: [
            { id: 'emergency-stop', label: 'Emergency stop clear', passed: true, detail: 'Not engaged.' },
            { id: 'vault-unlocked', label: 'Vault unlocked', passed: true, detail: 'Signing key is available.' },
            { id: 'network-known', label: 'Network recognised', passed: true, detail: 'Ethereum Sepolia' },
            {
              id: 'mainnet-authorised',
              label: 'Mainnet authorisation',
              passed: true,
              detail: 'Testnet, no real funds at risk.'
            },
            { id: 'notional-parseable', label: 'Notional is a real number', passed: true, detail: '$30.02' },
            { id: 'per-action-cap', label: 'Per-action cap', passed: true, detail: '$30.02 against a $50.00 cap.' },
            {
              id: 'capital-cap',
              label: 'Mission capital cap',
              passed: true,
              detail: '$30.02 deployed after this, cap is $250.00.'
            },
            { id: 'max-loss', label: 'Max loss not breached', passed: true, detail: 'Realised $0.00 against a -$25.00 floor.' },
            { id: 'amount-positive', label: 'Amount is positive', passed: true, detail: '0.01' },
            { id: 'swap-tokens', label: 'Both legs allowlisted', passed: true, detail: 'ETH → USDC permitted.' },
            { id: 'slippage-cap', label: 'Slippage within tolerance', passed: true, detail: '30 bps against a 100 bps cap.' },
            { id: 'quote-present', label: 'Quote is usable', passed: true, detail: 'Expecting 29.912 USDC.' }
          ],
          reason: null,
          evaluatedAt: now - 90_000
        },
        mode: 'agent-restricted',
        missionId: 'msn_preview',
        createdAt: now - 90_000,
        resolvedAt: null,
        execution: null
      }
    ],
    recentActions: [
      {
        id: 'act_preview_blocked',
        action: {
          kind: 'transfer',
          networkId: 'eth-mainnet',
          to: '0x8888888888888888888888888888888888888888',
          amount: '0.4',
          symbol: 'ETH',
          estimatedUsd: 1200
        },
        rationale: 'Consolidating balances into the main treasury address.',
        status: 'blocked',
        verdict: {
          decision: 'block',
          checks: [
            {
              id: 'mainnet-authorised',
              label: 'Mainnet authorisation',
              passed: false,
              detail: 'Real funds are locked. Enable mainnet in Guardrails first.'
            }
          ],
          reason: 'Mainnet authorisation: Real funds are locked. Enable mainnet in Guardrails first.',
          evaluatedAt: now - 3_600_000
        },
        mode: 'mission-full',
        missionId: 'msn_preview',
        createdAt: now - 3_600_000,
        resolvedAt: now - 3_600_000,
        execution: null
      }
    ],
    missions: [
      {
        id: 'msn_preview',
        objective: 'Watch ETH on Sepolia and rotate a small slice into USDC if it drops 2% below the 24h mean.',
        mode: 'mission-restricted',
        status: 'paused',
        steps: [
          {
            index: 0,
            at: now - 240_000,
            thought:
              'Establishing a baseline before deciding anything. Reading the portfolio first so the sizing is grounded in what is actually held rather than an assumption.',
            toolName: 'get_portfolio',
            toolSummary: '0.184000 ETH on Ethereum Sepolia; 2.140000 SOL on Solana Devnet',
            actionId: null
          },
          {
            index: 1,
            at: now - 150_000,
            thought:
              'ETH is at $3,002 against a 24h mean near $3,067 — that is 2.1% down, which clears the threshold in the objective. Sizing at 0.01 ETH keeps it well inside the $50 per-action cap.',
            toolName: 'quote_swap',
            toolSummary: '0.01 ETH is worth about 29.912 USDC (~$30.02, 30 bps assumed).',
            actionId: null
          },
          {
            index: 2,
            at: now - 90_000,
            thought: 'Proposing the rotation. In a restricted mode this waits for your signature.',
            toolName: 'propose_swap',
            toolSummary: 'Queued for human approval. Stop here and tell the operator what you are waiting on.',
            actionId: 'act_preview_pending'
          }
        ],
        startedAt: now - 300_000,
        endedAt: null,
        deadlineAt: now + 1_500_000,
        terminationReason: null,
        terminationDetail: null,
        deployedUsd: 0,
        realisedUsd: 0
      },
      {
        id: 'msn_preview_done',
        objective: 'Check whether Base Sepolia gas is cheap enough to justify moving activity there.',
        mode: 'mission-restricted',
        status: 'finished',
        steps: [],
        startedAt: now - 86_400_000,
        endedAt: now - 86_000_000,
        deadlineAt: now - 86_000_000,
        terminationReason: 'objective-met',
        terminationDetail: 'Base Sepolia gas is roughly two orders of magnitude cheaper. Reported and stopped.',
        deployedUsd: 0,
        realisedUsd: 0
      }
    ],
    lessons: [
      {
        id: 'lsn_1',
        tier: 'procedural',
        text: 'A transfer on a mainnet network is refused outright while mainnetEnabled is false. Check the guardrails before proposing one.',
        tags: ['gate', 'blocked', 'transfer'],
        createdAt: now - 3_600_000,
        lastReinforcedAt: now - 3_600_000,
        baseStrength: 1,
        strength: 0.999
      },
      {
        id: 'lsn_2',
        tier: 'semantic',
        text: 'Public Sepolia RPC endpoints rate-limit under burst reads; batch balance lookups rather than polling per account.',
        tags: ['rpc'],
        createdAt: now - 20 * 86_400_000,
        lastReinforcedAt: now - 20 * 86_400_000,
        baseStrength: 1,
        strength: 0.63
      },
      {
        id: 'lsn_3',
        tier: 'episodic',
        text: 'The operator rejected a swap sized at the full per-action cap and asked for smaller slices.',
        tags: ['rejected', 'swap'],
        createdAt: now - 48 * 86_400_000,
        lastReinforcedAt: now - 48 * 86_400_000,
        baseStrength: 1,
        strength: 0.33
      }
    ],
    llm: {
      baseUrl: DEFAULT_LLM_BASE_URL,
      model: DEFAULT_LLM_MODEL,
      hasApiKey: false,
      temperature: 0.3,
      maxTokens: 1200
    },
    memory: {
      embeddingsEnabled: false,
      embeddingModel: DEFAULT_EMBEDDING_MODEL,
      embeddedCount: 0,
      totalCount: 3
    },
    update: {
      state: 'unsupported',
      currentVersion: '0.1.0',
      availableVersion: null,
      detail: 'Updates only run in a packaged build.',
      progressPercent: null,
      supported: false
    },
    version: '0.1.0-preview'
  }
}

function unsupported(): never {
  throw new Error('Browser preview is read-only. Run the app in Electron to do anything real.')
}

export function createDevPreviewApi(): VexApi {
  const current = snapshot()
  return {
    snapshot: async () => current,
    refreshBalances: async () => current.balances,
    vault: {
      status: async () => current.vault,
      checkPassword: async () => ({ ok: true, score: 88, problems: [] }),
      create: unsupported,
      unlock: async () => current.vault,
      lock: unsupported,
      destroy: unsupported
    },
    policy: { update: async (policy) => policy },
    setMode: async (mode) => mode,
    setNetwork: async (id) => id,
    actions: { propose: unsupported, approve: unsupported, reject: unsupported },
    missions: { start: unsupported, stop: unsupported },
    agent: {
      chat: async (message) => ({
        messages: [
          {
            id: `preview_${Date.now()}`,
            role: 'assistant',
            content: `Browser preview mode — no runtime is attached, so this is a canned reply to "${message}". Run the app in Electron for the real agent.`,
            at: Date.now(),
            offline: true
          }
        ],
        actionIds: [],
        threadId: 'thr_preview',
        userMessage: {
          id: `preview_user_${Date.now()}`,
          role: 'user',
          content: message,
          at: Date.now()
        }
      })
    },

    chat: {
      threads: async () => [
        {
          id: 'thr_preview',
          title: 'What is my balance right now?',
          messageCount: 4,
          createdAt: Date.now() - 7_200_000,
          updatedAt: Date.now() - 600_000
        },
        {
          id: 'thr_preview_2',
          title: 'Is Base Sepolia gas cheaper than Ethereum Sepolia?',
          messageCount: 2,
          createdAt: Date.now() - 86_400_000,
          updatedAt: Date.now() - 86_000_000
        }
      ],
      thread: async (threadId) => ({
        id: threadId,
        title: 'What is my balance right now?',
        messageCount: 4,
        createdAt: Date.now() - 7_200_000,
        updatedAt: Date.now() - 600_000,
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'What is my balance right now?',
            at: Date.now() - 640_000
          },
          {
            id: 'm2',
            role: 'tool',
            content: '0.184000 ETH on Ethereum Sepolia; 2.140000 SOL on Solana Devnet',
            at: Date.now() - 630_000,
            toolName: 'get_portfolio'
          },
          {
            id: 'm3',
            role: 'assistant',
            content:
              'You hold 0.184 ETH on Ethereum Sepolia and 2.14 SOL on Solana Devnet — about $604 combined at current spot, though both are testnet balances so that figure is notional.\n\nThe ETH side is comfortably above the 0.01 you would need for the swap we discussed. Nothing is at risk right now: mainnet is still disabled.',
            at: Date.now() - 600_000
          }
        ]
      }),
      create: async () => ({
        id: 'thr_new',
        title: 'New conversation',
        messageCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: []
      }),
      remove: async () => true,
      clear: async () => true
    },
    llm: {
      update: async () => true,
      probe: async () => ({ ok: false, model: current.llm.model, latencyMs: 0, detail: 'Preview mode.' })
    },
    audit: {
      list: async () => [
        {
          seq: 3,
          at: Date.now() - 90_000,
          kind: 'gate',
          summary: 'Gate needs-approval for swap',
          detail: { actionId: 'act_preview_pending', estimatedUsd: 30.02, decision: 'needs-approval' },
          prevHash: 'b'.repeat(64),
          hash: 'c'.repeat(64)
        },
        {
          seq: 2,
          at: Date.now() - 3_600_000,
          kind: 'gate',
          summary: 'Gate block for transfer',
          detail: { actionId: 'act_preview_blocked', reason: 'Mainnet authorisation' },
          prevHash: 'a'.repeat(64),
          hash: 'b'.repeat(64)
        },
        {
          seq: 1,
          at: Date.now() - 86_400_000,
          kind: 'vault',
          summary: 'Vault created',
          detail: { accounts: 2 },
          prevHash: '0'.repeat(64),
          hash: 'a'.repeat(64)
        }
      ],
      verify: async () => ({ ok: true, entries: 3, brokenAtSeq: null })
    },
    memory: {
      forget: async () => true,
      clear: async () => true,
      updateSettings: async () => ({ embedded: 0, failed: 0 }),
      probeEmbeddings: async () => ({
        ok: false,
        model: DEFAULT_EMBEDDING_MODEL,
        dimensions: null,
        latencyMs: 0,
        detail: 'Preview mode.'
      }),
      backfill: async () => ({ embedded: 0, failed: 0 })
    },
    update: {
      check: async () => current.update,
      download: async () => current.update,
      install: unsupported
    },
    airdrop: unsupported,
    openExternal: async () => true,
    onSnapshot: () => () => undefined
  }
}
