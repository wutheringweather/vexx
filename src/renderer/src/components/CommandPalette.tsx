import { useEffect, useMemo, useRef, useState } from 'react'
import type { ViewId } from '../App'
import { EXECUTION_MODES } from '@shared/constants'
import { api } from '../lib/api'
import { useStore } from '../lib/store'
import {
  IconAgent,
  IconApproval,
  IconAudit,
  IconGuard,
  IconLock,
  IconMemory,
  IconMission,
  IconMoon,
  IconOverview,
  IconRefresh,
  IconSettings,
  IconSun,
  IconWallet
} from '../lib/icons'

interface Command {
  id: string
  group: string
  label: string
  hint?: string
  icon: React.JSX.Element
  run: () => void
}

/**
 * A desktop tool should be drivable from the keyboard. This is navigation plus
 * the handful of actions worth reaching without hunting: mode switches, the
 * lock, a balance refresh, and the theme.
 */
export default function CommandPalette({
  open,
  onClose,
  onNavigate
}: {
  open: boolean
  onClose: () => void
  onNavigate: (view: ViewId) => void
}): React.JSX.Element | null {
  const { run, toggleTheme, theme, snapshot } = useStore()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const commands = useMemo<Command[]>(() => {
    const go = (view: ViewId, label: string, icon: React.JSX.Element): Command => ({
      id: `go-${view}`,
      group: 'Go to',
      label,
      icon,
      run: () => onNavigate(view)
    })

    const modeCommands: Command[] = EXECUTION_MODES.map((mode) => ({
      id: `mode-${mode.id}`,
      group: 'Execution mode',
      label: `Switch to ${mode.label}`,
      hint: mode.requiresApproval ? 'asks first' : 'no pause',
      icon: <IconMission size={16} />,
      run: () => void run(() => api.setMode(mode.id), `Switched to ${mode.label}.`)
    }))

    return [
      go('overview', 'Overview', <IconOverview size={16} />),
      go('agent', 'Agent', <IconAgent size={16} />),
      go('missions', 'Missions', <IconMission size={16} />),
      go('approvals', 'Approvals', <IconApproval size={16} />),
      go('wallet', 'Wallet', <IconWallet size={16} />),
      go('guardrails', 'Guardrails', <IconGuard size={16} />),
      go('memory', 'Memory', <IconMemory size={16} />),
      go('audit', 'Audit', <IconAudit size={16} />),
      go('settings', 'Settings', <IconSettings size={16} />),
      ...modeCommands,
      {
        id: 'refresh',
        group: 'Actions',
        label: 'Refresh balances',
        icon: <IconRefresh size={16} />,
        run: () => void run(() => api.refreshBalances(), 'Balances refreshed.')
      },
      {
        id: 'theme',
        group: 'Actions',
        label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        icon: theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />,
        run: toggleTheme
      },
      {
        id: 'lock',
        group: 'Actions',
        label: 'Lock the vault',
        hint: 'wipes the key from memory',
        icon: <IconLock size={16} />,
        run: () => void run(() => api.vault.lock(), 'Vault locked.')
      },
      ...(snapshot && !snapshot.policy.emergencyStop
        ? [
            {
              id: 'estop',
              group: 'Actions',
              label: 'Engage emergency stop',
              hint: 'halts everything',
              icon: <IconLock size={16} />,
              run: () =>
                void run(
                  () => api.policy.update({ ...snapshot.policy, emergencyStop: true }),
                  'Emergency stop engaged.'
                )
            }
          ]
        : [])
    ]
  }, [onNavigate, run, theme, toggleTheme, snapshot])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)
    )
  }, [commands, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(0)
      // Focus after the mount animation starts so the caret does not jump.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => setIndex(0), [query])

  useEffect(() => {
    listRef.current?.querySelector('.palette__item--active')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!open) return null

  function choose(command: Command | undefined): void {
    if (!command) return
    command.run()
    onClose()
  }

  let lastGroup = ''

  return (
    <div
      className="overlay overlay--top"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="palette">
        <input
          ref={inputRef}
          className="palette__input"
          value={query}
          placeholder="Search commands…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => Math.min(i + 1, filtered.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              choose(filtered[index])
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />

        <div className="palette__list" ref={listRef}>
          {filtered.length === 0 && (
            <div className="palette__item muted">No command matches that.</div>
          )}
          {filtered.map((command, i) => {
            const showGroup = command.group !== lastGroup
            lastGroup = command.group
            return (
              <div key={command.id}>
                {showGroup && <div className="palette__group">{command.group}</div>}
                <button
                  className={`palette__item${i === index ? ' palette__item--active' : ''}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => choose(command)}
                >
                  <span className="palette__item-icon">{command.icon}</span>
                  {command.label}
                  {command.hint && <span className="palette__hint">{command.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>

        <div className="palette__foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> run
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}
