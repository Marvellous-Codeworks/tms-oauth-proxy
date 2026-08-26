# tms-oauth-proxy

Cloudflare Worker that brokers the Google OAuth token exchange for
[The Marvellous Suspender](https://github.com/gioxx/MarvellousSuspender)'s
Drive backup feature (authorization-code + PKCE flow on Brave/Vivaldi).

Its only job is to hold `GOOGLE_CLIENT_SECRET` server-side and forward the
token/refresh request to Google. The extension never embeds the secret.

## Endpoint

`POST /token` from origin `chrome-extension://noogafoofpebimajpfpamcfhoaifemoa` only.

Body (JSON):

- Initial exchange: `{ "grant_type": "authorization_code", "code": "...", "redirect_uri": "...", "code_verifier": "..." }`
- Refresh: `{ "grant_type": "refresh_token", "refresh_token": "..." }`

Response: Google's token endpoint response, passed through as-is.

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
ever changes (new client, or new extension ID after a re-publish under a
different key) — these are plain vars, committed, and picked up on the next
Git-triggered deploy.

Publishes to `https://tms-oauth-proxy.<your-subdomain>.workers.dev`.

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
