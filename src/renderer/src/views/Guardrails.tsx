import { useEffect, useState } from 'react'
import type { Policy } from '@shared/types'
import { api } from '../lib/api'
import { useSnapshot, useStore } from '../lib/store'
import { Callout, Card, Field, Switch } from '../components/ui'
import { IconCheck, IconGuard } from '../lib/icons'

export default function Guardrails(): React.JSX.Element {
  const snapshot = useSnapshot()
  const { run } = useStore()
  const [draft, setDraft] = useState<Policy>(snapshot.policy)
  const [busy, setBusy] = useState(false)

  // Follow main whenever it changes the policy out from under us — an
  // emergency stop from elsewhere must not be masked by a stale form.
  useEffect(() => setDraft(snapshot.policy), [snapshot.policy])

  const dirty = JSON.stringify(draft) !== JSON.stringify(snapshot.policy)

  function set<K extends keyof Policy>(key: K, value: Policy[K]): void {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function persist(next: Policy): Promise<void> {
    setBusy(true)
    await run(() => api.policy.update(next), 'Guardrails updated.')
    setBusy(false)
  }

  return (
    <>
      <Card
        title="Emergency stop"
        description="One switch that refuses every fund-moving action and halts every mission"
        actions={
          <Switch
            checked={draft.emergencyStop}
            danger
            label=""
            onChange={(value) => {
              const next = { ...draft, emergencyStop: value }
              setDraft(next)
              void persist(next)
            }}
          />
        }
      >
        {draft.emergencyStop ? (
          <Callout tone="danger">
            <strong>Engaged.</strong> Pending approvals were expired and running missions were
            halted. Nothing can move funds until this is cleared.
          </Callout>
        ) : (
          <Callout>
            Not engaged. This takes effect immediately and applies in every execution mode,
            including Mission · Full.
          </Callout>
        )}
      </Card>

      <Card
        title="Real funds"
        description="Mainnet networks stay unselectable until this is on"
        actions={
          <Switch
            checked={draft.mainnetEnabled}
            danger
            label=""
            onChange={(value) => set('mainnetEnabled', value)}
          />
        }
      >
        {draft.mainnetEnabled ? (
          <Callout tone="danger">
            <strong>Mainnet is enabled.</strong> Actions on a mainnet network move real money. The
            caps below are the only thing standing between a bad plan and a real loss — set them to
            an amount you are willing to lose outright.
          </Callout>
        ) : (
          <Callout tone="success">
            Locked to testnets. Every mainnet action is refused by the gate, and mainnet networks
            cannot be selected on the Wallet screen.
          </Callout>
        )}
      </Card>

      <div className="grid grid--2">
        <Card title="Capital limits" description="Denominated in USD at the time of the action">
          <div className="stack">
            <NumberField
              label="Max per action"
              hint="A single transfer or swap may never exceed this."
              value={draft.maxNotionalUsdPerAction}
              onChange={(v) => set('maxNotionalUsdPerAction', v)}
            />
            <NumberField
              label="Max per mission"
              hint="Total capital one mission may deploy before it terminates."
              value={draft.maxNotionalUsdPerMission}
              onChange={(v) => set('maxNotionalUsdPerMission', v)}
            />
            <NumberField
              label="Max loss"
              hint="A mission stops the moment realised loss crosses this."
              value={draft.maxLossUsd}
              onChange={(v) => set('maxLossUsd', v)}
            />
          </div>
        </Card>

        <Card title="Execution limits" description="How far a run can go before it must stop">
          <div className="stack">
            <NumberField
              label="Max slippage (bps)"
              hint="100 bps = 1%. Swaps quoting worse than this are refused."
              value={draft.maxSlippageBps}
              onChange={(v) => set('maxSlippageBps', v)}
            />
            <NumberField
              label="Mission deadline (minutes)"
              value={draft.missionDeadlineMinutes}
              onChange={(v) => set('missionDeadlineMinutes', v)}
            />
            <NumberField
              label="Max steps per mission"
              hint="A hard ceiling so an agent that keeps finding one more thing to try eventually stops."
              value={draft.maxMissionSteps}
              onChange={(v) => set('maxMissionSteps', v)}
            />
          </div>
        </Card>
      </div>

      <div className="grid grid--2">
        <Card title="Token allowlist" description="Assets the agent may touch at all">
          <Field label="Symbols" hint="Comma separated. An empty list means no swaps and no transfers.">
            <input
              className="input"
              value={draft.tokenAllowlist.join(', ')}
              onChange={(e) =>
                set(
                  'tokenAllowlist',
                  e.target.value
                    .split(',')
                    .map((s) => s.trim().toUpperCase())
                    .filter(Boolean)
                )
              }
            />
          </Field>
        </Card>

        <Card title="Transfer allowlist" description="The only destinations a transfer may reach">
          <Field
            label="Addresses"
            hint="One per line. An empty list refuses every transfer — which is the default, deliberately."
          >
            <textarea
              className="textarea input--mono"
              value={draft.transferAllowlist.join('\n')}
              onChange={(e) =>
                set(
                  'transferAllowlist',
                  e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean)
                )
              }
            />
          </Field>
        </Card>
      </div>

      <Card>
        <div className="inline">
          <span className="muted small">
            <IconGuard size={15} /> These limits live in privileged code. The agent can read them
            and cannot change them.
          </span>
          <span className="spacer" />
          {dirty && (
            <button className="btn btn--ghost" onClick={() => setDraft(snapshot.policy)}>
              Discard
            </button>
          )}
          <button
            className="btn btn--primary"
            disabled={!dirty || busy}
            onClick={() => void persist(draft)}
          >
            <IconCheck size={15} /> {busy ? 'Saving…' : 'Save guardrails'}
          </button>
        </div>
      </Card>
    </>
  )
}

function NumberField({
  label,
  hint,
  value,
  onChange
}: {
  label: string
  hint?: string
  value: number
  onChange: (next: number) => void
}): React.JSX.Element {
  return (
    <Field label={label} hint={hint}>
      <input
        className="input num"
        type="number"
        min={0}
        value={value}
        onChange={(e) => {
          const parsed = Number(e.target.value)
          onChange(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0)
        }}
      />
    </Field>
  )
}
