# VexDesk model endpoint

The service behind `https://api.vexdesktop.xyz/v1`. It is a forwarder, not an
API: VexDesk desktop already speaks the OpenAI chat-completions dialect, so this
authenticates the caller, meters them, swaps in the real provider credential and
streams the answer back unchanged.

It exists to enforce two things the desktop app cannot:

- **The provider key stays on the server.** Anything shipped inside an installer
  can be pulled back out of it, whatever it was sealed with. Only this service
  ever holds the upstream credential.
- **One access key cannot spend everyone's budget.** Metering needs an identity,
  which is why access keys did not go away — they changed from a provider key
  into a VexDesk key you can revoke.

It never logs a request or response body. The prompts carry the operator's
portfolio reasoning, and a log line is the easiest way to end up holding data
you promised not to keep.

## Deploy

This is a standalone Vercel project. Deploy it separately from the landing page
so the two can scale, cache and move independently.

```bash
cd proxy && vercel --prod
```

Then attach `api.vexdesktop.xyz` to it in the Vercel dashboard.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `UPSTREAM_API_KEY` | yes | The real provider key. Never leaves this service. |
| `UPSTREAM_BASE_URL` | no | Defaults to `https://ai.megallm.io/v1`. |
| `KV_REST_API_URL` | yes | Upstash/Vercel KV REST endpoint. |
| `KV_REST_API_TOKEN` | yes | Its token. |
| `ALLOWED_MODELS` | no | Comma-separated. Defaults to `openai-gpt-oss-120b`. |
| `MAX_TOKENS_CEILING` | no | Per-request cap, default 2000. |
| `DAILY_CALL_LIMIT` | no | Calls per key per UTC day, default 500. |

## Issuing an access key

Keys are stored as a SHA-256 digest, never in the clear — a leaked dump should
not be a set of working credentials.

```bash
KEY="vxd_$(openssl rand -hex 24)"
HASH=$(printf '%s' "$KEY" | shasum -a 256 | cut -d' ' -f1)
echo "give the user: $KEY"
```

Then store the hash:

```bash
curl -X POST "$KV_REST_API_URL" \
  -H "Authorization: Bearer $KV_REST_API_TOKEN" \
  -H 'content-type: application/json' \
  -d "[\"SET\", \"vexdesk:key:$HASH\", \"active\"]"
```

Revoking is a `DEL` on the same field. The daily counter lives under
`vexdesk:calls:<hash>:<yyyy-mm-dd>` and expires on its own.

## Sizing the daily limit

The desktop app is chattier than it looks, and the numbers come straight from
its own limits:

- One ordinary conversation: up to **6** upstream calls, from `MAX_TOOL_ROUNDS`
  in `src/main/agent/runner.ts`.
- One mission: up to **12 steps × 6 rounds = 72** calls.

A user running three missions in an afternoon is a couple of hundred calls, so a
per-minute limit is the wrong instrument. The default is a daily budget.

Quota is spent *before* the upstream call, not after. A request that fails
upstream has still consumed capacity, and counting only successes is how a retry
loop drains a budget for free.

## Streaming, and why it matters

`src/main/agent/llm.ts` aborts a call after 90 seconds. Serverless functions
have an execution ceiling that varies by plan, and a long completion can outrun
it. The handler streams the upstream body straight through rather than buffering
it — check the ceiling on your plan before assuming a 90-second call survives.

## What this does not do

- No account system. Keys are issued out of band, by you.
- No per-model pricing or usage reporting beyond the daily counter.
- No CORS headers. The caller is a desktop app, not a browser.
