# Testing

## Application checks

Build the editor once, then run:

```sh
npm run check
npm test
```

The syntax check covers JavaScript in `server`, `public`, `scripts` and `test`.
The test suite uses loopback HTTP/WebSocket connections, synthetic pixels and
controlled browser fixtures. It covers:

- Frame format, image metadata, sequence numbers and connection epochs.
- Capture scheduling, one active encoder and the newest pending frame.
- Viewer decoding, painting, stale-frame disposal and session end.
- Presenter sign-in, cookies, expiry, revocation, origin checks and asset access.
- Viewer permissions, late joins, reconnects, pause/resume and stop.
- Session, authentication, payload, frame-rate and queued-output limits.
- Presenter controls, hiding, status updates, menu dismissal and PSD export.

Tests use built assets from `dist` for integration checks. Build first as shown
in [Contributing](../CONTRIBUTING.md#development-setup).

## Container checks

With Docker running:

```sh
docker build -t klecks-live:local .
npm run test:container
```

To check another image:

```sh
npm run test:container -- your-image:tag
```

The smoke script creates a uniquely named non-root container on a temporary
loopback port with the same read-only filesystem, capability and resource
limits as Compose. It generates its own presenter password, checks packaged
assets, frame delivery, late joins, viewer permissions, session invalidation,
Docker health and graceful shutdown, then removes that container.

## Local HTTPS/WSS

Prepare and start the [local HTTPS setup](LOCAL_HTTPS.md), then run:

```sh
npm run test:lan
```

The check trusts the generated public CA for its own connections and validates
the certificate chain and hostname. It checks editor access, cookie issuance,
session creation, WSS frames, late joins, viewer roles, stop and revocation.

To check the current source in an isolated loopback HTTPS server without
restarting the running LAN server:

```sh
npm run test:lan -- --isolated
```

These scripts leave system certificate trust unchanged and do not print
passwords or capabilities.

## Deployed HTTPS/WSS

The online smoke script checks a private-editor deployment using trusted HTTPS
and the configured external origin. Run it inside the operator-managed container
so the presenter password stays in its existing environment:

```sh
docker compose exec -T live-draw /nodejs/bin/node scripts/smoke-online.mjs
```

It checks anonymous editor/session denial, wrong-origin rejection, protected
cookies, the packaged editor, live WSS pixels, late viewers, viewer role
isolation, stop and device revocation. Its disposable session and device login
are cleaned up after the check.

For an external check without a presenter password:

```sh
PUBLIC_ORIGIN=https://draw.example.org node scripts/smoke-online.mjs --anonymous-only
```

Use the server's real origin. Certificate validation remains enabled.

## Browser checks

Use the real embedded editor with neutral artwork, a presenter window and a
separate viewer window. Check ink while the pointer is held down, viewport
transforms, applied edits, late joins and stop. Check controls at desktop,
tablet and narrow-screen sizes, including Hide/Show, keyboard focus and exports.
Keep the presenter visible while drawing.

PNG downloads should retain the original dimensions. PSD downloads should
retain dimensions and layers. Test changes affecting the Klecks integration
with both its standalone and embedded entry points.

[GitHub Actions](ACTIONS.md) runs syntax, audits, application tests, hardened
container checks and the final-image scan for every supported push and pull
request. A manual deployment also checks the running service through its
confined receiver.
