import { safeStorage } from 'electron'

/**
 * For secrets that must survive a restart without the operator retyping them —
 * currently just the LLM API key.
 *
 * This deliberately does NOT use the master password. The vault's threat model
 * is "an attacker with the keystore file still cannot sign", and reusing the
 * master password here would mean holding a derived key in memory for reasons
 * unrelated to signing. Instead this leans on the OS keychain (DPAPI on
 * Windows, Keychain on macOS), which is scoped to the logged-in user.
 *
 * An API key is not signing material. Losing one costs money, not funds.
 */

export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function seal(plaintext: string): string | null {
  if (!plaintext) return null
  if (!isEncryptionAvailable()) {
    throw new Error(
      'OS-level encryption is unavailable, so the API key cannot be stored safely. Set it per session instead.'
    )
  }
  return safeStorage.encryptString(plaintext).toString('base64')
}

export function open(cipher: string | null): string | null {
  if (!cipher) return null
  try {
    return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
  } catch {
    // A key sealed by a different OS user or machine will not open here.
    return null
  }
}
