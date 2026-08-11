import type { ReactNode } from 'react'
import type { ViewId } from '../App'
import { EXECUTION_MODES, findNetwork } from '@shared/constants'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { countdown } from '../lib/format'
import vxMark from '../assets/vx-mark.png'
import {
  IconAgent,
  IconApproval,
  IconAudit,
  IconGuard,
  IconLock,
  IconMemory,
  IconMission,
  IconOverview,
  IconSettings,
  IconWallet
} from '../lib/icons'

interface NavEntry {
  id: ViewId
  label: string
  icon: React.JSX.Element
  group: string
}

const NAV: NavEntry[] = [
  { id: 'overview', label: 'Overview', icon: <IconOverview size={16} />, group: 'Run' },
  { id: 'agent', label: 'Agent', icon: <IconAgent size={16} />, group: 'Run' },
  { id: 'missions', label: 'Missions', icon: <IconMission size={16} />, group: 'Run' },
  { id: 'approvals', label: 'Approvals', icon: <IconApproval size={16} />, group: 'Run' },
  { id: 'wallet', label: 'Wallet', icon: <IconWallet size={16} />, group: 'Control' },
  { id: 'guardrails', label: 'Guardrails', icon: <IconGuard size={16} />, group: 'Control' },
  { id: 'memory', label: 'Memory', icon: <IconMemory size={16} />, group: 'Record' },
  { id: 'audit', label: 'Audit', icon: <IconAudit size={16} />, group: 'Record' },
  { id: 'settings', label: 'Settings', icon: <IconSettings size={16} />, group: 'Record' }
]

const GROUPS = [...new Set(NAV.map((n) => n.group))]

export default function Shell({
  view,
  onNavigate,
  title,
  subtitle,
  onOpenPalette,
  children
}: {
  view: ViewId
  onNavigate: (next: ViewId) => void
  title: string
  subtitle: string
  onOpenPalette: () => void
  children: ReactNode
}): React.JSX.Element {
  const { snapshot, run } = useStore()
  if (!snapshot) return <></>

  const pending = snapshot.pendingActions.length
  const modeInfo = EXECUTION_MODES.find((m) => m.id === snapshot.mode)
  const evmNet = findNetwork(snapshot.activeEvmNetworkId)
  const solNet = findNetwork(snapshot.activeSolanaNetworkId)
  const onMainnet = Boolean(evmNet?.isMainnet || solNet?.isMainnet)
  const running = snapshot.missions.some((m) => m.status === 'running')
  const stopped = snapshot.policy.emergencyStop

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

        <nav className="nav" aria-label="Main">
          {GROUPS.map((group) => (
            <div key={group}>
              <div className="nav__label">{group}</div>
              {NAV.filter((n) => n.group === group).map((entry) => (
                <button
                  key={entry.id}
                  className={`nav__item${view === entry.id ? ' nav__item--active' : ''}`}
                  aria-current={view === entry.id ? 'page' : undefined}
                  onClick={() => onNavigate(entry.id)}
                >
                  <span className="nav__icon">{entry.icon}</span>
                  {entry.label}
                  {entry.id === 'approvals' && pending > 0 && (
                    <span className="nav__count" aria-label={`${pending} waiting`}>
                      {pending}
                    </span>
                  )}
                  {entry.id === 'missions' && running && (
                    <span className="nav__live" aria-label="mission running">
                      <span className="dot dot--pulse" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* The state you need to know before you touch anything, always visible. */}
        <div className={`readout${stopped ? ' readout--alarm' : ''}`}>
          {stopped ? (
            <div className="readout__row">
              <span className="danger-text inline">
                <IconLock size={13} />
              </span>
              <span className="tile__text">
                <span className="tile__title danger-text">Emergency stop</span>
                <span className="tile__sub">All fund movement refused</span>
              </span>
            </div>
          ) : (
            <>
              <div className="readout__row">
                <span className="readout__key">Funds</span>
                <span className={`readout__val ${onMainnet ? 'danger-text' : 'success-text'}`}>
                  {onMainnet ? 'Mainnet · real' : 'Testnet'}
                </span>
              </div>
              <div className="readout__row">
                <span className="readout__key">Mode</span>
                <span className={`readout__val ${modeInfo?.requiresApproval ? '' : 'accent-text'}`}>
                  {modeInfo?.requiresApproval ? 'Asks first' : 'No pause'}
                </span>
              </div>
              <div className="readout__row">
                <span className="readout__key">Vault</span>
                <span className="readout__val num">
                  {snapshot.vault.autoLockAt ? countdown(snapshot.vault.autoLockAt) : 'open'}
                </span>
              </div>
            </>
          )}
          <button
            className="readout__btn"
            onClick={() => void run(() => api.vault.lock(), 'Vault locked.')}
          >
            <IconLock size={12} /> Lock now
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__title">
            <h1>{title}</h1>
            <div className="topbar__sub">{subtitle}</div>
          </div>

          <div className="topbar__actions">
            <button className="kbd-trigger" onClick={onOpenPalette}>
              Search
              <kbd>Ctrl K</kbd>
            </button>
          </div>
        </header>

        {children}
      </div>
    </div>
  )
}
