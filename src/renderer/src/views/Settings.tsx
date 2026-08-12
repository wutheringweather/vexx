import { useEffect, useState } from 'react'
import type { EmbeddingProbeResult, JupiterProbeResult, LlmProbeResult } from '@shared/types'
import { api } from '../lib/api'
import { useSnapshot, useStore } from '../lib/store'
import { Callout, Card, Field, Modal, Switch, Tag } from '../components/ui'
import { IconAlert, IconCheck, IconLock } from '../lib/icons'

export default function Settings(): React.JSX.Element {
  const snapshot = useSnapshot()
  const { run, notify } = useStore()

  const [baseUrl, setBaseUrl] = useState(snapshot.llm.baseUrl)
  const [model, setModel] = useState(snapshot.llm.model)
  const [temperature, setTemperature] = useState(snapshot.llm.temperature)
  const [maxTokens, setMaxTokens] = useState(snapshot.llm.maxTokens)
  const [apiKey, setApiKey] = useState('')
  const [probe, setProbe] = useState<LlmProbeResult | null>(null)
  const [jupiterApiKey, setJupiterApiKey] = useState('')
  const [jupiterProbe, setJupiterProbe] = useState<JupiterProbeResult | null>(null)
  const [busy, setBusy] = useState(false)

  const [embeddingModel, setEmbeddingModel] = useState(snapshot.memory.embeddingModel)
  const [embeddingProbe, setEmbeddingProbe] = useState<EmbeddingProbeResult | null>(null)

  const [destroying, setDestroying] = useState(false)
  const [destroyPassword, setDestroyPassword] = useState('')

  useEffect(() => {
    setBaseUrl(snapshot.llm.baseUrl)
    setModel(snapshot.llm.model)
    setTemperature(snapshot.llm.temperature)
    setMaxTokens(snapshot.llm.maxTokens)
  }, [snapshot.llm])

  useEffect(() => {
    setEmbeddingModel(snapshot.memory.embeddingModel)
  }, [snapshot.memory.embeddingModel])

  async function saveProvider(): Promise<void> {
    setBusy(true)
    const saved = await run(
      () =>
        api.llm.update({
          baseUrl,
          model,
          temperature,
          maxTokens,
          // null leaves the stored key alone, so an untouched field is a no-op.
          apiKey: apiKey.length > 0 ? apiKey : null
        }),
      'Provider settings saved.'
    )
    setBusy(false)
    if (saved) setApiKey('')
  }

  async function testProvider(): Promise<void> {
    setBusy(true)
    const result = await run(() => api.llm.probe())
    setBusy(false)
    if (result) {
      setProbe(result)
      notify(result.ok ? 'success' : 'error', result.ok ? `Responded in ${result.latencyMs} ms.` : result.detail)
    }
  }

  async function saveJupiter(): Promise<void> {
    setBusy(true)
    const saved = await run(
      () => api.jupiter.updateApiKey(jupiterApiKey.length > 0 ? jupiterApiKey : null),
      'Jupiter settings saved.'
    )
    setBusy(false)
    if (saved) setJupiterApiKey('')
  }

  async function testJupiter(): Promise<void> {
    setBusy(true)
    const result = await run(() => api.jupiter.probe())
    setBusy(false)
    if (result) {
      setJupiterProbe(result)
      notify(result.ok ? 'success' : 'error', result.ok ? `Responded in ${result.latencyMs} ms.` : result.detail)
    }
  }

  return (
    <>
      <Card
        title="Model provider"
        description="Any OpenAI-compatible endpoint. MegaLLM by default."
        actions={
          snapshot.llm.hasApiKey ? (
            <Tag tone="success">key stored</Tag>
          ) : (
            <Tag tone="accent">no key</Tag>
          )
        }
      >
        <div className="stack">
          <Field label="Base URL" hint="The /chat/completions path is appended automatically.">
            <input className="input input--mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </Field>

          <Field label="Model">
            <input className="input input--mono" value={model} onChange={(e) => setModel(e.target.value)} />
          </Field>

          <Field
            label="API key"
            hint={
              snapshot.llm.hasApiKey
                ? 'A key is already stored. Leave this blank to keep it, or type a new one to replace it.'
                : 'Stored via the OS keychain (DPAPI on Windows, Keychain on macOS). It is never sent to the renderer and never written to the audit log.'
            }
          >
            <input
              className="input input--mono"
              type="password"
              value={apiKey}
              placeholder={snapshot.llm.hasApiKey ? '••••••••••••••••' : 'sk-…'}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>

          <div className="grid grid--2">
            <Field label="Temperature" hint="Lower is steadier. 0.3 is a sensible default here.">
              <input
                className="input num"
                type="number"
                step="0.1"
                min={0}
                max={2}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
              />
            </Field>
            <Field label="Max tokens">
              <input
                className="input num"
                type="number"
                min={64}
                max={32000}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
              />
            </Field>
          </div>

          {probe && (
            <Callout tone={probe.ok ? 'success' : 'danger'}>
              <strong>{probe.ok ? 'Provider reachable' : 'Provider failed'}</strong> — {probe.detail}
              {probe.ok ? ` (${probe.latencyMs} ms)` : ''}
            </Callout>
          )}

          <div className="inline">
            <button className="btn" disabled={busy} onClick={() => void testProvider()}>
              Test connection
            </button>
            <span className="spacer" />
            {snapshot.llm.hasApiKey && (
              <button
                className="btn btn--danger"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => api.llm.update({ baseUrl, model, temperature, maxTokens, apiKey: '' }),
                    'API key removed.'
                  )
                }
              >
                Remove key
              </button>
            )}
            <button className="btn btn--primary" disabled={busy} onClick={() => void saveProvider()}>
              <IconCheck size={15} /> {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </Card>

      <Card
        title="Jupiter live swaps"
        description="Required for a real SOL buy from a direct command; simulation and testnet remain safe defaults."
        actions={
          snapshot.jupiter.hasApiKey ? <Tag tone="success">key stored</Tag> : <Tag tone="accent">no key</Tag>
        }
      >
        <div className="stack">
          <Callout tone="accent">
            Live execution uses Jupiter v2 on Solana mainnet. The command <code>buy 1 SOL</code>{' '}
            treats the amount as a target output, funds it with USDC, quotes again immediately
            before signing, and still follows the active mode and Guardrails.
          </Callout>
          <Field
            label="Jupiter API key"
            hint={
              snapshot.jupiter.hasApiKey
                ? 'A key is already stored. Leave this blank to keep it, or type a new one to replace it.'
                : 'Stored via the OS keychain. It is never returned to the renderer or written to the audit log.'
            }
          >
            <input
              className="input input--mono"
              type="password"
              value={jupiterApiKey}
              placeholder={snapshot.jupiter.hasApiKey ? '••••••••••••••••' : 'Jupiter key'}
              onChange={(e) => setJupiterApiKey(e.target.value)}
            />
          </Field>
          {jupiterProbe && (
            <Callout tone={jupiterProbe.ok ? 'success' : 'danger'}>
              <strong>{jupiterProbe.ok ? 'Jupiter reachable' : 'Jupiter failed'}</strong> — {jupiterProbe.detail}
              {jupiterProbe.ok ? ` (${jupiterProbe.latencyMs} ms)` : ''}
            </Callout>
          )}
          <div className="inline">
            <button className="btn" disabled={busy || !snapshot.jupiter.hasApiKey} onClick={() => void testJupiter()}>
              Test connection
            </button>
            <span className="spacer" />
            {snapshot.jupiter.hasApiKey && (
              <button
                className="btn btn--danger"
                disabled={busy}
                onClick={() => void run(() => api.jupiter.updateApiKey(''), 'Jupiter key removed.')}
              >
                Remove key
              </button>
            )}
            <button className="btn btn--primary" disabled={busy} onClick={() => void saveJupiter()}>
              <IconCheck size={15} /> {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </Card>

      <Card
        title="Semantic memory"
        description="Recall by meaning instead of by shared words"
        actions={
          <Tag tone={snapshot.memory.embeddingsEnabled ? 'success' : undefined}>
            {snapshot.memory.embeddingsEnabled
              ? `${snapshot.memory.embeddedCount}/${snapshot.memory.totalCount} embedded`
              : 'lexical only'}
          </Tag>
        }
      >
        <div className="stack">
          <Callout tone={snapshot.memory.embeddingsEnabled ? 'accent' : undefined}>
            This is the only feature that sends anything off this machine.
            <strong> Lesson text is posted to your provider to be embedded</strong> — redacted
            first, but it still leaves the device. With it off, recall matches on shared words and
            nothing is transmitted.
          </Callout>

          <Switch
            checked={snapshot.memory.embeddingsEnabled}
            label="Enable semantic recall"
            hint="Turning it on backfills vectors for lessons you already have"
            onChange={(value) =>
              void run(
                async () => {
                  const result = await api.memory.updateSettings({
                    embeddingsEnabled: value,
                    embeddingModel
                  })
                  return result
                },
                value ? 'Semantic memory enabled.' : 'Semantic memory disabled.'
              )
            }
          />

          <Field
            label="Embedding model"
            hint="Must be a model your provider exposes on /embeddings. Not every OpenAI-compatible endpoint does."
          >
            <input
              className="input input--mono"
              value={embeddingModel}
              onChange={(e) => setEmbeddingModel(e.target.value)}
            />
          </Field>

          {embeddingProbe && (
            <Callout tone={embeddingProbe.ok ? 'success' : 'danger'}>
              <strong>{embeddingProbe.ok ? 'Embeddings reachable' : 'Embeddings failed'}</strong> —{' '}
              {embeddingProbe.detail}
            </Callout>
          )}

          <div className="inline">
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                const result = await run(() => api.memory.probeEmbeddings())
                setBusy(false)
                if (result) setEmbeddingProbe(result)
              }}
            >
              Test embeddings
            </button>
            {snapshot.memory.embeddingsEnabled &&
              snapshot.memory.embeddedCount < snapshot.memory.totalCount && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await api.memory.backfill()
                      return r
                    }, 'Backfill finished.')
                  }
                >
                  Backfill {snapshot.memory.totalCount - snapshot.memory.embeddedCount} remaining
                </button>
              )}
            <span className="spacer" />
            <button
              className="btn btn--primary"
              disabled={busy || embeddingModel === snapshot.memory.embeddingModel}
              onClick={() =>
                void run(
                  () =>
                    api.memory.updateSettings({
                      embeddingsEnabled: snapshot.memory.embeddingsEnabled,
                      embeddingModel
                    }),
                  'Embedding model saved.'
                )
              }
            >
              <IconCheck size={15} /> Save model
            </button>
          </div>
        </div>
      </Card>

      <Card
        title="Updates"
        description={`You are running version ${snapshot.update.currentVersion}`}
        actions={<Tag tone={snapshot.update.state === 'ready' ? 'success' : undefined}>{snapshot.update.state}</Tag>}
      >
        <div className="stack">
          {snapshot.update.supported ? (
            <Callout tone={snapshot.update.state === 'error' ? 'danger' : undefined}>
              {snapshot.update.detail}
              {snapshot.update.progressPercent !== null &&
                snapshot.update.state === 'downloading' &&
                ` — ${snapshot.update.progressPercent}%`}
            </Callout>
          ) : (
            <Callout>
              <strong>Updates are inactive for this build.</strong> {snapshot.update.detail} A
              release feed has to be configured in <code>electron-builder.yml</code> and the app
              published before the updater has anywhere to look. On macOS, auto-update additionally
              requires a Developer ID signed and notarised build.
            </Callout>
          )}

          <div className="inline">
            <button
              className="btn"
              disabled={!snapshot.update.supported || snapshot.update.state === 'checking'}
              onClick={() => void run(() => api.update.check())}
            >
              Check now
            </button>
            {snapshot.update.state === 'available' && (
              <button className="btn btn--primary" onClick={() => void run(() => api.update.download())}>
                Download {snapshot.update.availableVersion}
              </button>
            )}
            {snapshot.update.state === 'ready' && (
              <button className="btn btn--success" onClick={() => void run(() => api.update.install())}>
                Restart and install
              </button>
            )}
          </div>
        </div>
      </Card>

      <Card title="Vault" description="Accounts derived from a single BIP-39 phrase">
        <div className="stack">
          {snapshot.vault.accounts.map((account) => (
            <div className="tile" key={account.address}>
              <div className="tile__text">
                <div className="tile__title">{account.label}</div>
                <div className="tile__sub addr">{account.address}</div>
              </div>
              <Tag>{account.derivationPath}</Tag>
            </div>
          ))}

          <Callout>
            The keystore is encrypted with AES-256-GCM under a scrypt-derived key (N=2<sup>17</sup>).
            The master password is held in memory only and is wiped on lock, on quit and after{' '}
            {Math.round(((snapshot.vault.autoLockAt ?? 0) - Date.now()) / 60000) || 15} minutes idle.
          </Callout>

          <div className="inline">
            <button className="btn" onClick={() => void run(() => api.vault.lock(), 'Vault locked.')}>
              <IconLock size={15} /> Lock now
            </button>
            <span className="spacer" />
            <button className="btn btn--danger" onClick={() => setDestroying(true)}>
              <IconAlert size={15} /> Delete vault
            </button>
          </div>
        </div>
      </Card>

      <Card title="Where your data lives" description="All of it, on this machine only">
        <div className="stack stack--tight small muted">
          <div>
            <strong className="strong">keystore.json</strong> — encrypted keys. Useless without the
            master password.
          </div>
          <div>
            <strong className="strong">state.json</strong> — policy, actions, missions, provider
            settings.
          </div>
          <div>
            <strong className="strong">audit.jsonl</strong> — the hash-chained decision log.
          </div>
          <div>
            <strong className="strong">lessons.json</strong> — agent memory.
          </div>
          <div style={{ marginTop: 8 }}>
            On Windows these sit under <code>%APPDATA%\VexDesk</code>, on macOS under{' '}
            <code>~/Library/Application Support/VexDesk</code>. Nothing is uploaded anywhere. The
            renderer cannot reach the network at all — its CSP allows connections only to itself.
          </div>
        </div>
      </Card>

      {destroying && (
        <Modal
          title="Delete the vault"
          description="This removes the encrypted keystore from this machine."
          onClose={() => {
            setDestroying(false)
            setDestroyPassword('')
          }}
          footer={
            <>
              <button
                className="btn btn--ghost"
                onClick={() => {
                  setDestroying(false)
                  setDestroyPassword('')
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn--danger"
                disabled={destroyPassword.length === 0}
                onClick={async () => {
                  const ok = await run(() => api.vault.destroy(destroyPassword), 'Vault deleted.')
                  setDestroying(false)
                  setDestroyPassword('')
                  if (ok) void api.snapshot()
                }}
              >
                Delete permanently
              </button>
            </>
          }
        >
          <Callout tone="danger">
            <strong>Without your recovery phrase this is irreversible.</strong> Any funds held by
            these addresses become unreachable from this machine. Make sure the phrase is written
            down before you continue.
          </Callout>
          <Field label="Confirm with your master password">
            <input
              className="input"
              type="password"
              value={destroyPassword}
              autoFocus
              onChange={(e) => setDestroyPassword(e.target.value)}
            />
          </Field>
        </Modal>
      )}
    </>
  )
}
