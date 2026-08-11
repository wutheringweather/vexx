import { app, BrowserWindow, session } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { join } from 'node:path'
import { APP_NAME } from '@shared/constants'
import * as state from './state'
import * as audit from './audit/log'
import * as keystore from './vault/keystore'
import * as updater from './updater'
import { setEmbeddingConfigResolver } from './memory/lessons'
import { bindWindow, embeddingConfig, pushSnapshot, registerHandlers, wireMissionUpdates } from './ipc'

/**
 * Content Security Policy for the renderer.
 *
 * `connect-src 'self'` matters: the renderer has no business reaching an RPC,
 * a price API or the model provider directly. All of that happens in main,
 * behind the IPC allowlist, so a rogue script in the UI has nowhere to send
 * anything it managed to read.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  `style-src 'self' 'unsafe-inline'`,
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1040,
    minHeight: 700,
    show: false,
    title: APP_NAME,
    backgroundColor: '#0a0b0f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The renderer is treated as hostile: no Node, no shared context, OS-level
      // sandbox on. Everything privileged is reached through vetted IPC.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  bindWindow(mainWindow)

  // Nothing opens a second window. External links go through the vetted
  // shell:open-external channel, which checks them against the explorer list.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env.ELECTRON_RENDERER_URL
    const isDev = devServer && url.startsWith(devServer)
    if (!isDev && !url.startsWith('file://')) {
      event.preventDefault()
      void audit.record('system', 'Blocked an in-app navigation attempt', { url })
    }
  })

  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function hardenSession(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
        'X-Content-Type-Options': ['nosniff']
      }
    })
  })

  // The UI needs no camera, microphone, geolocation or notifications.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    void audit.record('system', 'Denied a renderer permission request', { permission })
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('ai.vexdesk.app')
  hardenSession()

  await state.load()
  registerHandlers()
  wireMissionUpdates()

  // Memory stays independent of app state; this is the one seam between them.
  setEmbeddingConfigResolver(embeddingConfig)

  updater.onUpdateStatus(() => void pushSnapshot())
  void updater.init()

  keystore.setAutoLockHandler(() => {
    void audit.record('vault', 'Vault auto-locked after idle timeout', {})
    void pushSnapshot()
  })

  await audit.record('system', 'Application started', {
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron
  })

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Locking on the way out means a crash-restart cannot inherit an unlocked vault.
  keystore.lock()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  keystore.lock()
})

// Refuse to launch a second copy: two processes writing one keystore is how
// state files get corrupted.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// Belt and braces: never let a renderer talk anyone into opening a URL.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    void audit.record('system', 'Blocked a window.open attempt', { url })
    return { action: 'deny' }
  })
})
