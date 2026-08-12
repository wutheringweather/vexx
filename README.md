# VexDesk

A self-custodial desktop crypto agent. Keys are generated and encrypted on your
machine, an agent proposes on-chain actions, and a fail-closed safety gate sits
between every proposal and every signature.

Built for **Windows and macOS**.

[![X](https://img.shields.io/badge/X-@vexdesktop-000000?logo=x&logoColor=white)](https://x.com/vexdesktop)

---

## What it does

| | |
|---|---|
| **Local keys** | EVM and Solana accounts derived from one BIP-39 phrase. AES-256-GCM at rest, scrypt KDF (N=2¹⁷). The master password lives in memory only and is wiped on lock, on quit, and after 15 idle minutes. |
| **Fail-closed gate** | Twelve checks run on every fund-moving action, in every mode. An unknown network, an unparseable amount or a thrown error is a *block*, not a pass. The agent has no way to reach the rules. |
| **Four execution modes** | Agent·Restricted, Agent·Full, Mission·Restricted, Mission·Full. Autonomy decides whether a human is asked — never whether the gate runs. |
| **Missions** | Autonomous loops that terminate for a stated reason: objective met, deadline reached, capital exhausted, max loss, no opportunities, step limit, emergency stop, operator stop, runtime error. |
| **Decaying memory** | Three tiers of *lessons* — never balances. Strength halves every 30 days unless reinforced, so stale conclusions fade. Secrets are stripped before a lesson is written. |
| **Tamper-evident audit** | Every decision is appended to a hash-chained log. Editing a past line breaks every hash after it, and the app tells you the exact sequence number. |
| **Conversation history** | Threads are kept on disk and survive a restart, redacted on write like everything else. |
| **Command palette** | `Ctrl`/`Cmd` + `K` for navigation, mode switches, the vault lock and the emergency stop. |
| **Hardened shell** | Sandboxed renderer, context isolation, no Node in the UI, strict CSP with `connect-src 'self'` — the renderer cannot reach the network at all. Every IPC channel is allowlisted and zod-validated. |

## Compared to Vex

VexDesk is an independent implementation, written from scratch. `Vex-Foundation/Vex`
is **source-available, not open-source** — its licence forbids forks and
redistribution — so no code was taken from it.

Feature parity, honestly:

| Vex feature | VexDesk |
|---|---|
| EVM + Solana keys, local, AES-256-GCM + scrypt | Yes |
| Master password in memory only | Yes |
| Signing authority confined to the privileged process | Yes |
| Approval-gated fund movement | Yes |
| Fail-closed safety gate | Yes, 12 checks, with tests for every refusal path |
| Four execution modes | Yes |
| Mission termination reasons | Yes — their five, plus step limit, operator stop, emergency stop and runtime error |
| Three-tier memory, 50% decay per 30 days | Yes |
| Secret redaction before logging | Yes |
| Immutable local decision records | Yes, and hash-chained so tampering is detectable |
| Local conversation history | Yes |
| Sandboxed renderer, strict CSP, locked IPC | Yes |
| Local Postgres + pgvector knowledge base | **Same capability, different storage.** Real embeddings via the provider's `/embeddings` endpoint, vectors stored in plain JSON, cosine scan in-process. Semantic recall works; there is no Postgres and no native module. Off by default — see below. |
| Signed, auto-updating builds | **Mechanism implemented, credentials required.** `electron-updater` is wired with check/download/install in Settings. It stays inert until a release feed is published and, on macOS, until the build is signed and notarised. |
| Linux builds | AppImage and deb targets exist (`npm run package:linux`), but are not built by default and are untested. |

### Semantic memory is opt-in, deliberately

Embedding a lesson means sending its text to your provider. Unlike a chat turn,
that happens without you asking for it — a lesson gets embedded when it is
written, not when you speak — so it is **off by default**. With it off, recall
matches on shared words and nothing extra is transmitted. Turning it on in Settings backfills vectors for lessons you
already have; text is redacted before it is sent, and a provider failure
degrades to lexical recall rather than losing the lesson.

Not every OpenAI-compatible endpoint exposes `/embeddings` — use **Test
embeddings** in Settings before relying on it.

### What signing and updates actually need from you

Nothing here can be finished without credentials only you can buy:

| Want | You must supply |
|---|---|
| Windows signed installer | A code-signing certificate. Set `CSC_LINK` and `CSC_KEY_PASSWORD`, then rebuild. |
| macOS signed + notarised | A paid Apple Developer account, a *Developer ID Application* certificate in your keychain, and `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. |
| Working auto-updates | A published release feed. The `publish` block already points at this repository, and `.github/workflows/release.yml` builds and drafts one on a version tag — `git tag v0.1.0 && git push origin v0.1.0`. Publish the draft and updates go live. |

macOS auto-update does not work on an unsigned build at all — Squirrel.Mac
refuses it. Windows updates work unsigned, but SmartScreen warns users.

## Safety posture

- **Indicative swaps execute as simulations.** Normal `propose_swap` quotes are
  derived from spot prices rather than routed through a DEX and are labelled
  `simulated`.
- **Explicit SOL target buys can execute live through Jupiter v2.** `buy 1 SOL`
  targets at least 1 SOL using USDC; it is limited to Solana mainnet, requires
  a Jupiter key, an unlocked vault and enabled mainnet, and rebuilds the quote
  immediately before signing. Restricted mode waits for approval; full mode
  can execute after the gate allows it.

- **Testnets by default.** Sepolia, Base Sepolia and Solana Devnet. Mainnet
  networks cannot even be *selected* until you enable real funds in Guardrails.
- **Transfers broadcast for real** on whichever network is selected, after
  simulating first.
- **The transfer allowlist starts empty**, which means every transfer is refused
  until you deliberately add a destination.

## Requirements

- Node.js 20 or newer (built and tested on 24)
- npm 10+
- Windows 10/11, or macOS 12+

No native modules, no database server, no build tools needed.

## Getting started

```bash
npm install
```

```bash
npm run dev
```

On first launch you enter the access key for the built-in assistant, then create
a vault: pick a master password and write down the 24-word recovery phrase. The
phrase is shown exactly once and cannot be recovered.

## Connecting the built-in assistant

Paste the access key when the app first opens. It is stored through the
operating-system keychain (DPAPI on Windows, Keychain on macOS). The key is not
shown again or written to the audit log.

The key is a **VexDesk** key, not a provider key. It is metered per user and can
be revoked, and the real provider credential lives only on the server behind
`api.vexdesktop.xyz` — see [`proxy/`](proxy/). Nothing shipped in an installer
can be a secret, so no provider key is shipped in one.

### Or bring your own

**Settings → AI access** exposes the endpoint and model. Point them at anything
that speaks the OpenAI chat-completions dialect, add your own key, and your
traffic goes straight there — VexDesk never sees it. The desktop app is
provider-agnostic and always was; the hosted endpoint is a default, not a
requirement.

### What is sent, and what is not

Wallet addresses are stripped from everything the model sees, on both routes:

- The system prompt states whether the vault is unlocked, never which addresses
  it holds.
- Transfer destinations appear as aliases — `allowlist:1` — which privileged
  code resolves to the real address after the model has spoken and before the
  gate judges it.
- Tool output is address-masked on the way back into the conversation, so a
  balance lookup does not leak the account it belongs to.

The agent never needs an address: signing happens in main, against the vault,
whatever the model believes. `src/main/agent/privacy.test.ts` pins this down,
including a test that the assembled system prompt contains no address at all.

What *does* leave the machine is the conversation itself — your questions, the
agent's reasoning, and tool results with the addresses masked out.

The narrow direct command `buy <amount> SOL` is an exception to the model
provider requirement, but it still requires a Jupiter key and every gate
check. It is not a general-purpose pattern matcher for fund-moving text.

For an unattended desktop deployment, the key can also be injected once through
the process environment before starting VexDesk:

```powershell
$env:VEXDESK_JUPITER_API_KEY = Read-Host 'Jupiter API key'
$env:VEXDESK_LLM_API_KEY = Read-Host 'Access key'
Start-Process '.\VexDesk.exe' -Wait
Remove-Item Env:VEXDESK_JUPITER_API_KEY,Env:VEXDESK_LLM_API_KEY -ErrorAction SilentlyContinue
```

On first launch VexDesk seals the values with Windows DPAPI and removes the
environment copies from its process. It does not bake secrets into the
installer.

## Commands

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run package:win
```

```bash
npm run package:mac
```

Windows produces an NSIS installer and a portable `.exe` in `release/`. macOS
produces a DMG for arm64 and x64. Neither is code-signed out of the box —
add an Apple Developer ID or a Windows certificate to `electron-builder.yml`
if you need signed builds.

## Direct SOL buy

After unlocking the vault, configure a Jupiter API key in **Settings → Jupiter
live swaps**. Enable mainnet in **Guardrails**, select Solana Mainnet in
**Wallet**, and choose the execution mode you want:

```text
buy 1 SOL
buy 0.25 SOL on mainnet
```

The short form uses the active Solana network. A mainnet action can only pass
when mainnet is explicitly enabled. `buy` is a target-output intent, but
Jupiter v2 currently builds an ExactIn order, so VexDesk first estimates the
USDC input and loops quotes until the minimum output reaches the target. It
then fetches a fresh order before signing; if that fresh minimum misses the
target, nothing is signed and the action fails closed.

## Where your data lives

Everything is local, in the OS user-data directory:

- Windows — `%APPDATA%\VexDesk`
- macOS — `~/Library/Application Support/VexDesk`

| File | Contents |
|---|---|
| `keystore.json` | Encrypted keys. Useless without the master password. |
| `state.json` | Policy, actions, missions, provider settings. |
| `audit.jsonl` | Hash-chained decision log. |
| `lessons.json` | Agent memory. |
| `conversations.json` | Chat threads. |

Nothing is uploaded anywhere. There is no server component and no telemetry.

## Architecture

```
src/
├─ shared/          types + constants shared across the IPC boundary
├─ main/            the privileged process — the only place keys exist
│  ├─ vault/        scrypt + AES-256-GCM keystore, BIP-32 and SLIP-0010 derivation
│  ├─ guard/        the fail-closed gate
│  ├─ chains/       viem (EVM), @solana/web3.js, price + quote data
│  ├─ agent/        LLM client, tool registry, action pipeline, mission loop
│  ├─ memory/       decaying lessons + secret redaction
│  ├─ audit/        hash-chained append-only log
│  └─ ipc.ts        the allowlist, with zod validation on every payload
├─ preload/         contextBridge surface — a fixed list of named methods
└─ renderer/        React UI, sandboxed, no network access
```

The renderer is treated as hostile. It renders what main tells it and asks main
to do things; signing authority never crosses the boundary.

## Tests

```bash
npm test
```

120 tests covering the gate's refusal paths, keystore round-trips and tamper
detection, BIP-39/SLIP-0010 derivation against known vectors, secret redaction,
memory decay, semantic recall and its lexical fallback, audit-chain integrity,
conversation persistence, and an end-to-end run of the action pipeline from
proposal through gate to execution.

## Caveats

- Agent output is directional and can be wrong. You are responsible for
  anything you approve.
- Swap quotes are indicative, not routed. Do not read a simulated swap as a
  fill.
- Live target buys are currently limited to the SOL/USDC pair on Jupiter
  mainnet and require deliberate mainnet configuration.
- Losing your recovery phrase means losing the funds. There is no reset.

## Licence

MIT. This is an independent implementation, not affiliated with or derived from
any other project.
