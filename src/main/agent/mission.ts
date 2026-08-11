import type { ChatMessage, ExecutionMode, Mission, MissionStep, TerminationReason } from '@shared/types'
import { EXECUTION_MODES } from '@shared/constants'
import { newId } from '../storage/files'
import * as state from '../state'
import * as audit from '../audit/log'
import * as lessons from '../memory/lessons'
import { isUnlocked } from '../vault/keystore'
import { runTurn } from './runner'

/**
 * The autonomous loop.
 *
 * Every iteration re-reads policy from disk-backed state and re-checks the
 * termination conditions before doing anything. That means flipping the
 * emergency stop, tightening a cap or hitting Stop takes effect on the next
 * step — a running mission can always be reined in without killing the app.
 */

type Listener = (mission: Mission) => void

const listeners = new Set<Listener>()
const running = new Map<string, { stop: boolean }>()

export function onMissionUpdate(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(mission: Mission): void {
  for (const listener of listeners) listener(mission)
}

const TERMINATION_COPY: Record<TerminationReason, string> = {
  'objective-met': 'Objective met',
  'deadline-reached': 'Deadline reached',
  'capital-exhausted': 'Capital allocation exhausted',
  'max-loss-hit': 'Max loss triggered',
  'no-opportunities': 'No opportunities found',
  'step-limit-reached': 'Step limit reached',
  'emergency-stop': 'Emergency stop engaged',
  'operator-stopped': 'Stopped by operator',
  'runtime-error': 'Runtime error'
}

export function terminationLabel(reason: TerminationReason): string {
  return TERMINATION_COPY[reason]
}

/** Checked before every step. Order matters: safety conditions come first. */
function checkTermination(mission: Mission): { reason: TerminationReason; detail: string } | null {
  const s = state.current()

  if (s.policy.emergencyStop) {
    return { reason: 'emergency-stop', detail: 'The emergency stop was engaged.' }
  }
  if (running.get(mission.id)?.stop) {
    return { reason: 'operator-stopped', detail: 'The operator stopped the mission.' }
  }
  if (Date.now() >= mission.deadlineAt) {
    return {
      reason: 'deadline-reached',
      detail: `The ${s.policy.missionDeadlineMinutes}-minute deadline elapsed.`
    }
  }
  if (mission.realisedUsd <= -s.policy.maxLossUsd) {
    return {
      reason: 'max-loss-hit',
      detail: `Realised $${mission.realisedUsd.toFixed(2)} against a -$${s.policy.maxLossUsd.toFixed(2)} floor.`
    }
  }
  if (mission.deployedUsd >= s.policy.maxNotionalUsdPerMission) {
    return {
      reason: 'capital-exhausted',
      detail: `Deployed $${mission.deployedUsd.toFixed(2)} of a $${s.policy.maxNotionalUsdPerMission.toFixed(2)} allocation.`
    }
  }
  if (mission.steps.length >= s.policy.maxMissionSteps) {
    return {
      reason: 'step-limit-reached',
      detail: `Reached the ${s.policy.maxMissionSteps}-step limit.`
    }
  }
  return null
}

/** The agent signalling it is done, read from its own prose. */
function readAgentSignal(text: string): TerminationReason | null {
  const lower = text.toLowerCase()
  if (/\b(objective (is )?(met|complete|achieved)|mission complete|task complete)\b/.test(lower)) {
    return 'objective-met'
  }
  if (/\b(no (viable |good |clear )?opportunit(y|ies)|nothing (worth|to) (do|act on)|no action (is )?warranted)\b/.test(lower)) {
    return 'no-opportunities'
  }
  return null
}

async function finish(
  missionId: string,
  reason: TerminationReason,
  detail: string
): Promise<Mission> {
  await state.update((draft) => {
    const mission = draft.missions.find((m) => m.id === missionId)
    if (!mission) return
    mission.status = 'finished'
    mission.endedAt = Date.now()
    mission.terminationReason = reason
    mission.terminationDetail = detail
  })
  running.delete(missionId)

  const mission = state.findMission(missionId)!
  await audit.record('mission', `Mission finished: ${TERMINATION_COPY[reason]}`, {
    missionId,
    reason,
    detail,
    steps: mission.steps.length,
    deployedUsd: mission.deployedUsd,
    realisedUsd: mission.realisedUsd
  })

  await lessons.remember(
    reason === 'objective-met' ? 'episodic' : 'procedural',
    `Mission "${mission.objective}" ended: ${TERMINATION_COPY[reason]}. ${detail}`,
    ['mission', reason]
  )

  emit(mission)
  return mission
}

export async function start(objective: string, mode?: ExecutionMode): Promise<Mission> {
  const s = await state.load()
  const chosen = mode ?? s.mode
  const info = EXECUTION_MODES.find((m) => m.id === chosen)

  if (info?.autonomy !== 'mission') {
    throw new Error(`${info?.label ?? chosen} is a single-turn mode. Switch to a Mission mode first.`)
  }
  if (!isUnlocked()) throw new Error('Unlock the vault before starting a mission.')
  if (s.policy.emergencyStop) throw new Error('The emergency stop is engaged.')
  if (s.missions.some((m) => m.status === 'running')) {
    throw new Error('A mission is already running. Stop it before starting another.')
  }

  const mission: Mission = {
    id: newId('msn'),
    objective: objective.trim(),
    mode: chosen,
    status: 'running',
    steps: [],
    startedAt: Date.now(),
    endedAt: null,
    deadlineAt: Date.now() + s.policy.missionDeadlineMinutes * 60 * 1000,
    terminationReason: null,
    terminationDetail: null,
    deployedUsd: 0,
    realisedUsd: 0
  }

  await state.update((draft) => {
    draft.missions.push(mission)
  })
  running.set(mission.id, { stop: false })

  await audit.record('mission', 'Mission started', {
    missionId: mission.id,
    objective: mission.objective,
    mode: chosen,
    deadlineAt: mission.deadlineAt
  })
  emit(mission)

  // Fire and forget: the loop reports through emit(), and a throw inside it is
  // handled by finishing the mission rather than crashing the process.
  void loop(mission.id).catch(async (err) => {
    await finish(mission.id, 'runtime-error', err instanceof Error ? err.message : String(err))
  })

  return mission
}

async function loop(missionId: string): Promise<void> {
  const history: ChatMessage[] = []

  for (;;) {
    const mission = state.findMission(missionId)
    if (!mission || mission.status !== 'running') return

    const termination = checkTermination(mission)
    if (termination) {
      await finish(missionId, termination.reason, termination.detail)
      return
    }

    const stepIndex = mission.steps.length
    const instruction =
      stepIndex === 0
        ? `Begin the mission. First establish where you stand, then decide the single most useful next step.`
        : `Continue the mission. Review what happened, then take the single most useful next step. If the objective is met, say "objective met". If there is nothing worth acting on, say "no opportunities".`

    const turn = await runTurn(instruction, history, missionId, mission.objective)

    const assistantText = turn.messages
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content)
      .join('\n')
    const toolMessage = turn.messages.find((m) => m.role === 'tool')

    const step: MissionStep = {
      index: stepIndex,
      at: Date.now(),
      thought: assistantText || '(no narration)',
      toolName: toolMessage?.toolName ?? null,
      toolSummary: toolMessage?.content ?? null,
      actionId: turn.actionIds[0] ?? null
    }

    await state.update((draft) => {
      const target = draft.missions.find((m) => m.id === missionId)
      if (target) target.steps.push(step)
    })

    history.push({ id: newId('msg'), role: 'user', content: instruction, at: Date.now() })
    for (const message of turn.messages) history.push(message)

    const updated = state.findMission(missionId)!
    emit(updated)

    const signal = readAgentSignal(assistantText)
    if (signal) {
      await finish(missionId, signal, assistantText.slice(0, 300))
      return
    }

    // In restricted modes a queued approval pauses the loop rather than
    // spinning while it waits for a human.
    const queued = turn.actionIds
      .map((id) => state.findAction(id))
      .some((a) => a?.status === 'pending')
    if (queued) {
      await state.update((draft) => {
        const target = draft.missions.find((m) => m.id === missionId)
        if (target) target.status = 'paused'
      })
      await audit.record('mission', 'Mission paused awaiting approval', { missionId })
      emit(state.findMission(missionId)!)
      return
    }

    // A small gap between steps keeps a fast provider from hammering RPCs.
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }
}

/** Called after an approval resolves so a paused mission can pick up again. */
export async function resume(missionId: string): Promise<Mission | null> {
  const mission = state.findMission(missionId)
  if (!mission || mission.status !== 'paused') return mission ?? null

  await state.update((draft) => {
    const target = draft.missions.find((m) => m.id === missionId)
    if (target) target.status = 'running'
  })
  running.set(missionId, { stop: false })
  await audit.record('mission', 'Mission resumed', { missionId })

  void loop(missionId).catch(async (err) => {
    await finish(missionId, 'runtime-error', err instanceof Error ? err.message : String(err))
  })

  return state.findMission(missionId)!
}

export async function stop(missionId: string): Promise<Mission> {
  const flag = running.get(missionId)
  if (flag) flag.stop = true
  return finish(missionId, 'operator-stopped', 'The operator stopped the mission.')
}

/** Engaging the emergency stop kills every running mission at once. */
export async function stopAll(reason: TerminationReason = 'emergency-stop'): Promise<number> {
  const active = state.current().missions.filter((m) => m.status === 'running' || m.status === 'paused')
  for (const mission of active) {
    const flag = running.get(mission.id)
    if (flag) flag.stop = true
    await finish(mission.id, reason, 'All missions were halted.')
  }
  return active.length
}
