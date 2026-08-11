import type { VexApi } from '../../../preload'
import { createDevPreviewApi } from './dev-preview'

declare global {
  interface Window {
    vex?: VexApi
  }
}

function resolveApi(): VexApi {
  if (window.vex) return window.vex

  // Opened in a plain browser rather than Electron — that is the design
  // preview. Vite replaces `import.meta.env.DEV` with a literal at build time,
  // so in a production bundle this branch and the whole dev-preview module are
  // dropped by tree-shaking. It can never serve fake data to a real user.
  if (import.meta.env.DEV) {
    console.warn('[VexDesk] No preload bridge found — running the browser design preview.')
    return createDevPreviewApi()
  }

  throw new Error('The preload bridge is missing. VexDesk must run inside Electron.')
}

/** The only handle the UI has on anything privileged. */
export const api: VexApi = resolveApi()
