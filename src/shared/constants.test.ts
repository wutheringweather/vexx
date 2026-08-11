import { describe, expect, it } from 'vitest'
import { EXTERNAL_LINKS, NETWORKS, isAllowedExternalLink } from './constants'

/**
 * The external-link gate is the only path from the renderer to a browser. It
 * used to permit block explorers alone; EXTERNAL_LINKS widens it by a handful
 * of complete URLs, so these tests pin down that it widened by exactly that
 * much and not by a domain.
 */

describe('external link allowlist', () => {
  it('permits every explorer this build knows about', () => {
    for (const network of NETWORKS) {
      expect(isAllowedExternalLink(`${network.explorerTxUrl}0xabc`)).toBe(true)
      expect(isAllowedExternalLink(`${network.explorerAddressUrl}0xabc`)).toBe(true)
    }
  })

  it('permits the exact social link', () => {
    expect(isAllowedExternalLink(EXTERNAL_LINKS.x)).toBe(true)
  })

  it('refuses anything else on the same domain', () => {
    expect(isAllowedExternalLink('https://x.com/')).toBe(false)
    expect(isAllowedExternalLink('https://x.com/someone-else')).toBe(false)
    expect(isAllowedExternalLink('https://x.com/vexdesktop/status/1')).toBe(false)
    expect(isAllowedExternalLink('https://x.com/vexdesktop.evil.test')).toBe(false)
  })

  it('refuses a look-alike host that merely contains the allowed URL', () => {
    expect(isAllowedExternalLink('https://evil.test/https://x.com/vexdesktop')).toBe(false)
    expect(isAllowedExternalLink('https://x.com.evil.test/vexdesktop')).toBe(false)
  })

  it('refuses unrelated destinations', () => {
    expect(isAllowedExternalLink('https://example.test')).toBe(false)
    expect(isAllowedExternalLink('')).toBe(false)
  })
})
