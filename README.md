# tms-oauth-proxy

A tiny Cloudflare Worker that brokers a Google OAuth token exchange, so a
browser extension can use an `authorization_code` + PKCE flow (long-lived
refresh token, no reliance on `chrome.identity.getAuthToken()`) without
shipping its OAuth client secret inside the extension package.

Built for [The Marvellous Suspender](https://github.com/gioxx/MarvellousSuspender)'s
Drive backup feature on Brave/Vivaldi (browsers where `getAuthToken()`
doesn't work), but the worker itself is generic — nothing in it is
TMS-specific beyond the config values below. If you're building an extension
with the same problem, feel free to fork this and swap in your own values.

## Why this exists

Google's OAuth client types split into two groups:

- **"Web application"** clients are expected to keep their secret
  confidential, held server-side.
- **Installed-app types** ("Chrome app" / "Desktop app" / mobile) are exempt
  from that requirement, Google's own docs say an installed app genuinely
  can't keep a secret secret, so it doesn't have to.

A Chrome extension doing `authorization_code` + PKCE against Google usually
doesn't fit either exemption cleanly: a "Chrome app" client only works with
`getAuthToken()` (no PKCE support), and a "Desktop app" client rejects the
`https://<ext-id>.chromiumapp.org/` redirect URI that
`chrome.identity.launchWebAuthFlow()` requires (confirmed directly against
Google's live authorize endpoint, not assumed). That leaves a "Web
application" client as the only type that actually accepts the redirect URI,
with a secret it's not supposed to expose.

Shipping that secret inside the extension package anyway (it's what the
first version of this fix did) isn't just a narrow "someone could impersonate
the app" risk, it's a real Google OAuth policy compliance problem: a client
that doesn't meet its type's confidentiality expectations can get flagged or
suspended, breaking the feature for every user at once, not just enabling
some abuse edge case.

This worker removes the problem at the root: the secret lives here, as a
Cloudflare secret, never in a public package. The extension talks to this
worker instead of talking to Google's token endpoint directly.

## What it does (and doesn't do)

- Accepts `POST /token` with a JSON body describing either the initial
  `authorization_code` grant or a `refresh_token` renewal.
- Adds `client_id` + `client_secret` server-side, forwards the request to
  `https://oauth2.googleapis.com/token`, and returns Google's response
  as-is (status code included).
- Does **not** store, log, or inspect the code/token/secret values it
  handles. No `console.log` of request or response bodies anywhere in the
  code, so Cloudflare's request logging only ever sees metadata (timestamps,
  status codes, IP/geo), never the payload. Workers Logs and traces are
  turned off in `wrangler.toml`.
- Does **not** replace Google as the actual security boundary. See below.

## Endpoint

```
POST https://<your-worker>.workers.dev/token
Content-Type: application/json
Origin: chrome-extension://<your-extension-id>
```

Body, one of:

```json
{ "grant_type": "authorization_code", "code": "...", "redirect_uri": "...", "code_verifier": "..." }
```
```json
{ "grant_type": "refresh_token", "refresh_token": "..." }
```

Response: whatever Google's token endpoint returns, passed through
unchanged (status code included) — `access_token`/`refresh_token`/
`expires_in` on success, or Google's own error shape (`error`,
`error_description`) on failure.

## Security model — read this before relying on it

The `Origin` header check (`ALLOWED_ORIGIN`) is a basic CORS-style filter,
**not a real access control boundary**. `Origin` is a header a browser sets
and won't let JavaScript override, but nothing stops a non-browser client
(`curl`, a script) from setting it to whatever value it wants and calling
this worker directly. If you're evaluating this for your own use, don't
assume the origin check meaningfully restricts who can hit the endpoint.

The actual security boundary is Google's own validation: without a genuine,
unexpired `code` or `refresh_token` issued by Google for your specific OAuth
client, every request this worker forwards gets rejected by Google itself,
regardless of who sent it or what `Origin` they claimed. The worker's only
job is to keep the *client secret* off of every end user's machine; it was
never meant to gate who can attempt a token exchange.

## Using this for your own extension

1. Fork this repo.
2. Register your own Google OAuth client (Web application type, if you're in
   the same "needs PKCE + launchWebAuthFlow's redirect URI" situation this
   was built for) and note its client ID and secret.
3. Edit `wrangler.toml`:
   - `GOOGLE_CLIENT_ID` → your client's ID (public value, safe to commit).
   - `ALLOWED_ORIGIN` → `chrome-extension://<your-extension-id>` (also
     public — remember it's a soft filter, not real security, per above).
4. Deploy (see Setup below) and set your own `GOOGLE_CLIENT_SECRET`.
5. Point your extension's token-exchange code at
   `https://<your-worker>.workers.dev/token` instead of
   `https://oauth2.googleapis.com/token`, dropping `client_secret` (and
   ideally `client_id`, since the worker already has it) from the request
   body your extension sends — see `gsBackup.js`'s `exchangeTokenEndpoint()`
   in the TMS repo for a reference implementation.
6. Add your worker's domain to your extension's `manifest.json`
   `content_security_policy` under `connect-src`.

## Setup

Deploy is via Cloudflare's Git integration: connect this repo in the
Cloudflare dashboard (Workers & Pages → Create → Connect to Git), it builds
and deploys automatically on every push to `main`.

Set the secret once, either from the dashboard (Settings → Variables and
Secrets → add `GOOGLE_CLIENT_SECRET` as encrypted) or from the CLI against
the remote project:

```
npm install
wrangler login
wrangler secret put GOOGLE_CLIENT_SECRET
```

Update `GOOGLE_CLIENT_ID` and `ALLOWED_ORIGIN` in `wrangler.toml` if either
ever changes (new client, or a new extension ID after a re-publish under a
different key) — these are plain vars, committed, and picked up on the next
Git-triggered deploy.

Publishes to `https://<worker-name>.<your-subdomain>.workers.dev`. No custom
domain or Cloudflare-managed DNS zone is required, the free `workers.dev`
subdomain is enough.

### Environment variables / secrets reference

| Name | Where it's set | Committed? | Purpose |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | `wrangler.toml` `[vars]` | Yes (public value) | Identifies which OAuth client Google should use for the exchange. |
| `ALLOWED_ORIGIN` | `wrangler.toml` `[vars]` | Yes (public value) | Soft `Origin` filter, see Security model above. |
| `GOOGLE_CLIENT_SECRET` | Cloudflare secret (`wrangler secret put` or dashboard) | **Never** | The actual OAuth client secret. Encrypted at rest, not readable back from the dashboard/CLI once set, only replaceable. |

### Free tier limits

Cloudflare Workers' free plan includes 100,000 requests/day and 10ms CPU
time per invocation (this worker does no real computation, just a `fetch`
to Google, so CPU time is a non-issue). A handful of extension users each
hitting this a few times a day for token refreshes is nowhere near that
ceiling; the paid plan (from $5/month, 10M requests included) is there if
you ever outgrow it.

## Local dev

Copy `.dev.vars.example` to `.dev.vars`, fill in a test secret, then:

```
npm run dev
```

## Secret rotation

If the client secret is ever rotated in Google Cloud Console, update it here
with `wrangler secret put GOOGLE_CLIENT_SECRET` and redeploy. No extension
release is needed for a rotation, since the secret never ships in the
package.

## License

[AGPL-3.0](LICENSE)
