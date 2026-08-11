import { useState } from 'react'
import { findNetwork } from '@shared/constants'
import { api } from '../lib/api'
import { useSnapshot, useStore } from '../lib/store'
import { Tag, Callout, Card, Field } from '../components/ui'
import { relativeTime, usd } from '../lib/format'
import { IconCopy, IconExternal, IconRefresh, IconWallet } from '../lib/icons'

export default function Wallet(): React.JSX.Element {
  const snapshot = useSnapshot()
  const { run, notify } = useStore()

  const evmNetworks = snapshot.networks.filter((n) => n.family === 'evm')
  const solNetworks = snapshot.networks.filter((n) => n.family === 'solana')
  const solNetwork = findNetwork(snapshot.activeSolanaNetworkId)

  const [kind, setKind] = useState<'transfer' | 'swap'>('transfer')
  const [networkId, setNetworkId] = useState(snapshot.activeEvmNetworkId)
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [symbol, setSymbol] = useState('ETH')
  const [sellSymbol, setSellSymbol] = useState('ETH')
  const [buySymbol, setBuySymbol] = useState('USDC')
  const [sellAmount, setSellAmount] = useState('')
  const [busy, setBusy] = useState(false)

  async function propose(): Promise<void> {
    setBusy(true)
    const result = await run(() =>
      kind === 'transfer'
        ? api.actions.propose({ kind: 'transfer', networkId, to, amount, symbol })
        : api.actions.propose({ kind: 'swap', networkId, sellSymbol, buySymbol, sellAmount })
    )
    setBusy(false)
    if (!result) return

    if (result.status === 'blocked') {
      notify('error', `Gate refused it: ${result.verdict.reason}`)
    } else if (result.status === 'pending') {
      notify('success', 'Queued on the Approvals screen.')
    } else {
      notify('success', `Action ${result.status}.`)
    }
  }

  return (
    <>
      <div className="grid grid--2">
        {snapshot.vault.accounts.map((account) => {
          const balance = snapshot.balances.find(
            (b) => b.address.toLowerCase() === account.address.toLowerCase()
          )
          const network = balance ? findNetwork(balance.networkId) : undefined
          return (
            <Card
              key={account.address}
              title={account.label}
              description={account.derivationPath}
              actions={<Tag tone={account.family === 'evm' ? 'accent' : undefined}>{account.family}</Tag>}
            >
              <div className="stack">
                <div className="stat__value num">
                  {balance ? balance.formatted : '—'}{' '}
                  <span className="muted" style={{ fontSize: 16 }}>
                    {balance?.symbol ?? ''}
                  </span>
                </div>
                <div className="addr">{account.address}</div>
                <div className="inline">
                  <button
                    className="btn btn--sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(account.address)
                      notify('info', 'Address copied.')
                    }}
                  >
                    <IconCopy size={13} /> Copy
                  </button>
                  {network && (
                    <button
                      className="btn btn--sm"
                      onClick={() =>
                        void run(() =>
                          api.openExternal(`${network.explorerAddressUrl}${account.address}`)
                        )
                      }
                    >
                      <IconExternal size={13} /> Explorer
                    </button>
                  )}
                  {balance?.error && <Tag tone="danger">RPC: {balance.error.slice(0, 30)}</Tag>}
                  <span className="spacer" />
                  {balance && (
                    <span className="tiny muted">updated {relativeTime(balance.fetchedAt)}</span>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      <div className="grid grid--2">
        <Card title="Networks" description="Mainnets stay unselectable until you enable them in Guardrails">
          <div className="stack">
            <Field label="EVM network">
              <select
                className="select"
                value={snapshot.activeEvmNetworkId}
                onChange={(e) => void run(() => api.setNetwork(e.target.value))}
              >
                {evmNetworks.map((network) => (
                  <option
                    key={network.id}
                    value={network.id}
                    disabled={network.isMainnet && !snapshot.policy.mainnetEnabled}
                  >
                    {network.label}
                    {network.isMainnet ? ' — real funds' : ''}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Solana network">
              <select
                className="select"
                value={snapshot.activeSolanaNetworkId}
                onChange={(e) => void run(() => api.setNetwork(e.target.value))}
              >
                {solNetworks.map((network) => (
                  <option
                    key={network.id}
                    value={network.id}
                    disabled={network.isMainnet && !snapshot.policy.mainnetEnabled}
                  >
                    {network.label}
                    {network.isMainnet ? ' — real funds' : ''}
                  </option>
                ))}
              </select>
            </Field>

            <div className="inline">
              <button className="btn btn--sm" onClick={() => void run(() => api.refreshBalances())}>
                <IconRefresh size={13} /> Refresh balances
              </button>
              {solNetwork && !solNetwork.isMainnet && (
                <button
                  className="btn btn--sm"
                  onClick={() => void run(() => api.airdrop(), 'Devnet airdrop confirmed.')}
                >
                  Request 1 SOL devnet airdrop
                </button>
              )}
            </div>

            <Callout>
              To fund the EVM testnet address, use a public Sepolia or Base Sepolia faucet with the
              address above. VexDesk never asks anyone for funds on your behalf.
            </Callout>
          </div>
        </Card>

        <Card
          title="Manual action"
          description="Proposed by you, judged by the same gate the agent faces"
        >
          <div className="stack">
            <Field label="Action">
              <select className="select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="transfer">Transfer — signs and broadcasts for real</option>
                <option value="swap">Swap — executes as a simulation</option>
              </select>
            </Field>

            <Field label="Network">
              <select className="select" value={networkId} onChange={(e) => setNetworkId(e.target.value)}>
                {snapshot.networks
                  .filter((n) => !n.isMainnet || snapshot.policy.mainnetEnabled)
                  .map((network) => (
                    <option key={network.id} value={network.id}>
                      {network.label}
                    </option>
                  ))}
              </select>
            </Field>

            {kind === 'transfer' ? (
              <>
                <Field
                  label="Destination"
                  hint="Must already be on the transfer allowlist in Guardrails, or the gate refuses it."
                >
                  <input
                    className="input input--mono"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="0x… or a Solana address"
                  />
                </Field>
                <div className="grid grid--2">
                  <Field label="Amount">
                    <input
                      className="input num"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.01"
                    />
                  </Field>
                  <Field label="Symbol">
                    <input
                      className="input"
                      value={symbol}
                      onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                    />
                  </Field>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid--2">
                  <Field label="Sell">
                    <input
                      className="input"
                      value={sellSymbol}
                      onChange={(e) => setSellSymbol(e.target.value.toUpperCase())}
                    />
                  </Field>
                  <Field label="Buy">
                    <input
                      className="input"
                      value={buySymbol}
                      onChange={(e) => setBuySymbol(e.target.value.toUpperCase())}
                    />
                  </Field>
                </div>
                <Field label="Sell amount">
                  <input
                    className="input num"
                    value={sellAmount}
                    onChange={(e) => setSellAmount(e.target.value)}
                    placeholder="0.05"
                  />
                </Field>
              </>
            )}

            <button
              className="btn btn--primary"
              disabled={busy || (kind === 'transfer' ? !to || !amount : !sellAmount)}
              onClick={() => void propose()}
            >
              <IconWallet size={15} /> {busy ? 'Evaluating…' : 'Send to the gate'}
            </button>

            <p className="tiny muted">
              Per-action cap is {usd(snapshot.policy.maxNotionalUsdPerAction)}. Anything above it is
              refused before it reaches a signature.
            </p>
          </div>
        </Card>
      </div>
    </>
  )
}
