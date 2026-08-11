import { useState } from 'react'
import type { Mission, TerminationReason } from '@shared/types'
import { api } from '../lib/api'
import { useSnapshot, useStore } from '../lib/store'
import { Callout, Card, Empty, Field, Tag, Tile } from '../components/ui'
import { countdown, fullTime, relativeTime, usd } from '../lib/format'
import { IconMission, IconPlay, IconStop } from '../lib/icons'

const TERMINATION_LABEL: Record<TerminationReason, string> = {
  'objective-met': 'Objective met',
  'deadline-reached': 'Deadline reached',
  'capital-exhausted': 'Capital exhausted',
  'max-loss-hit': 'Max loss triggered',
  'no-opportunities': 'No opportunities',
  'step-limit-reached': 'Step limit reached',
  'emergency-stop': 'Emergency stop',
  'operator-stopped': 'Stopped by operator',
  'runtime-error': 'Runtime error'
}

const TERMINATION_TONE: Record<TerminationReason, 'success' | 'accent' | 'danger' | undefined> = {
  'objective-met': 'success',
  'deadline-reached': 'accent',
  'capital-exhausted': 'accent',
  'max-loss-hit': 'danger',
  'no-opportunities': undefined,
  'step-limit-reached': 'accent',
  'emergency-stop': 'danger',
  'operator-stopped': undefined,
  'runtime-error': 'danger'
}

export default function Missions(): React.JSX.Element {
  const snapshot = useSnapshot()
  const { run } = useStore()
  const [objective, setObjective] = useState('')
  const [mode, setMode] = useState<'mission-restricted' | 'mission-full'>('mission-restricted')
  const [busy, setBusy] = useState(false)

  const active = snapshot.missions.find((m) => m.status === 'running' || m.status === 'paused')
  const history = snapshot.missions.filter((m) => m.status === 'finished')

  async function start(): Promise<void> {
    setBusy(true)
    const result = await run(() => api.missions.start(objective, mode), 'Mission started.')
    setBusy(false)
    if (result) setObjective('')
  }

  return (
    <>
      {active ? (
        <ActiveMission mission={active} onStop={() => void run(() => api.missions.stop(active.id), 'Mission stopped.')} />
      ) : (
        <Card title="Start a mission" description="An objective plus a set of conditions under which the run ends">
          <div className="stack">
            <Field
              label="Objective"
              hint="Be specific about what done looks like. The agent decides when the objective is met, but the guardrails decide when it stops regardless."
            >
              <textarea
                className="textarea"
                value={objective}
                placeholder="e.g. Check whether ETH is trading below $2,900 on Sepolia and report what a $20 entry would look like."
                onChange={(e) => setObjective(e.target.value)}
              />
            </Field>

            <Field label="Autonomy">
              <select
                className="select"
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="mission-restricted">
                  Mission · Restricted — pauses for your approval before every signature
                </option>
                <option value="mission-full">
                  Mission · Full — continuous, gate-enforced, no approval pause
                </option>
              </select>
            </Field>

            <div className="grid grid--4">
              <Limit label="Deadline" value={`${snapshot.policy.missionDeadlineMinutes} min`} />
              <Limit label="Capital cap" value={usd(snapshot.policy.maxNotionalUsdPerMission)} />
              <Limit label="Loss floor" value={usd(-snapshot.policy.maxLossUsd)} />
              <Limit label="Step limit" value={`${snapshot.policy.maxMissionSteps} steps`} />
            </div>

            {mode === 'mission-full' && (
              <Callout tone="accent">
                <strong>Mission · Full does not pause for you.</strong> The safety gate still
                evaluates every action and can still refuse, but nothing waits for a human. Keep the
                caps low until you trust the behaviour.
              </Callout>
            )}

            {!snapshot.llm.hasApiKey && (
              <Callout tone="accent">
                Missions need a reasoning model. Add an API key in Settings — the local planner does
                not propose actions.
              </Callout>
            )}

            <button
              className="btn btn--primary"
              disabled={busy || objective.trim().length < 4 || snapshot.policy.emergencyStop}
              onClick={() => void start()}
            >
              <IconPlay size={15} /> {busy ? 'Starting…' : 'Start mission'}
            </button>
          </div>
        </Card>
      )}

      <Card title="Mission history" description="Every run and exactly why it ended" flush>
        {history.length === 0 ? (
          <Empty
            icon={<IconMission size={20} />}
            title="No completed missions"
            text="Finished missions keep their full step timeline and termination reason, wins and losses alike."
          />
        ) : (
          <div className="rows">
            {history.map((mission) => (
              <div className="row" key={mission.id}>
                <div className="row__main">
                  <div className="row__title">{mission.objective}</div>
                  <div className="row__sub">
                    {mission.steps.length} steps · {relativeTime(mission.startedAt)} ·{' '}
                    {mission.terminationDetail}
                  </div>
                </div>
                <div className="row__side inline">
                  <span className={`num ${mission.realisedUsd < 0 ? 'danger-text' : mission.realisedUsd > 0 ? 'success-text' : 'muted'}`}>
                    {usd(mission.realisedUsd)}
                  </span>
                  {mission.terminationReason && (
                    <Tag tone={TERMINATION_TONE[mission.terminationReason]}>
                      {TERMINATION_LABEL[mission.terminationReason]}
                    </Tag>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}

function Limit({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <Tile label={label} value={value} metric />
}

function ActiveMission({
  mission,
  onStop
}: {
  mission: Mission
  onStop: () => void
}): React.JSX.Element {
  return (
    <Card
      title={mission.objective}
      description={`Started ${relativeTime(mission.startedAt)} · ${mission.mode}`}
      actions={
        <>
          <Tag tone={mission.status === 'running' ? 'success' : 'accent'}>
            <span className={`dot${mission.status === 'running' ? ' dot--pulse' : ''}`} />
            {mission.status === 'paused' ? 'waiting on approval' : 'running'}
          </Tag>
          <button className="btn btn--danger btn--sm" onClick={onStop}>
            <IconStop size={14} /> Stop
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="grid grid--4">
          <Limit label="Time left" value={countdown(mission.deadlineAt)} />
          <Limit label="Deployed" value={usd(mission.deployedUsd)} />
          <Limit label="Realised" value={usd(mission.realisedUsd)} />
          <Limit label="Steps" value={String(mission.steps.length)} />
        </div>

        {mission.status === 'paused' && (
          <Callout tone="accent">
            The mission is paused because an action is waiting for you. Resolve it on the Approvals
            screen and the loop picks up from where it stopped.
          </Callout>
        )}

        {mission.steps.length === 0 ? (
          <p className="muted small">Waiting for the first step…</p>
        ) : (
          <div className="timeline">
            {mission.steps.map((step) => (
              <div className="tl-step" key={step.index}>
                <div className="tl-step__head">
                  <span className="tl-step__index">STEP {step.index + 1}</span>
                  <span className="tiny muted">{fullTime(step.at)}</span>
                  {step.actionId && <Tag tone="accent">action proposed</Tag>}
                </div>
                <div className="tl-step__body">{step.thought}</div>
                {step.toolSummary && (
                  <div className="tl-step__tool">
                    <strong>{step.toolName}</strong> — {step.toolSummary}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}
