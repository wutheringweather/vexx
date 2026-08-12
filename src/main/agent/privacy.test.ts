import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY } from '@shared/constants'
import {
  describeTransferAllowlist,
  maskAddress,
  maskAddresses,
  resolveTransferAlias
} from './privacy'
import { systemPrompt } from './prompt'

const EVM = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'
const SOL = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH'

describe('maskAddress', () => {
  it('keeps enough of an EVM address to recognise it', () => {
    const masked = maskAddress(EVM)
    expect(masked).toBe('0x9858Ef…Eda94')
    expect(masked).not.toContain('232B4033E47d90003D41EC34')
  })

  it('masks a Solana address too', () => {
    expect(maskAddress(SOL)).toBe('HN7cABqL…4YWrH')
  })

  it('leaves something too short to be an address alone', () => {
    expect(maskAddress('0xabc')).toBe('0xabc')
  })
})

describe('maskAddresses', () => {
  it('masks address fields wherever they sit in tool output', () => {
    const out = maskAddresses({
      addresses: { evm: EVM, solana: SOL },
      balances: [{ address: EVM, formatted: '0.184000', symbol: 'ETH' }]
    })
    expect(JSON.stringify(out)).not.toContain(EVM)
    expect(JSON.stringify(out)).not.toContain(SOL)
    expect(out.balances[0]!.formatted).toBe('0.184000')
  })

  it('masks transaction participants', () => {
    const out = maskAddresses({ from: EVM, to: SOL, amount: '0.01' })
    expect(out.from).toBe(maskAddress(EVM))
    expect(out.to).toBe(maskAddress(SOL))
    expect(out.amount).toBe('0.01')
  })

  it('reaches into an object sitting under an address key', () => {
    const out = maskAddresses({ addresses: { evm: EVM, solana: SOL } })
    expect(out.addresses.evm).toBe(maskAddress(EVM))
    expect(out.addresses.solana).toBe(maskAddress(SOL))
  })

  it('masks an allowlist that arrives as a bare array', () => {
    const out = maskAddresses({ policy: { transferAllowlist: [EVM, SOL], maxLossUsd: 25 } })
    expect(JSON.stringify(out)).not.toContain(EVM)
    expect(out.policy.maxLossUsd).toBe(25)
  })

  it('leaves everything else alone', () => {
    const input = { summary: 'ETH is $1,875', networkId: 'eth-sepolia', nested: { ok: true } }
    expect(maskAddresses(input)).toEqual(input)
  })

  it('does not recurse forever on a deep structure', () => {
    let deep: Record<string, unknown> = { address: EVM }
    for (let i = 0; i < 20; i++) deep = { nested: deep }
    expect(() => maskAddresses(deep)).not.toThrow()
  })
})

describe('transfer aliases', () => {
  const allowlist = [EVM, SOL]

  it('describes destinations without spelling them out', () => {
    const described = describeTransferAllowlist(allowlist)
    expect(described).toContain('allowlist:1')
    expect(described).toContain('allowlist:2')
    expect(described).not.toContain(EVM)
    expect(described).not.toContain(SOL)
  })

  it('says so plainly when the allowlist is empty', () => {
    expect(describeTransferAllowlist([])).toMatch(/every transfer will be refused/)
  })

  it('resolves an alias back to the full address', () => {
    expect(resolveTransferAlias('allowlist:1', allowlist)).toBe(EVM)
    expect(resolveTransferAlias('allowlist:2', allowlist)).toBe(SOL)
    expect(resolveTransferAlias(' ALLOWLIST:2 ', allowlist)).toBe(SOL)
  })

  it('passes a literal address straight through', () => {
    expect(resolveTransferAlias(EVM, allowlist)).toBe(EVM)
  })

  it('leaves an out-of-range alias for the gate to refuse', () => {
    expect(resolveTransferAlias('allowlist:9', allowlist)).toBe('allowlist:9')
    expect(resolveTransferAlias('allowlist:0', allowlist)).toBe('allowlist:0')
    expect(resolveTransferAlias('allowlist:abc', allowlist)).toBe('allowlist:abc')
  })
})

/**
 * The point of all of the above. A hosted provider sees the system prompt on
 * every single turn, so this is the string that matters.
 */
describe('the system prompt carries no addresses', () => {
  const prompt = systemPrompt({
    mode: 'agent-restricted',
    policy: { ...DEFAULT_POLICY, transferAllowlist: [EVM, SOL] },
    evmNetworkId: 'eth-sepolia',
    solanaNetworkId: 'sol-devnet',
    vaultUnlocked: true,
    lessons: []
  })

  it('never spells out a destination', () => {
    expect(prompt).not.toContain(EVM)
    expect(prompt).not.toContain(SOL)
  })

  it('offers aliases the agent can quote instead', () => {
    expect(prompt).toContain('allowlist:1')
    expect(prompt).toContain('allowlist:2')
  })

  it('still tells the agent whether it can sign', () => {
    expect(prompt).toMatch(/unlocked and ready to sign/)
  })

  it('keeps the guardrail numbers the agent reasons with', () => {
    expect(prompt).toContain(String(DEFAULT_POLICY.maxNotionalUsdPerAction))
    expect(prompt).toContain(String(DEFAULT_POLICY.maxSlippageBps))
  })
})
