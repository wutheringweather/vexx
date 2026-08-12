import * as audit from './audit/log'
import * as state from './state'
import { open, seal } from './storage/secret-store'
import { join } from 'node:path'
import { readJson } from './storage/files'

interface PackagedSecretSeed {
  jupiterApiKeyCipher?: string | null
  llmApiKeyCipher?: string | null
}

async function packagedSecretSeed(): Promise<PackagedSecretSeed | null> {
  if (typeof process.resourcesPath !== 'string') return null
  return readJson<PackagedSecretSeed | null>(
    join(process.resourcesPath, 'runtime-secret-seed.json'),
    null
  )
}

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
  const seed = await packagedSecretSeed()
  const jupiterCipher = seed?.jupiterApiKeyCipher?.trim() || null
  const llmCipher = seed?.llmApiKeyCipher?.trim() || null
  if (!jupiterKey && !llmKey && !jupiterCipher && !llmCipher) return

  let jupiterStored = false
  let llmStored = false
  await state.update((draft) => {
    if (jupiterKey && !draft.jupiter.apiKeyCipher) {
      draft.jupiter.apiKeyCipher = seal(jupiterKey)
      jupiterStored = true
    } else if (!draft.jupiter.apiKeyCipher && jupiterCipher) {
      draft.jupiter.apiKeyCipher = jupiterCipher
      jupiterStored = true
    }
    if (llmKey && !draft.llm.apiKeyCipher) {
      draft.llm.apiKeyCipher = seal(llmKey)
      llmStored = true
    } else if (!draft.llm.apiKeyCipher && llmCipher) {
      draft.llm.apiKeyCipher = llmCipher
      llmStored = true
    }
  })

  // Do not retain the environment copy longer than needed in this process.
  delete process.env.VEXDESK_JUPITER_API_KEY
  delete process.env.VEXDESK_LLM_API_KEY

  if (jupiterStored || llmStored) {
    await audit.record('system', 'Runtime credentials stored in the OS keychain', {
      jupiterKeyStored: jupiterStored,
      llmKeyStored: llmStored,
      source: jupiterKey || llmKey ? 'environment-or-seed' : 'packaged-seed'
    })
  }
}
