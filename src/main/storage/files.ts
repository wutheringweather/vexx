import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Everything VexDesk knows lives under one directory in the OS user-data path:
 *   Windows  %APPDATA%\VexDesk
 *   macOS    ~/Library/Application Support/VexDesk
 * Nothing is written anywhere else, and nothing leaves the machine.
 */
let cachedRoot: string | null = null

export function dataRoot(): string {
  if (!cachedRoot) {
    cachedRoot = app.getPath('userData')
    mkdirSync(cachedRoot, { recursive: true })
  }
  return cachedRoot
}

export function dataPath(...segments: string[]): string {
  return join(dataRoot(), ...segments)
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/**
 * Write to a sibling temp file and rename over the target. Rename is atomic on
 * both NTFS and APFS, so a crash mid-write can never leave a half-written
 * keystore behind.
 */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  ensureDir(filePath)
  const tmp = `${filePath}.${randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, filePath)
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}

export function fileExists(filePath: string): boolean {
  return existsSync(filePath)
}

/** Append-only newline-delimited JSON, used for the audit log. */
export async function appendJsonl(filePath: string, value: unknown): Promise<void> {
  ensureDir(filePath)
  await appendFile(filePath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 })
}

export async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, 'utf8')
    const out: T[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        out.push(JSON.parse(trimmed) as T)
      } catch {
        // A truncated final line from a hard kill: skip it rather than lose the log.
      }
    }
    return out
  } catch {
    return []
  }
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}
