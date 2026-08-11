import { describe, expect, it } from 'vitest'
import { containsSecret, redact } from './redact'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const PRIVATE_KEY = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318'

describe('redaction', () => {
  it('strips a mnemonic from free text', () => {
    const out = redact(`The recovery phrase is ${MNEMONIC} keep it safe`)
    expect(out).not.toContain('abandon')
    expect(out).toContain('[redacted]')
  })

  it('strips 0x private keys', () => {
    expect(redact(`key=${PRIVATE_KEY}`)).not.toContain(PRIVATE_KEY)
  })

  it('strips bare 64-char hex', () => {
    const hex = 'a'.repeat(64)
    expect(redact(`seed ${hex}`)).not.toContain(hex)
  })

  it('strips Solana secret keys serialised as byte arrays', () => {
    const bytes = `[${Array.from({ length: 64 }, (_, i) => i % 256).join(',')}]`
    expect(redact(`secretKey: ${bytes}`)).not.toContain('[1,2,3')
  })

  it('strips API keys and bearer tokens', () => {
    expect(redact('Authorization: Bearer sk-abcdef1234567890abcdef')).not.toContain('abcdef1234567890')
    expect(redact('use sk-proj-9f8e7d6c5b4a3210zzzz')).toContain('[redacted]')
  })

  it('drops sensitive object keys wholesale', () => {
    const out = redact({
      mnemonic: MNEMONIC,
      privateKey: PRIVATE_KEY,
      apiKey: 'anything at all',
      password: 'hunter2',
      networkId: 'eth-sepolia'
    })
    expect(out.mnemonic).toBe('[redacted]')
    expect(out.privateKey).toBe('[redacted]')
    expect(out.apiKey).toBe('[redacted]')
    expect(out.password).toBe('[redacted]')
    // Non-sensitive fields survive, or the audit log would be useless.
    expect(out.networkId).toBe('eth-sepolia')
  })

  it('recurses into nested structures', () => {
    const out = redact({ a: { b: [{ c: `leak ${PRIVATE_KEY}` }] } })
    expect(JSON.stringify(out)).not.toContain(PRIVATE_KEY)
  })

  it('leaves ordinary addresses and numbers alone', () => {
    const text = 'Sent 0.25 ETH to 0x1111111111111111111111111111111111111111 for $30.00'
    expect(redact(text)).toBe(text)
  })

  it('reports whether a string still looks secret', () => {
    expect(containsSecret(PRIVATE_KEY)).toBe(true)
    expect(containsSecret('nothing to see here')).toBe(false)
  })

  it('terminates on deeply nested input instead of blowing the stack', () => {
    let nested: Record<string, unknown> = { value: PRIVATE_KEY }
    for (let i = 0; i < 40; i++) nested = { nested }
    expect(() => redact(nested)).not.toThrow()
  })
})
