import { useState } from 'react'
import { api } from '../lib/api'
import { useSnapshot, useStore } from '../lib/store'
import { Callout, Field } from '../components/ui'
import { IconCheck, IconLock } from '../lib/icons'
import vxMark from '../assets/vx-mark.png'

/**
 * First-launch setup for the built-in assistant. The key is accepted once and
 * immediately handed to main over the preload bridge; it is never returned in
 * a snapshot or persisted by the renderer.
 */
export default function AccessKeyGate(): React.JSX.Element {
  const snapshot = useSnapshot()
  const { run, refresh } = useStore()
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(): Promise<void> {
    const value = apiKey.trim()
    if (!value) return

    setBusy(true)
    const saved = await run(
      () =>
        api.llm.update({
          baseUrl: snapshot.llm.baseUrl,
          model: snapshot.llm.model,
          temperature: snapshot.llm.temperature,
          maxTokens: snapshot.llm.maxTokens,
          apiKey: value
        }),
      'Access key stored securely.'
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
          <img className="gate-card__mark" src={vxMark} alt="" />
          <div className="gate-card__title">Set up VexDesk</div>
          <div className="gate-card__sub">
            Add the access key for the built-in assistant. This setup is required once per device.
          </div>
        </div>

        <div className="gate-card__body">
          <Callout>
            Your key is encrypted with this device&apos;s operating-system keychain and is never
            returned by the app after setup or written to the audit log.
          </Callout>

          <Field label="Access key" hint="Paste the key you received from the operator.">
            <input
              className="input input--mono"
              type="password"
              value={apiKey}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste access key"
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

          <div className="inline tiny muted" style={{ justifyContent: 'center' }}>
            <IconLock size={13} /> Stored locally on this device
          </div>
        </div>
      </div>
    </div>
  )
}
