import { useState } from 'react'
import type { ActionRecord } from '@shared/types'
import { findNetwork } from '@shared/constants'
import { api } from '../lib/api'
import { useSnapshot, useStore } from '../lib/store'
import { Tag, Callout, Card, Empty } from '../components/ui'
import { StatusTag } from './Overview'
import { fullTime, relativeTime, usd } from '../lib/format'
import { IconApproval, IconCheck, IconExternal, IconX } from '../lib/icons'

export default function Approvals(): React.JSX.Element {
  const snapshot = useSnapshot()
  const { run } = useStore()
  const [busyId, setBusyId] = useState<string | null>(null)

  const resolved = snapshot.recentActions.filter((a) => a.status !== 'pending')

  async function decide(action: ActionRecord, approve: boolean): Promise<void> {
    setBusyId(action.id)
    await run(
      () => (approve ? api.actions.approve(action.id) : api.actions.reject(action.id)),
      approve ? 'Approved and executed.' : 'Rejected.'
    )
    setBusyId(null)
  }

  return (
    <>
      {snapshot.pendingActions.length === 0 ? (
        <Card>
          <Empty
            icon={<IconApproval size={20} />}
            title="Nothing waiting on you"
            text="In restricted modes, every action that would move funds lands here with the full gate verdict attached before anything is signed."
          />
        </Card>
      ) : (
        <div className="stack">
          {snapshot.pendingActions.map((action) => (
            <ActionCard
              key={action.id}
              action={action}
              busy={busyId === action.id}
              onApprove={() => void decide(action, true)}
              onReject={() => void decide(action, false)}
            />
          ))}
        </div>
      )}

      <Card title="Resolved" description="Approved, rejected, refused and failed — nothing is hidden" flush>
        {resolved.length === 0 ? (
          <Empty
            icon={<IconApproval size={20} />}
            title="No history yet"
            text="Every decision, including the ones the gate refused, is recorded here and in the audit log."
          />
        ) : (
          <div className="rows">
            {resolved.slice(0, 30).map((action) => (
              <div className="row" key={action.id}>
                <div className="row__main">
                  <div className="row__title">{describe(action)}</div>
                  <div className="row__sub">
                    {relativeTime(action.createdAt)}
                    {action.verdict.reason ? ` · ${action.verdict.reason}` : ''}
                    {action.execution ? ` · ${action.execution.detail}` : ''}
                  </div>
                </div>
                <div className="row__side inline">
                  {action.execution?.simulated && <Tag>simulated</Tag>}
                  {action.execution?.explorerUrl && (
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => void run(() => api.openExternal(action.execution!.explorerUrl!))}
                    >
                      <IconExternal size={13} />
                    </button>
                  )}
                  <StatusTag status={action.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}

function describe(action: ActionRecord): string {
  return action.action.kind === 'transfer'
    ? `Transfer ${action.action.amount} ${action.action.symbol} to ${action.action.to}`
    : `Swap ${action.action.sellAmount} ${action.action.sellSymbol} → ${action.action.buySymbol}`
}

function ActionCard({
  action,
  busy,
  onApprove,
  onReject
}: {
  action: ActionRecord
  busy: boolean
  onApprove: () => void
  onReject: () => void
}): React.JSX.Element {
  const network = findNetwork(action.action.networkId)

  return (
    <Card
      title={describe(action)}
      description={`Proposed ${relativeTime(action.createdAt)} · ${network?.label} · ${usd(action.action.estimatedUsd)}`}
      actions={
        network?.isMainnet ? <Tag tone="danger">mainnet · real funds</Tag> : <Tag tone="success">testnet</Tag>
      }
    >
      <div className="stack">
        <div className="callout">
          <span className="callout__icon">
            <IconApproval size={15} />
          </span>
          <div>
            <strong>Why the agent wants this</strong>
            <div style={{ marginTop: 4 }}>{action.rationale}</div>
          </div>
        </div>

        {action.action.kind === 'swap' && (
          <Callout tone="accent">
            Swaps execute as a <strong>simulation</strong>. The quote is derived from spot prices,
            not routed through a DEX, so no funds actually move and no liquidity is consumed.
          </Callout>
        )}

        <div>
          <div className="field__label" style={{ marginBottom: 8 }}>
            Safety gate — {action.verdict.checks.filter((c) => c.passed).length}/
            {action.verdict.checks.length} checks passed
          </div>
          <div className="checks">
            {action.verdict.checks.map((check) => (
              <div className={`check check--${check.passed ? 'pass' : 'fail'}`} key={check.id}>
                <span className="check__icon">
                  {check.passed ? <IconCheck size={14} /> : <IconX size={14} />}
                </span>
                <div>
                  <div className="check__label">{check.label}</div>
                  <div className="check__detail">{check.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="inline">
          <span className="tiny muted">Evaluated {fullTime(action.verdict.evaluatedAt)}</span>
          <span className="spacer" />
          <button className="btn btn--danger" disabled={busy} onClick={onReject}>
            <IconX size={15} /> Reject
          </button>
          <button className="btn btn--success" disabled={busy} onClick={onApprove}>
            <IconCheck size={15} /> {busy ? 'Working…' : 'Approve & execute'}
          </button>
        </div>

        <p className="tiny muted">
          The gate re-runs at approval time. If policy or balances moved since the proposal, this is
          refused rather than signed on a stale verdict.
        </p>
      </div>
    </Card>
  )
}
