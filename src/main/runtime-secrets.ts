import * as audit from './audit/log'
import * as state from './state'
import { open, seal } from './storage/secret-store'

/**
 * Optional first-launch bootstrap for desktop deployments. Values arrive only
 * through the process environment, are immediately sealed with the OS keychain
 * and are never written to source, the installer, renderer state or audit log.
 * Existing stored keys win, so a stale environment variable cannot silently
 * replace an operator's configured credential.
 */
export async function bootstrapRuntimeSecrets(): Promise<void> {
  const jupiterKey = process.env.VEXDESK_JUPITER_API_KEY?.trim() || null
  const llmKey = process.env.VEXDESK_LLM_API_KEY?.trim() || null
  if (!jupiterKey && !llmKey) return

  let jupiterStored = false
  let llmStored = false
  await state.update((draft) => {
    if (jupiterKey && !draft.jupiter.apiKeyCipher) {
      draft.jupiter.apiKeyCipher = seal(jupiterKey)
      jupiterStored = true
    }
    if (llmKey && !draft.llm.apiKeyCipher) {
      draft.llm.apiKeyCipher = seal(llmKey)
      llmStored = true
    }
  })

  // Do not retain the environment copy longer than needed in this process.
  delete process.env.VEXDESK_JUPITER_API_KEY
  delete process.env.VEXDESK_LLM_API_KEY

  if (jupiterStored || llmStored) {
    await audit.record('system', 'Runtime credentials stored in the OS keychain', {
      jupiterKeyStored: jupiterStored,
      llmKeyStored: llmStored
    })
  }
}
