import { useState } from 'react'
import { api } from '../lib/api'
import { useStore } from '../lib/store'
import { Callout, Field } from '../components/ui'
import { IconCheck, IconCopy, IconLock } from '../lib/icons'
import vxMark from '../assets/vx-mark.png'

type Stage = 'choose' | 'create' | 'import' | 'reveal' | 'unlock'

export default function VaultGate(): React.JSX.Element {
  const { snapshot, run, notify, refresh } = useStore()
  const exists = snapshot?.vault.state === 'locked'

  const [stage, setStage] = useState<Stage>(exists ? 'unlock' : 'choose')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [phrase, setPhrase] = useState('')
  const [mnemonic, setMnemonic] = useState<string[]>([])
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)

  const strength = evaluate(password)

  async function handleCreate(imported?: string): Promise<void> {
    if (password !== confirm) {
      notify('error', 'The two passwords do not match.')
      return
    }
    setBusy(true)
    const result = await run(() => api.vault.create(password, imported))
    setBusy(false)
    if (!result) return

    setPassword('')
    setConfirm('')
    setPhrase('')
    setMnemonic(result.mnemonic.split(/\s+/))
    setStage('reveal')
  }

  async function handleUnlock(): Promise<void> {
    setBusy(true)
    const result = await run(() => api.vault.unlock(password))
    setBusy(false)
    if (result) {
      setPassword('')
      await refresh()
    }
  }

  return (
    <div className="gate-screen">
      <div className="gate-card">
        <div className="gate-card__head">
          <img className="gate-card__mark" src={vxMark} alt="" />
          <div className="gate-card__title">
            {stage === 'unlock'
              ? 'Unlock VexDesk'
              : stage === 'reveal'
                ? 'Write this down'
                : stage === 'import'
                  ? 'Import a wallet'
                  : stage === 'create'
                    ? 'Create your vault'
                    : 'Welcome to VexDesk'}
          </div>
          <div className="gate-card__sub">
            {stage === 'unlock'
              ? 'Your master password decrypts the keystore. It is never written to disk.'
              : stage === 'reveal'
                ? 'This is the only time this phrase is shown. Anyone holding it holds your funds.'
                : stage === 'import'
                  ? 'Restore an existing BIP-39 wallet onto this machine.'
                  : stage === 'create'
                    ? 'Keys are generated locally and encrypted with AES-256-GCM.'
                    : 'A self-custodial crypto agent that runs entirely on your machine.'}
          </div>
        </div>

        <div className="gate-card__body">
          {stage === 'choose' && (
            <>
              <Callout>
                Nothing here talks to a server on your behalf. Keys are generated on this machine,
                encrypted at rest, and the master password stays in memory only.
              </Callout>
              <button className="btn btn--primary btn--block" onClick={() => setStage('create')}>
                Create a new vault
              </button>
              <button className="btn btn--block" onClick={() => setStage('import')}>
                Import a recovery phrase
              </button>
            </>
          )}

          {(stage === 'create' || stage === 'import') && (
            <>
              {stage === 'import' && (
                <Field
                  label="Recovery phrase"
                  hint="12 or 24 BIP-39 words, separated by spaces."
                >
                  <textarea
                    className="textarea input--mono"
                    value={phrase}
                    onChange={(e) => setPhrase(e.target.value)}
                    placeholder="word one two three…"
                    spellCheck={false}
                  />
                </Field>
              )}

              <Field
                label="Master password"
                hint="At least 12 characters with mixed case, a digit and a symbol. There is no reset."
              >
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
              </Field>

              {password.length > 0 && (
                <div className="stack stack--tight">
                  <div className="meter">
                    <div
                      className={`meter__fill${strength.tone ? ` meter__fill--${strength.tone}` : ''}`}
                      style={{ width: `${strength.score}%` }}
                    />
                  </div>
                  <span className="tiny muted">{strength.label}</span>
                </div>
              )}

              <Field label="Confirm password">
                <input
                  className="input"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !busy) {
                      void handleCreate(stage === 'import' ? phrase : undefined)
                    }
                  }}
                />
              </Field>

              <button
                className="btn btn--primary btn--block"
                disabled={busy || password.length === 0 || (stage === 'import' && phrase.trim().length === 0)}
                onClick={() => void handleCreate(stage === 'import' ? phrase : undefined)}
              >
                {busy ? 'Encrypting…' : stage === 'import' ? 'Import wallet' : 'Create vault'}
              </button>
              <button className="btn btn--ghost btn--block" onClick={() => setStage('choose')}>
                Back
              </button>
            </>
          )}

          {stage === 'reveal' && (
            <>
              <Callout tone="danger">
                <strong>Write these words on paper.</strong> They are not stored anywhere in
                readable form, and VexDesk cannot show them again or recover them for you.
              </Callout>

              <div className="words">
                {mnemonic.map((word, index) => (
                  <span className="word" key={`${word}-${index}`}>
                    <span className="word__n">{index + 1}</span>
                    {word}
                  </span>
                ))}
              </div>

              <button
                className="btn btn--block"
                onClick={() => {
                  void navigator.clipboard.writeText(mnemonic.join(' '))
                  notify('info', 'Copied. Clear your clipboard once it is written down.')
                }}
              >
                <IconCopy size={15} /> Copy to clipboard
              </button>

              <label className="switch">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span className="switch__track">
                  <span className="switch__thumb" />
                </span>
                <span className="tile__text">
                  <span className="tile__title">I have written the phrase down</span>
                  <span className="tile__sub">Losing it means losing the funds</span>
                </span>
              </label>

              <button
                className="btn btn--primary btn--block"
                disabled={!acknowledged}
                onClick={() => {
                  setMnemonic([])
                  void refresh()
                }}
              >
                <IconCheck size={15} /> Continue to VexDesk
              </button>
            </>
          )}

          {stage === 'unlock' && (
            <>
              <Field label="Master password">
                <input
                  className="input"
                  type="password"
                  value={password}
                  autoFocus
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !busy) void handleUnlock()
                  }}
                />
              </Field>
              <button
                className="btn btn--primary btn--block"
                disabled={busy || password.length === 0}
                onClick={() => void handleUnlock()}
              >
                <IconLock size={15} /> {busy ? 'Deriving key…' : 'Unlock'}
              </button>
              <p className="tiny muted" style={{ textAlign: 'center' }}>
                Key derivation is deliberately slow. A wrong password takes just as long.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function evaluate(password: string): { score: number; label: string; tone: string } {
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length
  const score = Math.round(Math.min(password.length / 20, 1) * 60 + (variety / 4) * 40)
  if (score < 45) return { score, label: 'Too weak — add length and variety', tone: 'danger' }
  // No modifier: the meter's base fill is already the accent.
  if (score < 75) return { score, label: 'Acceptable, longer would be better', tone: '' }
  return { score, label: 'Strong', tone: 'success' }
}
