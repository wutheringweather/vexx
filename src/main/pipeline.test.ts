import { beforeAll, describe, expect, it } from 'vitest'
import * as state from './state'
import * as keystore from './vault/keystore'
import * as actions from './agent/actions'
import * as audit from './audit/log'
import * as lessons from './memory/lessons'
import { dispatch } from './agent/tools'

/**
 * End-to-end over the real pipeline: create a vault, set a policy, push actions
 * through the gate, and check that what came out the other side matches what
 * the audit log says happened.
 *
 * Network-touching execution is exercised only along paths that fail before a
 * broadcast, so this never needs a live RPC.
 */

const PASSWORD = 'Corr3ct-Horse-Battery!'
const ALLOWED = '0x1111111111111111111111111111111111111111'

describe('action pipeline', () => {
  beforeAll(async () => {
    await state.load()
    await keystore.create(PASSWORD)
  })

  it('creates a vault with both an EVM and a Solana account', async () => {
    const status = await keystore.status()
    expect(status.state).toBe('unlocked')
    expect(status.accounts.map((a) => a.family).sort()).toEqual(['evm', 'solana'])
    expect(status.accounts[0]!.address.length).toBeGreaterThan(20)
  })

  it('refuses a transfer to an address that is not allowlisted', async () => {
    const record = await actions.propose(
      {
        kind: 'transfer',
        networkId: 'eth-sepolia',
        to: '0x2222222222222222222222222222222222222222',
        amount: '0.001',
        symbol: 'ETH',
        estimatedUsd: 3
      },
      'test: destination not on the allowlist'
    )
    expect(record.status).toBe('blocked')
    expect(record.verdict.reason).toContain('allowlist')
    expect(record.execution).toBeNull()
  })

  it('queues an allowlisted transfer for approval in a restricted mode', async () => {
    await state.update((draft) => {
      draft.mode = 'agent-restricted'
      draft.policy.transferAllowlist = [ALLOWED]
    })

    const record = await actions.propose(
      {
        kind: 'transfer',
        networkId: 'eth-sepolia',
        to: ALLOWED,
        amount: '0.001',
        symbol: 'ETH',
        estimatedUsd: 3
      },
      'test: should wait for a human'
    )
    expect(record.status).toBe('pending')
    expect(record.verdict.decision).toBe('needs-approval')
    expect(state.pendingActions().map((a) => a.id)).toContain(record.id)
  })

  it('re-runs the gate at approval time and refuses on a stale verdict', async () => {
    const pending = state.pendingActions()[0]
    expect(pending).toBeDefined()

    // Policy tightens after the proposal but before the approval.
    await state.update((draft) => {
      draft.policy.transferAllowlist = []
    })

    const resolved = await actions.approve(pending!.id)
    expect(resolved.status).toBe('blocked')
    expect(resolved.execution).toBeNull()
  })

  it('refuses everything once the emergency stop is engaged', async () => {
    await state.update((draft) => {
      draft.policy.emergencyStop = true
      draft.policy.transferAllowlist = [ALLOWED]
    })

    const record = await actions.propose(
      {
        kind: 'transfer',
        networkId: 'eth-sepolia',
        to: ALLOWED,
        amount: '0.001',
        symbol: 'ETH',
        estimatedUsd: 3
      },
      'test: emergency stop engaged'
    )
    expect(record.status).toBe('blocked')
    expect(record.verdict.reason).toContain('Emergency stop')

    await state.update((draft) => {
      draft.policy.emergencyStop = false
    })
  })

  it('executes an auto-approved swap as a simulation, never a broadcast', async () => {
    await state.update((draft) => {
      draft.mode = 'agent-full'
    })

    const record = await actions.propose(
      {
        kind: 'swap',
        networkId: 'eth-sepolia',
        sellSymbol: 'ETH',
        buySymbol: 'USDC',
        sellAmount: '0.01',
        expectedBuyAmount: '30.0',
        slippageBps: 30,
        estimatedUsd: 30
      },
      'test: full autonomy skips the human, not the gate'
    )

    expect(record.status).toBe('executed')
    expect(record.execution?.simulated).toBe(true)
    expect(record.execution?.txHash).toBeNull()
  })

  it('expires the whole queue when the kill switch is pulled', async () => {
    await state.update((draft) => {
      draft.mode = 'agent-restricted'
    })
    await actions.propose(
      {
        kind: 'swap',
        networkId: 'eth-sepolia',
        sellSymbol: 'ETH',
        buySymbol: 'USDC',
        sellAmount: '0.01',
        expectedBuyAmount: '30.0',
        slippageBps: 30,
        estimatedUsd: 30
      },
      'test: about to be expired'
    )
    expect(state.pendingActions().length).toBeGreaterThan(0)

    const expired = await actions.expireAllPending('test')
    expect(expired).toBeGreaterThan(0)
    expect(state.pendingActions().length).toBe(0)
  })

  it('records every decision in an intact audit chain', async () => {
    const verification = await audit.verify()
    expect(verification.ok).toBe(true)
    expect(verification.entries).toBeGreaterThan(5)

    const entries = await audit.list(200)
    expect(entries.some((e) => e.kind === 'gate')).toBe(true)
    expect(entries.some((e) => e.kind === 'execution')).toBe(true)
  })

  it('learns from what the gate refused', async () => {
    const stored = await lessons.all()
    expect(stored.some((l) => l.tags.includes('blocked'))).toBe(true)
  })

  it('validates tool arguments before they reach chain code', async () => {
    const result = await dispatch(
      'propose_transfer',
      { networkId: 'eth-sepolia', to: ALLOWED },
      { missionId: null }
    )
    expect(result.summary).toContain('Rejected')
    expect(result.data.error).toBe('invalid-arguments')
  })

  it('rejects a call to a tool that does not exist', async () => {
    const result = await dispatch('drain_wallet', {}, { missionId: null })
    expect(result.data.error).toBe('unknown-tool')
  })

  it('blocks every fund-moving action once the vault is locked', async () => {
    keystore.lock()
    await state.update((draft) => {
      draft.mode = 'agent-full'
    })

    const record = await actions.propose(
      {
        kind: 'swap',
        networkId: 'eth-sepolia',
        sellSymbol: 'ETH',
        buySymbol: 'USDC',
        sellAmount: '0.01',
        expectedBuyAmount: '30.0',
        slippageBps: 30,
        estimatedUsd: 30
      },
      'test: locked vault'
    )
    expect(record.status).toBe('blocked')
    expect(record.verdict.reason).toContain('Vault')
  })

  it('will not hand out signing keys while locked', () => {
    expect(() => keystore.requireEvmKey()).toThrow(/locked/i)
    expect(() => keystore.requireSolanaKey()).toThrow(/locked/i)
    expect(keystore.publicAddresses().evm).toBeNull()
  })

  it('restores access after unlocking with the right password', async () => {
    await keystore.unlock(PASSWORD)
    expect(keystore.isUnlocked()).toBe(true)
    expect(keystore.requireEvmKey().address.startsWith('0x')).toBe(true)
  })

  it('rejects a wrong password', async () => {
    await expect(keystore.unlock('not the password')).rejects.toThrow(/Wrong master password/)
  })
})
