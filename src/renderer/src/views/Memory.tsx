import { api } from '../lib/api'
import { useSnapshot, useStore } from '../lib/store'
import { Callout, Card, Empty, Meter, Stat, StatStrip, Tag } from '../components/ui'
import { relativeTime } from '../lib/format'
import { IconMemory, IconX } from '../lib/icons'

const TIER_COPY: Record<string, string> = {
  episodic: 'Something that happened',
  semantic: 'Something that is true',
  procedural: 'Something to do differently'
}

export default function Memory(): React.JSX.Element {
  const snapshot = useSnapshot()
  const { run } = useStore()

  const tiers = ['procedural', 'semantic', 'episodic'] as const

  return (
    <>
      <Callout>
        Memory stores <strong>lessons</strong>, never balances or positions. Each one halves in
        strength every 30 days unless the agent runs into it again, so stale conclusions fade
        instead of hardening. Anything resembling a key, phrase or token is stripped before a lesson
        is written.
      </Callout>

      <StatStrip>
        {tiers.map((tier) => (
          <Stat
            key={tier}
            label={tier}
            value={snapshot.lessons.filter((l) => l.tier === tier).length}
            meta={TIER_COPY[tier]}
          />
        ))}
      </StatStrip>

      <Card
        title="Lessons"
        description={`${snapshot.lessons.length} retained, strongest first`}
        actions={
          snapshot.lessons.length > 0 ? (
            <button
              className="btn btn--danger btn--sm"
              onClick={() => void run(() => api.memory.clear(), 'Memory cleared.')}
            >
              Clear all
            </button>
          ) : undefined
        }
        flush
      >
        {snapshot.lessons.length === 0 ? (
          <Empty
            icon={<IconMemory size={20} />}
            title="Nothing learned yet"
            text="Lessons accumulate as the agent works — from what the gate refused, what an execution did, and how a mission ended."
          />
        ) : (
          <div className="rows">
            {snapshot.lessons.map((lesson) => (
              <div className="row" key={lesson.id}>
                <div className="row__main">
                  <div className="row__title" style={{ whiteSpace: 'normal' }}>
                    {lesson.text}
                  </div>
                  <div className="inline" style={{ marginTop: 6 }}>
                    <Tag tone={lesson.tier === 'procedural' ? 'accent' : undefined}>
                      {lesson.tier}
                    </Tag>
                    {lesson.tags.map((tag) => (
                      <span className="tiny muted" key={tag}>
                        #{tag}
                      </span>
                    ))}
                    <span className="spacer" />
                    <span className="tiny muted">
                      reinforced {relativeTime(lesson.lastReinforcedAt)}
                    </span>
                  </div>
                  <div style={{ marginTop: 8, maxWidth: 200 }}>
                    <Meter value={lesson.strength} />
                  </div>
                </div>
                <div className="row__side inline">
                  <span className="num muted small">{lesson.strength.toFixed(2)}</span>
                  <button
                    className="btn btn--ghost btn--sm"
                    title="Forget this lesson"
                    onClick={() => void run(() => api.memory.forget(lesson.id), 'Forgotten.')}
                  >
                    <IconX size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}
