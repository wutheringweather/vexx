import type {
  ActionRecord,
  ExecutionMode,
  ExecutionResult,
  ProposedAction
} from '@shared/types'
import { findNetwork } from '@shared/constants'
import { newId } from '../storage/files'
import * as state from '../state'
import * as audit from '../audit/log'
import * as lessons from '../memory/lessons'
import { evaluate } from '../guard/gate'
import { isUnlocked, publicAddresses } from '../vault/keystore'
import * as evm from '../chains/evm'
import * as solana from '../chains/solana'

/**
 * The one path from "the agent wants to do something" to "something happened".
 *
 * Nothing else in the codebase may execute a fund-moving action. Every entry
 * point funnels through `propose`, which always runs the gate first, and
 * `execute`, which refuses to run on a record the gate did not clear.
 */

function gateContextFor(missionId: string | null, mode: ExecutionMode) {
  const s = state.current()
  const mission = missionId ? s.missions.find((m) => m.id === missionId) : null
  return {
    policy: s.policy,
    mode,
    missionDeployedUsd: mission?.deployedUsd ?? 0,
    missionRealisedUsd: mission?.realisedUsd ?? 0,
    vaultUnlocked: isUnlocked()
  }
}

export async function propose(
  action: ProposedAction,
  rationale: string,
  missionId: string | null = null
): Promise<ActionRecord> {
  const s = await state.load()
  const mode = s.mode
  const verdict = evaluate(action, gateContextFor(missionId, mode))

  const record: ActionRecord = {
    id: newId('act'),
    action,
    rationale,
    status: verdict.decision === 'block' ? 'blocked' : 'pending',
    verdict,
    mode,
    missionId,
    createdAt: Date.now(),
    resolvedAt: verdict.decision === 'block' ? Date.now() : null,
    execution: null
  }

  await state.update((draft) => {
    draft.actions.push(record)
  })

  await audit.record('gate', `Gate ${verdict.decision} for ${action.kind}`, {
    actionId: record.id,
    kind: action.kind,
    networkId: action.networkId,
    estimatedUsd: action.estimatedUsd,
    decision: verdict.decision,
    reason: verdict.reason,
    failedChecks: verdict.checks.filter((c) => !c.passed).map((c) => c.id)
  })

  if (verdict.decision === 'block') {
    // A refusal is a result worth remembering, not just a dead end.
    await lessons.remember(
      'procedural',
      `A ${action.kind} on ${action.networkId} was blocked by the gate: ${verdict.reason}`,
      ['gate', 'blocked', action.kind]
    )
    return record
  }

  if (verdict.decision === 'allow') {
    // Full-autonomy modes skip the human, never the gate.
    return executeApproved(record.id, 'auto')
  }

  return record
}

export async function approve(actionId: string): Promise<ActionRecord> {
  const record = state.findAction(actionId)
  if (!record) throw new Error('No such action.')
  if (record.status !== 'pending') throw new Error(`Action is already ${record.status}.`)

  // Re-run the gate at approval time. Policy or balances may have moved since
  // the proposal, and the stale verdict must not be what authorises a signature.
  const verdict = evaluate(record.action, gateContextFor(record.missionId, record.mode))
  if (verdict.decision === 'block') {
    await state.update((draft) => {
      const target = draft.actions.find((a) => a.id === actionId)
      if (target) {
        target.status = 'blocked'
        target.verdict = verdict
        target.resolvedAt = Date.now()
      }
    })
    await audit.record('gate', 'Re-check at approval blocked the action', {
      actionId,
      reason: verdict.reason
    })
    return state.findAction(actionId)!
  }

  await audit.record('approval', 'Operator approved an action', {
    actionId,
    kind: record.action.kind,
    estimatedUsd: record.action.estimatedUsd
  })
  return executeApproved(actionId, 'operator')
}

export async function reject(actionId: string, note = ''): Promise<ActionRecord> {
  const record = state.findAction(actionId)
  if (!record) throw new Error('No such action.')
  if (record.status !== 'pending') throw new Error(`Action is already ${record.status}.`)

  await state.update((draft) => {
    const target = draft.actions.find((a) => a.id === actionId)
    if (target) {
      target.status = 'rejected'
      target.resolvedAt = Date.now()
    }
  })
  await audit.record('approval', 'Operator rejected an action', { actionId, note })
  await lessons.remember(
    'episodic',
    `The operator rejected a ${record.action.kind} on ${record.action.networkId}${
      note ? `: ${note}` : '.'
    }`,
    ['rejected', record.action.kind]
  )
  return state.findAction(actionId)!
}

async function executeApproved(
  actionId: string,
  approvedBy: 'operator' | 'auto'
): Promise<ActionRecord> {
  const record = state.findAction(actionId)
  if (!record) throw new Error('No such action.')

  const result = await runAction(record)

  await state.update((draft) => {
    const target = draft.actions.find((a) => a.id === actionId)
    if (!target) return
    target.status = result.ok ? 'executed' : 'failed'
    target.execution = result
    target.resolvedAt = Date.now()

    if (target.missionId) {
      const mission = draft.missions.find((m) => m.id === target.missionId)
      if (mission) {
        mission.deployedUsd += target.action.estimatedUsd
        mission.realisedUsd += result.realisedUsd
      }
    }
  })

  await audit.record('execution', result.ok ? 'Action executed' : 'Action failed', {
    actionId,
    approvedBy,
    simulated: result.simulated,
    txHash: result.txHash,
    detail: result.detail,
    realisedUsd: result.realisedUsd
  })

  await lessons.remember(
    result.ok ? 'episodic' : 'procedural',
    result.ok
      ? `A ${record.action.kind} on ${record.action.networkId} completed${
          result.simulated ? ' in simulation' : ''
        }: ${result.detail}`
      : `A ${record.action.kind} on ${record.action.networkId} failed: ${result.detail}`,
    [record.action.kind, result.ok ? 'success' : 'failure']
  )

  return state.findAction(actionId)!
}

/**
 * Swaps always simulate: testnets have no real liquidity, and quoting one thing
 * while doing another is exactly the kind of gap the audit log exists to close.
 * Transfers broadcast for real on whichever network is selected.
 */
async function runAction(record: ActionRecord): Promise<ExecutionResult> {
  const network = findNetwork(record.action.networkId)
  const base = { simulated: true, txHash: null, explorerUrl: null, realisedUsd: 0, at: Date.now() }

  if (!network) {
    return { ...base, ok: false, detail: `Unknown network "${record.action.networkId}".` }
  }

  const addresses = publicAddresses()
  const from = network.family === 'evm' ? addresses.evm : addresses.solana
  if (!from) return { ...base, ok: false, detail: 'Vault is locked.' }

  try {
    if (record.action.kind === 'swap') {
      const { sellSymbol, buySymbol, sellAmount, expectedBuyAmount } = record.action
      return {
        ...base,
        ok: true,
        detail: `Simulated swap of ${sellAmount} ${sellSymbol} for about ${expectedBuyAmount} ${buySymbol} on ${network.label}. No routing was performed and no funds moved.`
      }
    }

    const { to, amount } = record.action

    if (network.family === 'evm') {
      if (!evm.isValidAddress(to)) {
        return { ...base, ok: false, detail: `"${to}" is not a valid EVM address.` }
      }
      const sim = await evm.simulateNative(network, from, to, amount)
      if (!sim.ok) return { ...base, ok: false, detail: sim.detail }

      const sent = await evm.sendNative(network, to, amount)
      return {
        simulated: false,
        ok: true,
        txHash: sent.txHash,
        explorerUrl: sent.explorerUrl,
        detail: `Broadcast ${amount} ${network.nativeSymbol} to ${to} on ${network.label}.`,
        realisedUsd: 0,
        at: Date.now()
      }
    }

    if (!solana.isValidAddress(to)) {
      return { ...base, ok: false, detail: `"${to}" is not a valid Solana address.` }
    }
    const sim = await solana.simulateNative(network, from, to, amount)
    if (!sim.ok) return { ...base, ok: false, detail: sim.detail }

    const sent = await solana.sendNative(network, to, amount)
    return {
      simulated: false,
      ok: true,
      txHash: sent.txHash,
      explorerUrl: sent.explorerUrl,
      detail: `Broadcast ${amount} SOL to ${to} on ${network.label}.`,
      realisedUsd: 0,
      at: Date.now()
    }
  } catch (err) {
    return { ...base, ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}

/** Clears the queue when the operator hits the kill switch. */
export async function expireAllPending(reason: string): Promise<number> {
  const pending = state.pendingActions()
  if (pending.length === 0) return 0

  await state.update((draft) => {
    for (const action of draft.actions) {
      if (action.status === 'pending') {
        action.status = 'expired'
        action.resolvedAt = Date.now()
      }
    }
  })
  await audit.record('approval', 'Pending actions expired', { count: pending.length, reason })
  return pending.length
}
