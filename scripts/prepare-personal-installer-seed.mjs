import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'

const appData = process.env.APPDATA
if (!appData) throw new Error('APPDATA is unavailable.')

const statePath = join(appData, 'VexDesk', 'state.json')
const state = JSON.parse(readFileSync(statePath, 'utf8'))
const seed = {
  jupiterApiKeyCipher: state.jupiter?.apiKeyCipher ?? null,
  llmApiKeyCipher: state.llm?.apiKeyCipher ?? null
}

if (!seed.jupiterApiKeyCipher && !seed.llmApiKeyCipher) {
  throw new Error('No encrypted VexDesk key was found in the current Windows profile.')
}

writeFileSync('build/runtime-secret-seed.json', `${JSON.stringify(seed, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600
})
console.log('Prepared a DPAPI-bound runtime seed; plaintext credentials were not read or written.')
