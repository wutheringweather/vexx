import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Vitest runs outside Electron, so anything reaching for `electron` gets this
 * instead. Each run gets a throwaway userData directory, which keeps tests from
 * touching a real install's keystore.
 */
const testUserData = mkdtempSync(join(tmpdir(), 'vexdesk-test-'))

export const app = {
  getPath: (name: string) => (name === 'userData' ? testUserData : testUserData),
  getVersion: () => '0.0.0-test'
}

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (value: string) => Buffer.from(value, 'utf8'),
  decryptString: (buffer: Buffer) => buffer.toString('utf8')
}

export const ipcMain = { handle: () => undefined }
export const shell = { openExternal: async () => undefined }
export const session = { defaultSession: {} }
export const BrowserWindow = class {}
