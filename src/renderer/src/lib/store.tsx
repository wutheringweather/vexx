import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import type { AppSnapshot } from '@shared/types'
import { api } from './api'
import { errorMessage } from './format'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  text: string
}

interface StoreValue {
  snapshot: AppSnapshot | null
  loading: boolean
  refresh: () => Promise<void>
  toasts: Toast[]
  notify: (kind: Toast['kind'], text: string) => void
  dismiss: (id: number) => void
  /** Runs a privileged call, surfacing failures as a toast instead of a crash. */
  run: <T>(fn: () => Promise<T>, successText?: string) => Promise<T | null>
  theme: 'dark' | 'light'
  toggleTheme: () => void
}

const StoreContext = createContext<StoreValue | null>(null)

let toastSeq = 0

export function StoreProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('vex.theme') as 'dark' | 'light') ?? 'dark'
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('vex.theme', theme)
  }, [theme])

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const notify = useCallback(
    (kind: Toast['kind'], text: string) => {
      const id = ++toastSeq
      setToasts((current) => [...current, { id, kind, text }])
      setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 3800)
    },
    [dismiss]
  )

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api.snapshot())
    } catch (err) {
      notify('error', errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void refresh()
    // Main pushes a fresh snapshot whenever it changes something, so the UI
    // never has to poll to stay honest about vault or mission state.
    return api.onSnapshot(setSnapshot)
  }, [refresh])

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, successText?: string): Promise<T | null> => {
      try {
        const result = await fn()
        if (successText) notify('success', successText)
        return result
      } catch (err) {
        notify('error', errorMessage(err))
        return null
      }
    },
    [notify]
  )

  const value = useMemo<StoreValue>(
    () => ({
      snapshot,
      loading,
      refresh,
      toasts,
      notify,
      dismiss,
      run,
      theme,
      toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
    }),
    [snapshot, loading, refresh, toasts, notify, dismiss, run, theme]
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext)
  if (!value) throw new Error('useStore must be used inside StoreProvider')
  return value
}

/** For views that only render once a snapshot exists. */
export function useSnapshot(): AppSnapshot {
  const { snapshot } = useStore()
  if (!snapshot) throw new Error('Snapshot is not loaded yet')
  return snapshot
}
