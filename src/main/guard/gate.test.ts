import { describe, expect, it } from 'vitest'
import type { Policy, ProposedAction } from '@shared/types'
import { DEFAULT_POLICY } from '@shared/constants'
import { evaluate, type GateContext } from './gate'

function ctx(overrides: Partial<GateContext> = {}, policy: Partial<Policy> = {}): GateContext {
  return {
    policy: { ...DEFAULT_POLICY, ...policy },
    mode: 'agent-full',
    missionDeployedUsd: 0,
    missionRealisedUsd: 0,
    vaultUnlocked: true,
    ...overrides
  }
}

const transfer = (over: Partial<Extract<ProposedAction, { kind: 'transfer' }>> = {}): ProposedAction => ({
  kind: 'transfer',
  networkId: 'eth-sepolia',
  to: '0x1111111111111111111111111111111111111111',
  amount: '0.01',
  symbol: 'ETH',
  estimatedUsd: 30,
  ...over
})

const swap = (over: Partial<Extract<ProposedAction, { kind: 'swap' }>> = {}): ProposedAction => ({
  kind: 'swap',
  networkId: 'eth-sepolia',
  sellSymbol: 'ETH',
  buySymbol: 'USDC',
  sellAmount: '0.01',
  expectedBuyAmount: '30.0',
  slippageBps: 30,
  estimatedUsd: 30,
  ...over
})

const liveBuy = (over: Partial<Extract<ProposedAction, { kind: 'swap' }>> = {}): ProposedAction =>
  swap({
    networkId: 'sol-mainnet',
    sellSymbol: 'USDC',
    buySymbol: 'SOL',
    sellAmount: '1',
    expectedBuyAmount: '0.006',
    execution: 'live',
    targetBuyAmount: '0.005',
    estimatedUsd: 1,
    ...over
  })

describe('safety gate', () => {
  it('allows a compliant swap in a full-autonomy mode', () => {
    const verdict = evaluate(swap(), ctx())
    expect(verdict.decision).toBe('allow')
    expect(verdict.reason).toBeNull()
    expect(verdict.checks.every((c) => c.passed)).toBe(true)
  })

  it('blocks a live swap without a configured Jupiter provider', () => {
    const verdict = evaluate(liveBuy(), ctx({ liveExecutionReady: false }, { mainnetEnabled: true }))
    expect(verdict.decision).toBe('block')
    expect(verdict.reason).toContain('Jupiter')
  })

  it('blocks a live swap on devnet even when a provider exists', () => {
    const verdict = evaluate(
      liveBuy({ networkId: 'sol-devnet' }),
      ctx({ liveExecutionReady: true }, { mainnetEnabled: true })
    )
    expect(verdict.decision).toBe('block')
    expect(verdict.reason).toContain('Solana mainnet')
  })

  it('allows a configured live swap only after mainnet is explicitly enabled', () => {
    expect(
      evaluate(liveBuy(), ctx({ liveExecutionReady: true }, { mainnetEnabled: true })).decision
    ).toBe('allow')
    expect(
      evaluate(liveBuy(), ctx({ liveExecutionReady: true }, { mainnetEnabled: false })).decision
    ).toBe('block')
  })

  it('requires approval for the same swap in a restricted mode', () => {
    expect(evaluate(swap(), ctx({ mode: 'agent-restricted' })).decision).toBe('needs-approval')
    expect(evaluate(swap(), ctx({ mode: 'mission-restricted' })).decision).toBe('needs-approval')
  })

  it('treats an unrecognised mode as the strictest one', () => {
    const verdict = evaluate(swap(), ctx({ mode: 'not-a-mode' as never }))
    expect(verdict.decision).toBe('needs-approval')
  })

  it('blocks when the emergency stop is engaged', () => {
    const verdict = evaluate(swap(), ctx({}, { emergencyStop: true }))
    expect(verdict.decision).toBe('block')
    expect(verdict.reason).toContain('Emergency stop')
  })

  it('blocks when the vault is locked', () => {
    expect(evaluate(swap(), ctx({ vaultUnlocked: false })).decision).toBe('block')
  })

  it('blocks a mainnet action while mainnet is disabled', () => {
    const verdict = evaluate(swap({ networkId: 'eth-mainnet' }), ctx())
    expect(verdict.decision).toBe('block')
    expect(verdict.reason).toContain('Mainnet')
  })

  it('allows the same mainnet action once mainnet is enabled', () => {
    const verdict = evaluate(swap({ networkId: 'eth-mainnet' }), ctx({}, { mainnetEnabled: true }))
    expect(verdict.decision).toBe('allow')
  })

  it('blocks an unknown network rather than assuming it is safe', () => {
    const verdict = evaluate(swap({ networkId: 'chain-that-does-not-exist' }), ctx())
    expect(verdict.decision).toBe('block')
  })

  it('enforces the per-action cap', () => {
    const verdict = evaluate(swap({ estimatedUsd: 5000 }), ctx())
    expect(verdict.decision).toBe('block')
    expect(verdict.reason).toContain('Per-action cap')
  })

  it('enforces the mission capital cap cumulatively', () => {
    const policy = { maxNotionalUsdPerMission: 100, maxNotionalUsdPerAction: 100 }
    expect(evaluate(swap({ estimatedUsd: 40 }), ctx({ missionDeployedUsd: 50 }, policy)).decision).toBe('allow')
    expect(evaluate(swap({ estimatedUsd: 60 }), ctx({ missionDeployedUsd: 50 }, policy)).decision).toBe('block')
  })

  it('blocks once the max loss floor is breached', () => {
    const verdict = evaluate(swap(), ctx({ missionRealisedUsd: -30 }, { maxLossUsd: 25 }))
    expect(verdict.decision).toBe('block')
    expect(verdict.reason).toContain('Max loss')
  })

  it('blocks a swap quoting worse slippage than the cap', () => {
    const verdict = evaluate(swap({ slippageBps: 400 }), ctx({}, { maxSlippageBps: 100 }))
    expect(verdict.decision).toBe('block')
    expect(verdict.reason).toContain('Slippage')
  })

  it('blocks tokens outside the allowlist', () => {
    const verdict = evaluate(swap({ buySymbol: 'SHIB' }), ctx())
    expect(verdict.decision).toBe('block')
  })

  it('refuses every transfer while the allowlist is empty', () => {
    const verdict = evaluate(transfer(), ctx())
    expect(verdict.decision).toBe('block')
    expect(verdict.reason).toContain('allowlist')
  })

  it('allows a transfer to an allowlisted destination, case-insensitively', () => {
    const verdict = evaluate(
      transfer(),
      ctx({}, { transferAllowlist: ['0X1111111111111111111111111111111111111111'] })
    )
    expect(verdict.decision).toBe('allow')
  })

  it('blocks non-numeric and non-positive amounts', () => {
    const policy = { transferAllowlist: ['0x1111111111111111111111111111111111111111'] }
    expect(evaluate(transfer({ amount: 'all of it' }), ctx({}, policy)).decision).toBe('block')
    expect(evaluate(transfer({ amount: '0' }), ctx({}, policy)).decision).toBe('block')
    expect(evaluate(transfer({ amount: '-1' }), ctx({}, policy)).decision).toBe('block')
  })

  it('blocks a NaN notional instead of treating it as zero', () => {
    const verdict = evaluate(swap({ estimatedUsd: Number.NaN }), ctx())
    expect(verdict.decision).toBe('block')
  })

  it('blocks a swap with no usable quote', () => {
    expect(evaluate(swap({ expectedBuyAmount: '0' }), ctx()).decision).toBe('block')
    expect(evaluate(swap({ expectedBuyAmount: 'unknown' }), ctx()).decision).toBe('block')
  })

  it('fails closed when the policy object is unusable', () => {
    const verdict = evaluate(swap(), ctx({ policy: null as never }))
    expect(verdict.decision).toBe('block')
  })
})
