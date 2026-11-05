<img src="assets/icon.svg" alt="OAuth Proxy for Google" height="80" />

# OAuth Proxy for Google

A tiny Cloudflare Worker that brokers Google OAuth token exchanges, so a browser extension can use an `authorization_code` + PKCE flow, with a long-lived refresh token, without shipping its OAuth client secret inside the extension package.

Project page at **[marvellouscode.works/tms-oauth-proxy](https://marvellouscode.works/tms-oauth-proxy)**, full documentation in the **[knowledge base](https://kb.marvellouscode.works/docs/tms-oauth-proxy/overview)**.

It was built for the Google Drive backup of [The Marvellous Suspender](https://github.com/gioxx/MarvellousSuspender) on Brave and Vivaldi, browsers where `chrome.identity.getAuthToken()` doesn't work, but nothing in the code is TMS-specific beyond its configuration.

Marvellous Codeworks runs an instance for TMS, and TMS users have nothing to set up. It isn't a shared service: it only holds the TMS client secret and only accepts the TMS extension's origin. For your own extension, [deploy your own](https://kb.marvellouscode.works/docs/tms-oauth-proxy/self-hosting).

## How it works

1. The extension gets an authorization code through `chrome.identity.launchWebAuthFlow()`, with a PKCE challenge.
2. It posts the code to the Worker, on `POST /token`, without any client secret.
3. The Worker adds `client_id` and `client_secret` and forwards the request to `https://oauth2.googleapis.com/token`.
4. The Worker returns Google's response unchanged, status code included.
5. Renewals follow the same path, with the `refresh_token` grant.

Everything else, such as calls to the Drive API, goes straight from the extension to Google. See [why it exists](https://kb.marvellouscode.works/docs/tms-oauth-proxy/overview#why-it-exists) and the [API reference](https://kb.marvellouscode.works/docs/tms-oauth-proxy/overview#api).

## Privacy and security

- **Tokens pass through the Worker.** The authorization code, the refresh token and the access token are handled in memory while an exchange is in flight. [Here is exactly what passes through it](https://kb.marvellouscode.works/docs/tms-oauth-proxy/overview#what-passes-through-the-worker).
- **Nothing is stored.** The Worker has no storage attached, its code doesn't log request or response bodies, and Workers Logs and traces are turned off in `wrangler.toml`.
- **The `Origin` check is a soft filter, not an access control boundary.** Any non-browser client can set that header. The real boundary is Google, which rejects every request without a genuine code or refresh token for this OAuth client. See the [security model](https://kb.marvellouscode.works/docs/tms-oauth-proxy/overview#security-model).

## Repository layout

| Path | Content |
| --- | --- |
| `worker/index.js` | The Worker: a single JavaScript module with no runtime dependencies |
| `wrangler.toml` | Worker configuration, with the public values `GOOGLE_CLIENT_ID` and `ALLOWED_ORIGIN` |
| `.dev.vars.example` | Template for the local client secret |
| `.github/workflows/health-check.yml` | Hourly end-to-end check of the official instance |

## Local development

Requires [Node.js](https://nodejs.org/). Copy `.dev.vars.example` to `.dev.vars`, which is git-ignored, and fill in a test secret, then:

```bash
npm install     # install Wrangler
npm run dev     # local Worker
npm run deploy  # deploy from your machine
```

## Deployment

The official instance deploys through Cloudflare's Git integration: every push to `main` goes to production, so merging a change to this repository redeploys the Worker.

`GOOGLE_CLIENT_SECRET` is a Cloudflare secret and is never committed. To rotate it, update it after changing it in the Google Cloud Console. No extension release is needed, since the secret never ships in the package:

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

To run your own instance, follow the [self-hosting guide](https://kb.marvellouscode.works/docs/tms-oauth-proxy/self-hosting).

## Monitoring

[`health-check.yml`](.github/workflows/health-check.yml) sends a fake refresh token through the official instance every hour. Google answers `invalid_grant` only after accepting the OAuth client, so that answer proves that the Worker, its origin check, the client secret and Google's token endpoint all work. Any other answer fails the workflow.

The workflow only targets the official instance. In a fork, change `WORKER_URL`, `ORIGIN` and the repository check.

## Feedback

Found a mistake or have a suggestion? [Open an issue](https://github.com/Marvellous-Codeworks/tms-oauth-proxy/issues/new). For problems with Drive backups in TMS, use the [TMS repository](https://github.com/gioxx/MarvellousSuspender/issues/new/choose) or the [report form](https://marvellouscode.works/tms/report).

## License

- **Code**: [AGPL-3.0](LICENSE).
- **Names and logos** (Marvellous Codeworks, TMS, OAuth Proxy for Google): not covered by the license, all rights reserved.
- **Icon**: `assets/icon.svg` uses the "key-round" icon from [Lucide](https://lucide.dev) (ISC license).
