/**
 * The contract between the privileged main process and the sandboxed renderer.
 *
 * Nothing in here may carry a private key, a mnemonic or the master password.
 * The renderer is untrusted by design: it renders what main tells it and asks
 * main to do things. Signing authority never crosses this boundary.
 */

// ---------------------------------------------------------------------------
// Chains & accounts
// ---------------------------------------------------------------------------

export type ChainFamily = 'evm' | 'solana'

export interface NetworkInfo {
  id: string
  family: ChainFamily
  label: string
  /** Testnets are the default. Mainnets are gated behind an explicit unlock. */
  isMainnet: boolean
  nativeSymbol: string
  decimals: number
  rpcUrl: string
  explorerTxUrl: string
  explorerAddressUrl: string
  /** EVM only. */
  chainId?: number
}

export interface AccountInfo {
  family: ChainFamily
  label: string
  address: string
  derivationPath: string
}

export interface BalanceInfo {
  networkId: string
  address: string
  /** Base units as a decimal string — never a JS number, precision matters. */
  raw: string
  formatted: string
  symbol: string
  decimals: number
  fetchedAt: number
  error?: string
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

export type VaultState = 'absent' | 'locked' | 'unlocked'

export interface VaultStatus {
  state: VaultState
  accounts: AccountInfo[]
  /** Epoch ms at which an idle vault auto-locks; null when locked or disabled. */
  autoLockAt: number | null
  createdAt: number | null
}

export interface VaultCreateResult {
  /** Shown exactly once, at creation. Never persisted in plaintext, never re-derivable from the UI. */
  mnemonic: string
  accounts: AccountInfo[]
}

// ---------------------------------------------------------------------------
// Execution modes
// ---------------------------------------------------------------------------

/**
 * Restricted  -> the runtime pauses for a human before anything moves money.
 * Full        -> no approval pause, but the guardrail gate still runs and can still refuse.
 * Agent       -> one task, one pass.
 * Mission     -> autonomous multi-step loop until a termination condition fires.
 */
export type ExecutionMode =
  | 'agent-restricted'
  | 'agent-full'
  | 'mission-restricted'
  | 'mission-full'

export interface ExecutionModeInfo {
  id: ExecutionMode
  label: string
  autonomy: 'agent' | 'mission'
  requiresApproval: boolean
  blurb: string
}

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

export interface Policy {
  /** Hard ceiling on a single action, denominated in USD. */
  maxNotionalUsdPerAction: number
  /** Hard ceiling on everything one mission may deploy, in USD. */
  maxNotionalUsdPerMission: number
  /** Mission aborts once realised loss crosses this, in USD. */
  maxLossUsd: number
  /** Reject a swap whose quoted slippage exceeds this, in basis points. */
  maxSlippageBps: number
  /** Mission aborts after this many minutes. */
  missionDeadlineMinutes: number
  /** Mission aborts after this many steps, so a loop cannot run forever. */
  maxMissionSteps: number
  /** Transfers may only go to these addresses. Empty list = no transfers at all. */
  transferAllowlist: string[]
  /** Swaps may only touch these token symbols. Empty list = no swaps at all. */
  tokenAllowlist: string[]
  /**
   * Master switch for real funds. False keeps every network selection on a
   * testnet and refuses any action whose network is a mainnet.
   */
  mainnetEnabled: boolean
  /** Kill switch. When true every fund-moving action is refused outright. */
  emergencyStop: boolean
}

export type GateDecision = 'allow' | 'needs-approval' | 'block'

export interface GateCheck {
  id: string
  label: string
  passed: boolean
  detail: string
}

export interface GateVerdict {
  decision: GateDecision
  checks: GateCheck[]
  /** Populated for 'block'. The first failing check's reason, in plain language. */
  reason: string | null
  evaluatedAt: number
}

// ---------------------------------------------------------------------------
// Actions & approvals
// ---------------------------------------------------------------------------

export type ActionKind = 'transfer' | 'swap'

export interface TransferAction {
  kind: 'transfer'
  networkId: string
  to: string
  /** Human-readable amount, e.g. "0.25". */
  amount: string
  symbol: string
  estimatedUsd: number
}

export interface SwapAction {
  kind: 'swap'
  networkId: string
  sellSymbol: string
  buySymbol: string
  sellAmount: string
  /** Best-effort quote; the gate compares this against maxSlippageBps. */
  expectedBuyAmount: string
  slippageBps: number
  estimatedUsd: number
}

export type ProposedAction = TransferAction | SwapAction

export type ActionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'blocked'
  | 'executed'
  | 'failed'
  | 'expired'

export interface ActionRecord {
  id: string
  action: ProposedAction
  rationale: string
  status: ActionStatus
  verdict: GateVerdict
  mode: ExecutionMode
  missionId: string | null
  createdAt: number
  resolvedAt: number | null
  /** Simulation is the default; a real broadcast only happens on mainnet + live mode. */
  execution: ExecutionResult | null
}

export interface ExecutionResult {
  simulated: boolean
  ok: boolean
  txHash: string | null
  explorerUrl: string | null
  detail: string
  /** Realised profit/loss in USD, negative for a loss. */
  realisedUsd: number
  at: number
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

export type MissionStatus = 'running' | 'paused' | 'finished'

export type TerminationReason =
  | 'objective-met'
  | 'deadline-reached'
  | 'capital-exhausted'
  | 'max-loss-hit'
  | 'no-opportunities'
  | 'step-limit-reached'
  | 'emergency-stop'
  | 'operator-stopped'
  | 'runtime-error'

export interface MissionStep {
  index: number
  at: number
  thought: string
  toolName: string | null
  toolSummary: string | null
  actionId: string | null
}

export interface Mission {
  id: string
  objective: string
  mode: ExecutionMode
  status: MissionStatus
  steps: MissionStep[]
  startedAt: number
  endedAt: number | null
  deadlineAt: number
  terminationReason: TerminationReason | null
  terminationDetail: string | null
  deployedUsd: number
  realisedUsd: number
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/**
 * Three tiers, shortest-lived first. What gets stored is a lesson — a durable
 * judgement — never a balance and never anything that looks like a secret.
 */
export type MemoryTier = 'episodic' | 'semantic' | 'procedural'

export interface Lesson {
  id: string
  tier: MemoryTier
  text: string
  tags: string[]
  createdAt: number
  lastReinforcedAt: number
  /** Strength at last reinforcement. Effective strength decays from here. */
  baseStrength: number
  /** Strength after decay, recomputed on read. Half-life is 30 days. */
  strength: number
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type AuditKind =
  | 'vault'
  | 'policy'
  | 'agent'
  | 'gate'
  | 'approval'
  | 'execution'
  | 'mission'
  | 'system'

export interface AuditEntry {
  seq: number
  at: number
  kind: AuditKind
  summary: string
  detail: Record<string, unknown>
  /** sha256 over (prevHash + canonical entry body). Makes silent edits detectable. */
  prevHash: string
  hash: string
}

export interface AuditVerification {
  ok: boolean
  entries: number
  brokenAtSeq: number | null
}

// ---------------------------------------------------------------------------
// Agent / chat
// ---------------------------------------------------------------------------

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  at: number
  toolName?: string
  /** Set when this turn produced an action that landed in the approval queue. */
  actionId?: string
  /** True when the local deterministic planner answered instead of the LLM. */
  offline?: boolean
}

export interface LlmSettings {
  baseUrl: string
  model: string
  /** Never returned to the renderer. The status flag below is all the UI gets. */
  hasApiKey: boolean
  temperature: number
  maxTokens: number
}

export interface LlmProbeResult {
  ok: boolean
  model: string
  latencyMs: number
  detail: string
}

export interface MemorySettings {
  /** When false, recall is lexical and nothing about memory leaves the machine. */
  embeddingsEnabled: boolean
  embeddingModel: string
  /** How many stored lessons currently have a vector. */
  embeddedCount: number
  totalCount: number
}

export interface EmbeddingProbeResult {
  ok: boolean
  model: string
  dimensions: number | null
  latencyMs: number
  detail: string
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'current'
  | 'error'
  | 'unsupported'

export interface UpdateStatus {
  state: UpdateState
  currentVersion: string
  availableVersion: string | null
  detail: string
  progressPercent: number | null
  /** False in dev, or when the build carries no release feed. */
  supported: boolean
}

// ---------------------------------------------------------------------------
// Aggregate snapshot pushed to the renderer
// ---------------------------------------------------------------------------

export interface AppSnapshot {
  vault: VaultStatus
  policy: Policy
  mode: ExecutionMode
  networks: NetworkInfo[]
  activeEvmNetworkId: string
  activeSolanaNetworkId: string
  balances: BalanceInfo[]
  pendingActions: ActionRecord[]
  recentActions: ActionRecord[]
  missions: Mission[]
  lessons: Lesson[]
  llm: LlmSettings
  memory: MemorySettings
  update: UpdateStatus
  version: string
}
