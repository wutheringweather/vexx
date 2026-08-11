import type { AccountInfo, VaultCreateResult, VaultStatus } from '@shared/types'
import { AUTO_LOCK_MINUTES, DERIVATION_PATH_EVM, DERIVATION_PATH_SOLANA } from '@shared/constants'
import { dataPath, fileExists, readJson, writeJsonAtomic } from '../storage/files'
import {
  checkPasswordStrength,
  decrypt,
  deriveKey,
  encrypt,
  newSalt,
  wipe,
  type EncryptedBlob
} from './crypto'
import {
  createMnemonic,
  deriveEvmKey,
  deriveSolanaKey,
  isValidMnemonic,
  mnemonicToSeed,
  type EvmKey,
  type SolanaKey
} from './derive'

const KEYSTORE_FILE = 'keystore.json'

interface KeystoreFile {
  version: 1
  createdAt: number
  /** Public metadata, safe to read without unlocking. */
  accounts: AccountInfo[]
  blob: EncryptedBlob
}

/** What sits inside the encrypted blob. This shape never leaves this module. */
interface VaultSecrets {
  mnemonic: string
}

/**
 * Unlocked key material. Held only in this module's closure, in the main
 * process. It is never serialised, never logged, and never crosses IPC.
 */
interface UnlockedState {
  evm: EvmKey
  solana: SolanaKey
  autoLockTimer: NodeJS.Timeout | null
  autoLockAt: number
}

let unlocked: UnlockedState | null = null
let onAutoLock: (() => void) | null = null

function keystorePath(): string {
  return dataPath(KEYSTORE_FILE)
}

async function loadKeystore(): Promise<KeystoreFile | null> {
  if (!fileExists(keystorePath())) return null
  return readJson<KeystoreFile | null>(keystorePath(), null)
}

function accountsFrom(evm: EvmKey, solana: SolanaKey): AccountInfo[] {
  return [
    { family: 'evm', label: 'EVM Account 1', address: evm.address, derivationPath: evm.path },
    {
      family: 'solana',
      label: 'Solana Account 1',
      address: solana.address,
      derivationPath: solana.path
    }
  ]
}

function armAutoLock(): void {
  if (!unlocked) return
  if (unlocked.autoLockTimer) clearTimeout(unlocked.autoLockTimer)
  const ms = AUTO_LOCK_MINUTES * 60 * 1000
  unlocked.autoLockAt = Date.now() + ms
  unlocked.autoLockTimer = setTimeout(() => {
    lock()
    onAutoLock?.()
  }, ms)
  // Do not hold the event loop open just to expire a lock.
  unlocked.autoLockTimer.unref?.()
}

export function setAutoLockHandler(handler: () => void): void {
  onAutoLock = handler
}

/** Any privileged operation refreshes the idle window. */
export function touch(): void {
  if (unlocked) armAutoLock()
}

export async function status(): Promise<VaultStatus> {
  const file = await loadKeystore()
  if (!file) {
    return { state: 'absent', accounts: [], autoLockAt: null, createdAt: null }
  }
  if (!unlocked) {
    return { state: 'locked', accounts: file.accounts, autoLockAt: null, createdAt: file.createdAt }
  }
  return {
    state: 'unlocked',
    accounts: file.accounts,
    autoLockAt: unlocked.autoLockAt,
    createdAt: file.createdAt
  }
}

export async function create(
  password: string,
  importedMnemonic?: string
): Promise<VaultCreateResult> {
  if (await loadKeystore()) {
    throw new Error('A vault already exists. Reset it from Settings before creating a new one.')
  }
  const strength = checkPasswordStrength(password)
  if (!strength.ok) {
    throw new Error(`Master password is too weak. ${strength.problems.join(' ')}`)
  }

  const mnemonic = importedMnemonic?.trim() ? importedMnemonic.trim() : createMnemonic()
  if (!isValidMnemonic(mnemonic)) {
    throw new Error('That recovery phrase is not a valid BIP-39 mnemonic.')
  }

  const seed = mnemonicToSeed(mnemonic)
  const evm = deriveEvmKey(seed, DERIVATION_PATH_EVM)
  const solana = deriveSolanaKey(seed, DERIVATION_PATH_SOLANA)
  const accounts = accountsFrom(evm, solana)

  const salt = newSalt()
  const key = await deriveKey(password, salt)
  try {
    const secrets: VaultSecrets = { mnemonic }
    const file: KeystoreFile = {
      version: 1,
      createdAt: Date.now(),
      accounts,
      blob: encrypt(JSON.stringify(secrets), key, salt)
    }
    await writeJsonAtomic(keystorePath(), file)
  } finally {
    wipe(key)
  }

  unlocked = { evm, solana, autoLockTimer: null, autoLockAt: 0 }
  armAutoLock()

  // Returned once so the operator can write it down. Never persisted in the clear.
  return { mnemonic, accounts }
}

export async function unlock(password: string): Promise<VaultStatus> {
  const file = await loadKeystore()
  if (!file) throw new Error('No vault on this machine yet.')

  const key = await deriveKey(password, Buffer.from(file.blob.salt, 'base64'))
  let secrets: VaultSecrets
  try {
    // A wrong password fails the GCM auth tag, which surfaces here.
    secrets = JSON.parse(decrypt(file.blob, key)) as VaultSecrets
  } catch {
    throw new Error('Wrong master password.')
  } finally {
    wipe(key)
  }

  const seed = mnemonicToSeed(secrets.mnemonic)
  unlocked = {
    evm: deriveEvmKey(seed, DERIVATION_PATH_EVM),
    solana: deriveSolanaKey(seed, DERIVATION_PATH_SOLANA),
    autoLockTimer: null,
    autoLockAt: 0
  }
  armAutoLock()
  return status()
}

export function lock(): void {
  if (!unlocked) return
  if (unlocked.autoLockTimer) clearTimeout(unlocked.autoLockTimer)
  wipe(Buffer.from(unlocked.solana.secretKey.buffer as ArrayBuffer))
  unlocked.solana.secretKey.fill(0)
  unlocked = null
}

export function isUnlocked(): boolean {
  return unlocked !== null
}

/**
 * The single door to signing material, and it stays inside main. Callers get a
 * key to use immediately; nobody gets to stash one.
 */
export function requireEvmKey(): EvmKey {
  if (!unlocked) throw new Error('Vault is locked.')
  touch()
  return unlocked.evm
}

export function requireSolanaKey(): SolanaKey {
  if (!unlocked) throw new Error('Vault is locked.')
  touch()
  return unlocked.solana
}

export function publicAddresses(): { evm: string | null; solana: string | null } {
  return unlocked
    ? { evm: unlocked.evm.address, solana: unlocked.solana.address }
    : { evm: null, solana: null }
}

/** Destroys the keystore file. Funds are unrecoverable without the mnemonic. */
export async function destroy(): Promise<void> {
  lock()
  const { rm } = await import('node:fs/promises')
  await rm(keystorePath(), { force: true })
}

export { checkPasswordStrength }
