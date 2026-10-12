# Self-hosting

Live Draw serves the presenter, viewer and WebSocket relay from one origin.
Run it behind an HTTPS reverse proxy with a certificate trusted by the devices
using it. The relay needs no database or drawing volume.

## Docker and HTTPS

Create a `.env` file in the repository root with your public origin and a
presenter password:

```dotenv
PUBLIC_ORIGIN=https://draw.example.org
HOST_ACCESS_KEY=replace-with-a-random-password-of-at-least-32-characters
EDITOR_ACCESS=private
```

Generate the password with `openssl rand -hex 32`. Keep `.env` out of source
control and restrict access with `chmod 600 .env`. Give the password only to
people allowed to present; viewers receive a separate viewer link.

Build and start the service:

```sh
docker compose build
docker compose up -d
```

Compose exposes the app at `127.0.0.1:5055` on the host. Point your domain's DNS
to that host and configure an HTTPS proxy. With Caddy:

```caddyfile
draw.example.org {
    reverse_proxy 127.0.0.1:5055 {
        header_up X-Real-IP {remote_host}
    }
}
```

Use the same external origin in `PUBLIC_ORIGIN`, without a path or trailing
slash. The proxy must preserve `Origin` and support WebSocket upgrades. For
Nginx, set the upgrade headers, disable buffering for `/socket`, and use an idle
timeout longer than the relay's 15-second heartbeat.

Keep the application port on host loopback. Expose only the proxy's HTTP/HTTPS
ports. Exclude `X-Host-Key`, `Cookie`, `Authorization`,
`Sec-WebSocket-Protocol`, request bodies and socket authentication messages from
logs. See [Security](SECURITY.md) for the access
model and runtime restrictions.

For local Mac-to-iPad access without a public domain, use the
[local HTTPS helper](LOCAL_HTTPS.md).

## Presenter and editor access

`HOST_ACCESS_KEY` is the presenter password. With a password configured, the
editor defaults to private: users sign in before drawing tools load, and the
server protects editor pages, scripts and bundles. Viewer pages remain public;
watching a live image requires the valid viewer link.

Set `EDITOR_ACCESS=public` to let anyone load the editor and draw locally.
Broadcasting still requires the presenter password. Explicit private mode
requires a password, and invalid settings stop startup.

Sign-in creates a separate device credential in a host-only, HttpOnly,
SameSite=Strict cookie. HTTPS uses `Secure` and the `__Host-` prefix even when
TLS terminates at the proxy. **Remember this device** gives access for up to
30 days; unchecked access uses a browser-session cookie with an eight-hour
server expiry. The server retains at most 128 hashed device credentials.

**More → Forget this device** revokes the current browser's credential after
sharing stops. Other devices retain their access. Changing the password and
restarting the relay clears all device logins and sessions. Code and pixels
already downloaded into a browser cannot be revoked.

## Configuration

Node startup reads environment variables directly. To load a local `.env` file:

```sh
node --env-file=.env server/index.mjs
```

| Variable | Application default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen interface; non-loopback binding requires an explicit origin and password |
| `PORT` | `5055` | HTTP port; `0` selects an available port |
| `PUBLIC_ORIGIN` | inferred on loopback | Exact external HTTP(S) origin; use HTTPS for network access |
| `HOST_ACCESS_KEY` | empty on loopback | Presenter password; at least 32 characters for non-loopback binding |
| `EDITOR_ACCESS` | `private` with a password, otherwise `public` | Require sign-in for editor downloads or allow local drawing without sign-in |
| `TRUSTED_PROXY_ADDRESSES` | empty | Comma-separated exact proxy peer IPs allowed to supply `X-Real-IP` |
| `MAX_SESSIONS` | `10` | Simultaneous sessions, range 1–100 |
| `MAX_VIEWERS` | `25` | Viewers per session, range 1–100 |
| `FRAME_RATE` | `10` | Maximum updates per second, range 1–30 |
| `MAX_IMAGE_EDGE` | `1600` | Maximum width or height in transmitted pixels, range 128–4096 |
| `MAX_FRAME_BYTES` | `2097152` | Compressed frame budget in bytes, range 1024–8388608 |
| `SESSION_LIFETIME_MS` | `14400000` | Session lifetime in milliseconds, maximum 24 hours |
| `RECONNECT_GRACE_MS` | `120000` | Presenter recovery window in milliseconds, maximum 10 minutes |

Compose sets `HOST=0.0.0.0` inside the container, `PORT=5055`, and passes
`PUBLIC_ORIGIN`, `HOST_ACCESS_KEY`, `EDITOR_ACCESS` and
`TRUSTED_PROXY_ADDRESSES` from `.env`. Other settings
must be added to the service's environment. For example, create
`compose.override.yaml` for smoother updates and a smaller frame budget:

```yaml
services:
  live-draw:
    environment:
      FRAME_RATE: 16
      MAX_IMAGE_EDGE: 1280
      MAX_FRAME_BYTES: 524288
```

Apply configuration changes with `docker compose up -d`. Export active drawings
first: recreating the container ends sessions and clears remembered access.

## Streaming and audience size

`FRAME_RATE` controls update frequency. At 16 fps, the capture interval is
62.5 ms. Encoding counts toward that interval; the publisher keeps one active
encoder and the newest pending view rather than building a backlog. Viewers
paint completed frames and then decode their newest pending frame.

`MAX_IMAGE_EDGE` controls transmitted detail. The viewer fits that image to its
window while preserving the aspect ratio; fullscreen increases available space
without changing transmitted resolution. Raising the edge limit increases
encoding work and bandwidth.

Choose audience limits to match your connection. Complete images are sent to
each viewer: a 100 KiB image at 10 fps for 25 viewers uses about 24 MiB/s before
protocol overhead. Idle artwork generates no periodic capture calls.

## Runtime and operations

The container uses a digest-pinned Distroless Node.js 24 runtime, UID/GID 1000,
and contains no shell, npm or build tools. Compose applies a read-only
filesystem, drops Linux capabilities, prevents privilege escalation, enables
an init process and limits memory/swap to 256 MiB, CPU to one core and processes
to 64.

`GET /health` reports process availability. The relay uses a five-second socket
authentication deadline, a 3 MiB outgoing queue limit and 60 session/sign-in
attempts per minute per client in separate buckets for password failures,
successful sign-ins, session creation and authenticated WebSocket upgrades.
Failed anonymous requests do not consume authenticated session or reconnect
budgets.

For a reverse proxy, set `TRUSTED_PROXY_ADDRESSES` to the exact peer IP addresses
seen by the app and configure the proxy to overwrite `X-Real-IP` with its socket
peer address. Caddy's example above does this using `{remote_host}`; it does not
trust a visitor's forwarded headers. A host proxy reaching Docker often appears
as the container network's gateway, rather than host loopback. Identify that
address from your network configuration. Never allow every private address or
use an unrestricted trust setting. Missing or malformed metadata from a trusted
proxy is rejected. Forwarded headers from other peers are ignored.

Sessions and the latest shared image live in memory. Stop, expiry, restart and
rollback discard them. Export locally before closing or reloading the presenter.
Back up operator configuration and credentials separately from drawings.

Use [Testing](TESTING.md) to check local builds and deployed HTTPS/WSS delivery,
and [GitHub Actions](ACTIONS.md) for automated verification and deployment.
