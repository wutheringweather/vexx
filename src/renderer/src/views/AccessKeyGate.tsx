import { useState } from 'react'
import { DEFAULT_LLM_BASE_URL, DEFAULT_LLM_MODEL } from '@shared/constants'
import { api } from '../lib/api'
import { useSnapshot, useStore } from '../lib/store'
import { Callout, Field } from '../components/ui'
import { IconCheck, IconLock } from '../lib/icons'

/**
 * First-launch provider setup.
 *
 * Remiora is bring-your-own-key: the endpoint and the credential are the
 * operator's, and neither is baked into the build. The key is handed to main
 * over the preload bridge and never comes back in a snapshot.
 *
 * Skippable on purpose. The agent is one feature, not the product — the vault,
 * the gate and the audit trail all work with no provider at all, and the local
 * planner still answers read-only questions. Locking someone out of their own
 * wallet because they have not signed up with a model vendor would be absurd.
 */
export default function AccessKeyGate({ onSkip }: { onSkip: () => void }): React.JSX.Element {
  const snapshot = useSnapshot()
  const { run, refresh } = useStore()
  const [baseUrl, setBaseUrl] = useState(snapshot.llm.baseUrl || DEFAULT_LLM_BASE_URL)
  const [model, setModel] = useState(snapshot.llm.model || DEFAULT_LLM_MODEL)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(): Promise<void> {
    const value = apiKey.trim()
    if (!value) return

    setBusy(true)
    const saved = await run(
      () =>
        api.llm.update({
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          temperature: snapshot.llm.temperature,
          maxTokens: snapshot.llm.maxTokens,
          apiKey: value
        }),
      'Provider key stored securely.'
    )
    setBusy(false)

    if (saved) {
      setApiKey('')
      await refresh()
    }
  }

  return (
    <div className="gate-screen">
      <div className="gate-card">
        <div className="gate-card__head">
          <span className="gate-card__mark">Remiora</span>
          <div className="gate-card__title">Connect a model provider</div>
          <div className="gate-card__sub">
            Remiora uses your own key, with any OpenAI-compatible endpoint. Nothing is billed to us
            and <em className="accent-serif">nothing routes through us.</em>
          </div>
        </div>

        <div className="gate-card__body">
          <Callout>
            Your key is encrypted with this device&apos;s operating-system keychain, is never
            returned by the app after setup, and is never written to the audit log. Wallet addresses
            are stripped from every prompt before it leaves the machine.
          </Callout>

          <Field label="Endpoint" hint="Any endpoint speaking the OpenAI chat-completions dialect.">
            <input
              className="input input--mono"
              value={baseUrl}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </Field>

          <Field label="Model">
            <input
              className="input input--mono"
              value={model}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setModel(e.target.value)}
            />
          </Field>

          <Field label="API key" hint="Your key from that provider.">
            <input
              className="input input--mono"
              type="password"
              value={apiKey}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your provider key"
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) void save()
              }}
            />
          </Field>

          <button
            className="btn btn--primary btn--block"
            disabled={busy || apiKey.trim().length === 0}
            onClick={() => void save()}
          >
            <IconCheck size={15} /> {busy ? 'Saving…' : 'Save and continue'}
          </button>

          <button className="btn btn--block" disabled={busy} onClick={onSkip}>
            Continue without a provider
          </button>

          <p className="tiny muted" style={{ textAlign: 'center' }}>
            The vault, the safety gate and the audit trail all work without one. A local planner
            answers read-only questions, and you can add a key later in Settings.
          </p>

          <div className="inline tiny muted" style={{ justifyContent: 'center' }}>
            <IconLock size={13} /> Stored locally on this device
          </div>
        </div>
      </div>
    </div>
  )
}
