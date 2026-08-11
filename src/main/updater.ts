import { app } from 'electron'
import type { UpdateStatus } from '@shared/types'
import * as audit from './audit/log'

/**
 * Auto-update over electron-updater.
 *
 * It is inert unless the build carries publish metadata (app-update.yml, which
 * electron-builder only emits when `publish` is configured). That means a
 * locally built, unpublished app never phones home — and the moment a release
 * feed exists, updates work with no code change.
 *
 * Platform reality worth knowing: Windows NSIS updates work unsigned, though
 * SmartScreen will warn. macOS auto-update requires a Developer ID signed and
 * notarised build — Squirrel.Mac refuses unsigned updates outright.
 */

let status: UpdateStatus = {
  state: 'idle',
  currentVersion: '0.0.0',
  availableVersion: null,
  detail: 'Not checked yet.',
  progressPercent: null,
  supported: false
}

type Listener = (status: UpdateStatus) => void
const listeners = new Set<Listener>()

export function onUpdateStatus(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function set(next: Partial<UpdateStatus>): void {
  status = { ...status, ...next }
  for (const listener of listeners) listener(status)
}

export function current(): UpdateStatus {
  return status
}

/** electron-updater is loaded lazily so a dev run never pulls it in. */
async function loadUpdater() {
  const { autoUpdater } = await import('electron-updater')
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  return autoUpdater
}

let wired = false

export async function init(): Promise<void> {
  status.currentVersion = app.getVersion()

  if (!app.isPackaged) {
    set({ state: 'unsupported', supported: false, detail: 'Updates only run in a packaged build.' })
    return
  }

  let autoUpdater
  try {
    autoUpdater = await loadUpdater()
  } catch (err) {
    set({
      state: 'unsupported',
      supported: false,
      detail: `Updater unavailable: ${err instanceof Error ? err.message : String(err)}`
    })
    return
  }

  if (!wired) {
    wired = true
    autoUpdater.on('checking-for-update', () =>
      set({ state: 'checking', detail: 'Checking for updates…' })
    )
    autoUpdater.on('update-available', (info) =>
      set({
        state: 'available',
        availableVersion: info.version,
        detail: `Version ${info.version} is available.`
      })
    )
    autoUpdater.on('update-not-available', () =>
      set({ state: 'current', availableVersion: null, detail: 'You are on the latest version.' })
    )
    autoUpdater.on('download-progress', (progress) =>
      set({ state: 'downloading', progressPercent: Math.round(progress.percent) })
    )
    autoUpdater.on('update-downloaded', (info) => {
      set({
        state: 'ready',
        availableVersion: info.version,
        progressPercent: 100,
        detail: `Version ${info.version} is ready. It installs when you quit.`
      })
      void audit.record('system', 'Update downloaded', { version: info.version })
    })
    autoUpdater.on('error', (err) => {
      set({ state: 'error', detail: err instanceof Error ? err.message : String(err) })
      void audit.record('system', 'Update check failed', { detail: String(err) })
    })
  }

  set({ supported: true, state: 'idle', detail: 'Ready to check.' })
  // A failure here just means no release feed is configured, which is fine.
  await check().catch(() => undefined)
}

export async function check(): Promise<UpdateStatus> {
  if (!status.supported) return status
  const autoUpdater = await loadUpdater()
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    set({
      state: 'error',
      detail:
        err instanceof Error && /app-update\.yml|ENOENT|404/i.test(err.message)
          ? 'No release feed is configured for this build.'
          : err instanceof Error
            ? err.message
            : String(err)
    })
  }
  return status
}

export async function download(): Promise<UpdateStatus> {
  if (status.state !== 'available') return status
  const autoUpdater = await loadUpdater()
  set({ state: 'downloading', progressPercent: 0 })
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    set({ state: 'error', detail: err instanceof Error ? err.message : String(err) })
  }
  return status
}

export async function installNow(): Promise<void> {
  if (status.state !== 'ready') throw new Error('No downloaded update to install.')
  await audit.record('system', 'Installing update and restarting', {
    version: status.availableVersion
  })
  const autoUpdater = await loadUpdater()
  autoUpdater.quitAndInstall()
}
