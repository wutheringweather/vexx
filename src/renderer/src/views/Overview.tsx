import { EXECUTION_MODES, findNetwork } from '@shared/constants'
import { useSnapshot, useStore } from '../lib/store'
import { api } from '../lib/api'
import { Callout, Card, Empty, Stat, StatStrip, Tag } from '../components/ui'
import { relativeTime, shortAddress, usd } from '../lib/format'
import { IconInbox, IconMission } from '../lib/icons'

export default function Overview(): React.JSX.Element {
  const snapshot = useSnapshot()
  const { run } = useStore()

  const pending = snapshot.pendingActions
  const running = snapshot.missions.filter((m) => m.status === 'running' || m.status === 'paused')
  const executed = snapshot.recentActions.filter((a) => a.status === 'executed')
  const blocked = snapshot.recentActions.filter((a) => a.status === 'blocked')
  const realised = snapshot.missions.reduce((sum, m) => sum + m.realisedUsd, 0)

  return (
    <>
      <StatStrip>
        <Stat
          label="Awaiting you"
          value={pending.length}
          meta={pending.length > 0 ? 'Your signature is the bottleneck' : 'Queue is clear'}
          tone={pending.length > 0 ? 'accent' : undefined}
        />
        <Stat
          label="Refused"
          value={blocked.length}
          meta="Blocked before anything moved"
          tone={blocked.length > 0 ? 'danger' : undefined}
        />
        <Stat label="Executed" value={executed.length} meta="Across all turns and missions" />
        <Stat
          label="Realised"
          value={usd(realised)}
          meta={`Floor at ${usd(-snapshot.policy.maxLossUsd)}`}
          tone={realised > 0 ? 'success' : realised < 0 ? 'danger' : undefined}
        />
      </StatStrip>

      {snapshot.policy.emergencyStop && (
        <Callout tone="danger">
          <strong>Emergency stop is engaged.</strong> Every fund-moving action is refused and all
          missions are halted. Clear it from Guardrails when you are ready to resume.
        </Callout>
      )}

      {!snapshot.llm.hasApiKey && (
        <Callout tone="accent">
          <strong>No model provider configured.</strong> The agent is running its local
          deterministic planner, which answers read-only questions but will not propose actions.
          Add an API key in Settings to enable full reasoning.
        </Callout>
      )}

      <div className="grid grid--split">
        <Card title="Balances" description="Native tokens on the active networks" flush>
          {snapshot.balances.length === 0 ? (
            <Empty
              icon={<IconInbox size={19} />}
              title="No balances yet"
              text="Refresh from the command palette, or fund a testnet address from the Wallet screen."
            />
          ) : (
            <div className="rows">
              {snapshot.balances.map((balance) => {
                const network = findNetwork(balance.networkId)
                return (
                  <div className="row" key={balance.networkId}>
                    <div className="row__main">
                      <div className="row__title">
                        <span className="num" style={{ fontSize: 15 }}>
                          {balance.formatted}
                        </span>{' '}
                        <span className="muted">{balance.symbol}</span>
                      </div>
                      <div className="row__sub">
                        {network?.label} · {shortAddress(balance.address)}
                      </div>
                    </div>
                    <div className="row__side">
                      {balance.error ? (
                        <Tag tone="danger">RPC error</Tag>
                      ) : network?.isMainnet ? (
                        <Tag tone="danger">mainnet</Tag>
                      ) : (
                        <Tag tone="success">testnet</Tag>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card title="Execution mode" description="How much rope the agent gets" flush>
          <div className="rows">
            {EXECUTION_MODES.map((mode) => {
              const selected = mode.id === snapshot.mode
              return (
                <button
                  key={mode.id}
                  className="row row--interactive"
                  aria-pressed={selected}
                  onClick={() => void run(() => api.setMode(mode.id), `Switched to ${mode.label}.`)}
                >
                  <span className={selected ? 'accent-text' : 'muted'}>
                    <span className="dot" />
                  </span>
                  <div className="row__main">
                    <div className="row__title" style={{ fontWeight: selected ? 620 : 520 }}>
                      {mode.label}
                    </div>
                    <div className="row__sub" style={{ whiteSpace: 'normal' }}>
                      {mode.blurb}
                    </div>
                  </div>
                  {!mode.requiresApproval && (
                    <div className="row__side">
                      <Tag tone="accent">no pause</Tag>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </Card>
      </div>

      <Card title="Active missions" flush>
        {running.length === 0 ? (
          <Empty
            icon={<IconMission size={19} />}
            title="No mission in flight"
            text="Every mission carries a deadline, a capital cap and a loss floor before it begins. Start one from the Missions screen."
          />
        ) : (
          <div className="rows">
            {running.map((mission) => (
              <div className="row" key={mission.id}>
                <span className={mission.status === 'running' ? 'success-text' : 'accent-text'}>
                  <span className={`dot${mission.status === 'running' ? ' dot--pulse' : ''}`} />
                </span>
                <div className="row__main">
                  <div className="row__title">{mission.objective}</div>
                  <div className="row__sub">
                    Step {mission.steps.length} · started {relativeTime(mission.startedAt)} ·{' '}
                    {usd(mission.deployedUsd)} deployed
                  </div>
                </div>
                <div className="row__side">
                  <Tag tone={mission.status === 'running' ? 'success' : 'accent'}>
                    {mission.status === 'paused' ? 'waiting on you' : 'running'}
                  </Tag>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Recent activity" flush>
        {snapshot.recentActions.length === 0 ? (
          <Empty
            icon={<IconInbox size={19} />}
            title="Nothing has happened yet"
            text="Actions appear the moment the agent proposes one — executed, queued or refused, all of them."
          />
        ) : (
          <div className="rows">
            {snapshot.recentActions.slice(0, 8).map((action) => (
              <div className="row" key={action.id}>
                <div className="row__main">
                  <div className="row__title">
                    {action.action.kind === 'swap' && action.action.targetBuyAmount
                      ? `Buy ${action.action.targetBuyAmount} ${action.action.buySymbol}`
                      : null}
                    {action.action.kind === 'swap' && action.action.targetBuyAmount
                      ? null
                      : action.action.kind === 'transfer'
                      ? `Transfer ${action.action.amount} ${action.action.symbol}`
                      : `Swap ${action.action.sellAmount} ${action.action.sellSymbol} → ${action.action.buySymbol}`}
                  </div>
                  <div className="row__sub">
                    {findNetwork(action.action.networkId)?.label} · {relativeTime(action.createdAt)}
                    {action.verdict.reason ? ` · ${action.verdict.reason}` : ''}
                  </div>
                </div>
                <div className="row__side">
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

export function StatusTag({ status }: { status: string }): React.JSX.Element {
  const tone =
    status === 'executed'
      ? 'success'
      : status === 'blocked' || status === 'failed'
        ? 'danger'
        : status === 'pending' || status === 'simulated'
          ? 'accent'
          : undefined
  return <Tag tone={tone as 'success' | 'danger' | 'accent' | undefined}>{status}</Tag>
}
