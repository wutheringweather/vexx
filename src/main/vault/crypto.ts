import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual
} from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>

/**
 * scrypt parameters. N=2^17 costs roughly 130 MB and a few hundred ms on a
 * desktop — slow enough to make an offline guess against the keystore
 * expensive, fast enough that unlocking still feels instant.
 */
export const KDF_PARAMS = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const

const KEY_LENGTH = 32
const IV_LENGTH = 12
const SALT_LENGTH = 32

export interface EncryptedBlob {
  v: 1
  kdf: 'scrypt'
  kdfParams: { N: number; r: number; p: number }
  salt: string
  iv: string
  tag: string
  ciphertext: string
}

export async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { ...KDF_PARAMS })
}

export function newSalt(): Buffer {
  return randomBytes(SALT_LENGTH)
}

export function encrypt(plaintext: string, key: Buffer, salt: Buffer): EncryptedBlob {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    v: 1,
    kdf: 'scrypt',
    kdfParams: { N: KDF_PARAMS.N, r: KDF_PARAMS.r, p: KDF_PARAMS.p },
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }
}

/**
 * Throws on a wrong password or a tampered file — GCM's auth tag makes those
 * the same failure, which is exactly what we want to expose to a caller.
 */
export function decrypt(blob: EncryptedBlob, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, 'base64')),
    decipher.final()
  ])
  return plaintext.toString('utf8')
}

/** Overwrite key material in place before dropping the reference. */
export function wipe(buf: Buffer | null | undefined): void {
  if (buf && buf.length > 0) buf.fill(0)
}

export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export interface PasswordStrength {
  ok: boolean
  score: number
  problems: string[]
}

export function checkPasswordStrength(password: string): PasswordStrength {
  const problems: string[] = []
  if (password.length < 12) problems.push('Use at least 12 characters.')
  if (!/[a-z]/.test(password)) problems.push('Add a lowercase letter.')
  if (!/[A-Z]/.test(password)) problems.push('Add an uppercase letter.')
  if (!/[0-9]/.test(password)) problems.push('Add a digit.')
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('Add a symbol.')

  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length
  const lengthScore = Math.min(password.length / 20, 1) * 60
  const varietyScore = (variety / 4) * 40
  return {
    ok: problems.length === 0,
    score: Math.round(lengthScore + varietyScore),
    problems
  }
}
