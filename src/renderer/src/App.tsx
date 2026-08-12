import { useCallback, useEffect, useState } from 'react'
import { StoreProvider, useStore } from './lib/store'
import { Skeleton, Toasts } from './components/ui'
import AccessKeyGate from './views/AccessKeyGate'
import VaultGate from './views/VaultGate'
import Shell from './components/Shell'
import CommandPalette from './components/CommandPalette'
import Overview from './views/Overview'
import Agent from './views/Agent'
import Missions from './views/Missions'
import Approvals from './views/Approvals'
import Wallet from './views/Wallet'
import Guardrails from './views/Guardrails'
import Memory from './views/Memory'
import AuditTrail from './views/AuditTrail'
import Settings from './views/Settings'
import vxMark from './assets/vx-mark.png'

export type ViewId =
  | 'overview'
  | 'agent'
  | 'missions'
  | 'approvals'
  | 'wallet'
  | 'guardrails'
  | 'memory'
  | 'audit'
  | 'settings'

interface ViewDef {
  title: string
  subtitle: string
  /** Views that own their own scrolling, like the chat log. */
  flush?: boolean
  render: () => React.JSX.Element
}

const VIEWS: Record<ViewId, ViewDef> = {
  overview: {
    title: 'Overview',
    subtitle: 'Where you stand right now',
    render: () => <Overview />
  },
  agent: {
    title: 'Agent',
    subtitle: 'Ask, research, propose — nothing executes without passing the gate',
    flush: true,
    render: () => <Agent />
  },
  missions: {
    title: 'Missions',
    subtitle: 'Autonomous runs with an explicit end condition',
    render: () => <Missions />
  },
  approvals: {
    title: 'Approvals',
    subtitle: 'Everything waiting on your signature',
    render: () => <Approvals />
  },
  wallet: {
    title: 'Wallet',
    subtitle: 'Accounts, balances and manual actions',
    render: () => <Wallet />
  },
  guardrails: {
    title: 'Guardrails',
    subtitle: 'The limits the agent cannot talk its way past',
    render: () => <Guardrails />
  },
  memory: {
    title: 'Memory',
    subtitle: 'Lessons the agent carries forward, decaying over time',
    render: () => <Memory />
  },
  audit: {
    title: 'Audit',
    subtitle: 'A hash-chained record of every decision',
    render: () => <AuditTrail />
  },
  settings: {
    title: 'Settings',
    subtitle: 'Model provider, memory and vault management',
    render: () => <Settings />
  }
}

function Booting(): React.JSX.Element {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand__mark" src={vxMark} alt="" />
          <div>
            <div className="brand__name">VexDesk</div>
            <div className="brand__tag">Local runtime</div>
          </div>
        </div>
        <div className="nav">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} style={{ padding: '7px 8px' }}>
              <Skeleton height={13} width={`${58 + ((i * 13) % 34)}%`} />
            </div>
          ))}
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="stack stack--tight">
            <Skeleton height={18} width={140} />
            <Skeleton height={11} width={220} />
          </div>
        </header>
        <div className="page">
          <div className="page__inner">
            <Skeleton height={98} radius={13} />
            <div className="grid grid--split">
              <Skeleton height={230} radius={13} />
              <Skeleton height={230} radius={13} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Root(): React.JSX.Element {
  const { snapshot, loading } = useStore()
  const [view, setView] = useState<ViewId>('overview')
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Session-only: someone who skipped setup should not be asked again on the
  // way to the vault, but a fresh launch is a fair moment to offer it once more.
  // The Overview banner carries the reminder in between.
  const [providerSetupSkipped, setProviderSetupSkipped] = useState(false)

  const navigate = useCallback((next: ViewId) => setView(next), [])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (loading || !snapshot) return <Booting />

  // Offered once per launch, never enforced. The agent is one feature; the
  // vault, the gate and the audit trail do not need a model provider at all.
  if (!snapshot.llm.hasApiKey && !providerSetupSkipped) {
    return (
      <>
        <AccessKeyGate onSkip={() => setProviderSetupSkipped(true)} />
        <Toasts />
      </>
    )
  }
  if (snapshot.vault.state !== 'unlocked') {
    return (
      <>
        <VaultGate />
        <Toasts />
      </>
    )
  }

  const active = VIEWS[view]

  return (
    <>
      <Shell
        view={view}
        onNavigate={navigate}
        title={active.title}
        subtitle={active.subtitle}
        onOpenPalette={() => setPaletteOpen(true)}
      >
        {active.flush ? (
          <div className="page page--flush">{active.render()}</div>
        ) : (
          <div className="page">
            {/* Keyed so a view change replays the staggered entry. */}
            <div className="page__inner" key={view}>
              {active.render()}
            </div>
          </div>
        )}
      </Shell>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={navigate}
      />
      <Toasts />
    </>
  )
}

export default function App(): React.JSX.Element {
  return (
    <StoreProvider>
      <Root />
    </StoreProvider>
  )
}
