import { useEffect, useState } from 'react'
import type { AuditEntry, AuditVerification } from '@shared/types'
import { api } from '../lib/api'
import { useStore } from '../lib/store'
import { Tag, Callout, Card, Empty } from '../components/ui'
import { fullTime, relativeTime } from '../lib/format'
import { IconAudit, IconCheck, IconRefresh } from '../lib/icons'

/** Only the kinds that carry consequence get a hue; the rest stay neutral. */
const KIND_TONE: Record<string, 'accent' | 'success' | 'danger' | undefined> = {
  vault: 'accent',
  policy: 'accent',
  gate: 'accent',
  approval: 'accent',
  execution: 'success',
  mission: undefined,
  agent: undefined,
  system: undefined
}

export default function AuditTrail(): React.JSX.Element {
  const { run } = useStore()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [verification, setVerification] = useState<AuditVerification | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [filter, setFilter] = useState<string>('all')

  async function load(): Promise<void> {
    const [list, verify] = await Promise.all([api.audit.list(300), api.audit.verify()])
    setEntries(list)
    setVerification(verify)
  }

  useEffect(() => {
    void load()
  }, [])

  const visible = filter === 'all' ? entries : entries.filter((e) => e.kind === filter)
  const kinds = ['all', ...new Set(entries.map((e) => e.kind))]

  return (
    <>
      {verification &&
        (verification.ok ? (
          <Callout tone="success">
            <strong>Chain intact across {verification.entries} entries.</strong> Each record hashes
            its own contents together with the previous hash, so editing or removing a past line
            breaks every hash after it. A local file can still be deleted — this proves it was not
            quietly rewritten.
          </Callout>
        ) : (
          <Callout tone="danger">
            <strong>Chain broken at entry #{verification.brokenAtSeq}.</strong> The log was modified
            outside VexDesk. Treat everything from that point on as untrustworthy.
          </Callout>
        ))}

      <Card
        title="Decision log"
        description="Every gate verdict, approval, execution and policy change"
        actions={
          <>
            <select className="select" style={{ width: 150, height: 28 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
              {kinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kind === 'all' ? 'All kinds' : kind}
                </option>
              ))}
            </select>
            <button className="btn btn--sm" onClick={() => void run(() => load())}>
              <IconRefresh size={13} /> Reload
            </button>
          </>
        }
        flush
      >
        {visible.length === 0 ? (
          <Empty
            icon={<IconAudit size={20} />}
            title="Log is empty"
            text="Entries are appended as things happen. Nothing is filtered out — blocked attempts and failures are recorded next to the wins."
          />
        ) : (
          <div className="rows">
            {visible.map((entry) => (
              <div
                className="row"
                key={entry.seq}
                style={{ cursor: 'pointer', alignItems: 'flex-start' }}
                onClick={() => setExpanded(expanded === entry.seq ? null : entry.seq)}
              >
                <span className="tiny muted num" style={{ minWidth: 42, paddingTop: 2 }}>
                  #{entry.seq}
                </span>
                <div className="row__main">
                  <div className="row__title">{entry.summary}</div>
                  <div className="row__sub">
                    {fullTime(entry.at)} · {relativeTime(entry.at)}
                  </div>
                  {expanded === entry.seq && (
                    <pre
                      className="tl-step__tool"
                      style={{ whiteSpace: 'pre-wrap', marginTop: 8, overflowX: 'auto' }}
                    >
                      {JSON.stringify(entry.detail, null, 2)}
                      {'\n\nhash     '}
                      {entry.hash}
                      {'\nprevHash '}
                      {entry.prevHash}
                    </pre>
                  )}
                </div>
                <div className="row__side">
                  <Tag tone={KIND_TONE[entry.kind]}>{entry.kind}</Tag>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <p className="tiny muted inline">
        <IconCheck size={13} /> Secrets are stripped before anything is written here — mnemonics,
        private keys and API tokens are replaced with a placeholder at the point of write, not at
        the point of display.
      </p>
    </>
  )
}
