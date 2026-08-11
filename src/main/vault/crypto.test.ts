import { describe, expect, it } from 'vitest'
import { checkPasswordStrength, decrypt, deriveKey, encrypt, newSalt, wipe } from './crypto'
import { deriveEd25519Seed, deriveEvmKey, deriveSolanaKey, isValidMnemonic, mnemonicToSeed } from './derive'

/** BIP-39 test vector. Used only to check derivation is deterministic. */
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('keystore crypto', () => {
  it('round-trips a payload with the right password', async () => {
    const salt = newSalt()
    const key = await deriveKey('correct horse battery staple', salt)
    const blob = encrypt(JSON.stringify({ mnemonic: TEST_MNEMONIC }), key, salt)

    expect(blob.ciphertext).not.toContain('abandon')
    expect(JSON.parse(decrypt(blob, key)).mnemonic).toBe(TEST_MNEMONIC)
  })

  it('fails on a wrong password rather than returning garbage', async () => {
    const salt = newSalt()
    const key = await deriveKey('right password', salt)
    const wrong = await deriveKey('wrong password', salt)
    const blob = encrypt('secret', key, salt)

    expect(() => decrypt(blob, wrong)).toThrow()
  })

  it('detects a tampered ciphertext through the auth tag', async () => {
    const salt = newSalt()
    const key = await deriveKey('password12345!A', salt)
    const blob = encrypt('secret payload', key, salt)

    const bytes = Buffer.from(blob.ciphertext, 'base64')
    bytes.writeUInt8(bytes.readUInt8(0) ^ 0xff, 0)
    expect(() => decrypt({ ...blob, ciphertext: bytes.toString('base64') }, key)).toThrow()
  })

  it('produces a different ciphertext each time for the same input', async () => {
    const salt = newSalt()
    const key = await deriveKey('password12345!A', salt)
    expect(encrypt('same', key, salt).ciphertext).not.toBe(encrypt('same', key, salt).ciphertext)
  })

  it('zeroes key material on wipe', async () => {
    const key = await deriveKey('password12345!A', newSalt())
    wipe(key)
    expect(key.every((byte) => byte === 0)).toBe(true)
  })

  it('rejects weak passwords with actionable reasons', () => {
    expect(checkPasswordStrength('short').ok).toBe(false)
    expect(checkPasswordStrength('alllowercaseletters').problems).toContain('Add a digit.')
    expect(checkPasswordStrength('Str0ng&LongEnough!').ok).toBe(true)
  })
})

describe('key derivation', () => {
  it('validates mnemonics', () => {
    expect(isValidMnemonic(TEST_MNEMONIC)).toBe(true)
    expect(isValidMnemonic('not actually a valid mnemonic phrase at all here now')).toBe(false)
  })

  it('derives the known EVM address for the BIP-39 test vector', () => {
    const seed = mnemonicToSeed(TEST_MNEMONIC)
    const key = deriveEvmKey(seed)
    expect(key.address).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94')
  })

  it('derives EVM and Solana keys deterministically', () => {
    const seed = mnemonicToSeed(TEST_MNEMONIC)
    expect(deriveEvmKey(seed).address).toBe(deriveEvmKey(mnemonicToSeed(TEST_MNEMONIC)).address)
    expect(deriveSolanaKey(seed).address).toBe(deriveSolanaKey(mnemonicToSeed(TEST_MNEMONIC)).address)
  })

  it('gives EVM and Solana genuinely different keys', () => {
    const seed = mnemonicToSeed(TEST_MNEMONIC)
    expect(deriveEvmKey(seed).address).not.toBe(deriveSolanaKey(seed).address)
  })

  it('refuses non-hardened segments for ed25519, as SLIP-0010 requires', () => {
    const seed = mnemonicToSeed(TEST_MNEMONIC)
    expect(() => deriveEd25519Seed(seed, "m/44'/501'/0/0'")).toThrow(/hardened/)
  })

  it('produces a 32-byte ed25519 seed', () => {
    const seed = deriveEd25519Seed(mnemonicToSeed(TEST_MNEMONIC), "m/44'/501'/0'/0'")
    expect(seed.length).toBe(32)
  })
})
