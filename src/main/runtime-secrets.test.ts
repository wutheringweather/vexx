import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as state from './state'
import { bootstrapRuntimeSecrets } from './runtime-secrets'

vi.mock('./storage/secret-store', () => ({
  open: vi.fn(() => null),
  seal: vi.fn((value: string) => `sealed:${value}`)
}))

describe('runtime secret bootstrap', () => {
  beforeEach(async () => {
    delete process.env.VEXDESK_JUPITER_API_KEY
    delete process.env.VEXDESK_LLM_API_KEY
    state.resetForTests()
    await state.load()
    await state.update((draft) => {
      draft.jupiter.apiKeyCipher = null
      draft.llm.apiKeyCipher = null
    })
  })

  it('seals injected keys and removes their environment copies', async () => {
    process.env.VEXDESK_JUPITER_API_KEY = 'jupiter-secret'
    process.env.VEXDESK_LLM_API_KEY = 'llm-secret'

    await bootstrapRuntimeSecrets()

    expect(state.current().jupiter.apiKeyCipher).toBe('sealed:jupiter-secret')
    expect(state.current().llm.apiKeyCipher).toBe('sealed:llm-secret')
    expect(process.env.VEXDESK_JUPITER_API_KEY).toBeUndefined()
    expect(process.env.VEXDESK_LLM_API_KEY).toBeUndefined()
  })

  it('does not replace an existing stored key from a stale environment value', async () => {
    await state.update((draft) => {
      draft.jupiter.apiKeyCipher = 'existing-cipher'
    })
    process.env.VEXDESK_JUPITER_API_KEY = 'stale-secret'

    await bootstrapRuntimeSecrets()

    expect(state.current().jupiter.apiKeyCipher).toBe('existing-cipher')
    expect(process.env.VEXDESK_JUPITER_API_KEY).toBeUndefined()
  })
})
