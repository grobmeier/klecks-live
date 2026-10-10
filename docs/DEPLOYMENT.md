# Self-hosting

Use one application origin for the presenter, viewer and WebSocket relay.
For an iPad, serve it through HTTPS with a certificate trusted by the device.
The relay itself speaks HTTP behind the proxy. No database or volume is needed.
Restarting the relay ends all sessions.

## Docker and HTTPS

Create an untracked `.env` containing your external origin and a random host
access key of at least 32 characters. Generate the key locally, for example with
`openssl rand -hex 32`, and keep it out of logs, source control and viewer links.

```dotenv
PUBLIC_ORIGIN=https://draw.example.org
HOST_ACCESS_KEY=replace-with-a-random-operator-key-of-at-least-32-characters
```

The example value is a placeholder, not a suitable key. Keep the actual key in
an operator-managed secret store or a file restricted to the operator.

```sh
docker compose build
docker compose up -d
```

Compose exposes the container only on host loopback at `127.0.0.1:5055`. Run a
reverse proxy on the same host and route your trusted HTTPS origin to it. For
example, this Caddy configuration obtains TLS for a domain you control:

```caddyfile
draw.example.org {
    reverse_proxy 127.0.0.1:5055
}
```

DNS must resolve the domain to the proxy and the proxy's certificate issuance
must work. For LAN-only hosting, arrange a certificate trusted by the iPad.
The relay explicitly includes its matching WebSocket origin in the content
security policy, because [`connect-src 'self'` does not cover WebSocket schemes
in every browser](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src).
Do not proceed past certificate warnings. Retain the external `Origin` header
and forward WebSocket upgrades. With Nginx, set upgrade headers, disable proxy
buffering for `/socket`, and allow an idle timeout longer than the relay's
15-second heartbeat. Avoid logging request bodies, `X-Host-Key` or socket
authentication messages. URL fragments are not transmitted in HTTP requests.

The presenter asks for the host access key when starting a network session.
Give that key only to people allowed to create sessions. Anyone who receives
a viewer link can watch its session; this milestone does not provide named-user
access controls. Rotate the operator key by changing configuration and restarting
the relay; existing sessions end at restart.

The container uses a digest-pinned Distroless Node 24 runtime with UID/GID 1000.
It contains no shell, npm, compiler or editor build tools. Compose sets a
read-only filesystem, drops capabilities, enables an init process and caps
memory and swap at 256 MiB, CPU at one core and processes at 64. Increase these
budgets only after measuring actual workload.
`GET /health` reports process availability; it does not establish device
acceptance or production viewer capacity.

Before configuring an external origin, validate the local image with
`docker build -t klecks-live:local .` followed by `npm run test:container`.
The smoke test uses a disposable loopback-only container and an ephemeral key;
it does not need or read the deployment `.env` file. See
[CONTRIBUTING.md](../CONTRIBUTING.md) for the checks and cleanup behaviour.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen interface; network binding requires an origin and host key |
| `PORT` | `5055` | HTTP port; `0` requests an available port during testing |
| `PUBLIC_ORIGIN` | inferred for loopback | Exact HTTP(S) origin, without a path or trailing slash; use HTTPS for network use |
| `HOST_ACCESS_KEY` | empty on loopback | Presenter password; at least 32 characters for network binding |
| `EDITOR_ACCESS` | `private` with a password, otherwise `public` | Require presenter sign-in before serving drawing tools, or permit public local drawing |
| `MAX_SESSIONS` | `10` | Maximum simultaneous in-memory sessions |
| `MAX_VIEWERS` | `25` | Viewer limit per session, range 1–100 |
| `FRAME_RATE` | `10` | Presenter update rate, range 1–30; relay permits a two-frame burst |
| `MAX_IMAGE_EDGE` | `1600` | Maximum width or height of transmitted pixels, range 128–4096 |
| `MAX_FRAME_BYTES` | `2097152` | Compressed image byte budget, range 1024–8388608 |
| `SESSION_LIFETIME_MS` | `14400000` | Absolute session lifetime, up to 24 hours |
| `RECONNECT_GRACE_MS` | `120000` | Presenter recovery window, up to 10 minutes |

The relay has a 5-second authentication deadline, a 3 MiB outgoing queue budget,
60 session/authentication attempts per minute per remote address and a bounded
address cache. Behind a reverse proxy, the address limit applies to that proxy's
address. Do not trust arbitrary forwarded IP headers; tune or enforce additional
rate limits at the proxy if larger deployments require them.

## Presenter access

`HOST_ACCESS_KEY` remains the operator-configured presenter password. Enter it
once on the private editor sign-in page, or in the presenter dialog when public
editor access is enabled. The relay issues a separate 256-bit random device
capability in a host-only, HttpOnly, SameSite=Strict cookie. With an HTTPS
`PUBLIC_ORIGIN`, the cookie also uses Secure and the `__Host-` prefix, including
when TLS terminates at the reverse proxy. Keep that external origin accurate;
arbitrary forwarded headers do not select cookie security.

**Remember this device** is unchecked by default. Remembered logins expire
absolutely after 30 days. Otherwise use a browser-session cookie with an
eight-hour server expiry; browser session restoration may retain session
cookies. The relay keeps only hashed device capabilities, at most 128 live
authorizations. Restart clears them all. Rotate the password and restart to
invalidate all logins; notify active presenters that restart ends sessions too.

After stopping sharing, **Forget this device** revokes this browser's capability
on the server and expires its cookie. Existing live sessions use independent
capabilities and retain their own stop/expiry rules. Forgetting one device does
not revoke another device's login.

Device sign-in uses `/api/presenter-access`: GET returns authorization status,
POST exchanges the password in `X-Host-Key` for a cookie (optionally with
`X-Remember-Device: true`), and DELETE revokes the current cookie. Mutations
require the configured Origin and share the request rate limit. Subsequent
`POST /api/sessions` requests use the cookie. Direct `X-Host-Key` session creation
remains supported for operator tools. Never log these request headers or cookies.
Cookie sign-in on non-loopback HTTP origins is rejected; use HTTPS for network
deployments. No password or device capability appears in the viewer link.

## Editor access

With `EDITOR_ACCESS=private`, unauthenticated `/`, `/present` and `/index.html`
requests show only a sign-in page; no editor iframe or bundle is loaded. The
server requires the device-login cookie for editor HTML, scripts, Klecks bundles
and all static assets except the explicit viewer/sign-in and licence allowlist.
Direct URLs, HEAD requests and encoded paths use the same access rule. The
operator password in a static-file header and a viewer link do not unlock these
assets. Revoked or expired cookies are denied on future downloads.

`EDITOR_ACCESS=public` permits anyone to load drawing tools while retaining the
presenter-password requirement for broadcasts. The default is private when
`HOST_ACCESS_KEY` is set, and public for keyless loopback development. Invalid
values and explicit private mode without a password fail startup. Compose
defaults to private; restart after changing the setting. For the Mac HTTPS
helper, use `EDITOR_ACCESS=private npm run start:lan` (or `public`).

Viewer pages and their small asset set remain public; seeing a live image still
requires the valid viewer capability. Code already downloaded into a browser
cannot be revoked. Forgetting a device does not reload or discard its drawing.

## Operational limits

Complete images multiply outbound bandwidth by the audience size. One 100 KiB
image at 10 fps to 25 viewers is roughly 24 MiB/s before protocol overhead.
Measure real drawings, Wi-Fi conditions and available bandwidth before promising
an audience size. A dropped viewer reconnects automatically and receives the
latest view. Capture resources and pending queues are bounded, but prolonged
iPad memory, battery and thermal behaviour require a physical-device test.

Stopping a session, expiry and restart discard retained pixels. Drawings are
not persisted by the relay. Export locally before closing or reloading the
presenter. This package does not configure production infrastructure, DNS,
certificates, backups or monitoring automatically.

For the guarded GitHub Actions online pilot and separate operator provisioning,
see [ACTIONS.md](ACTIONS.md) and the reviewed boundaries in [SECURITY.md](SECURITY.md).
