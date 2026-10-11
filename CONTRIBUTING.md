# Contributing

Keep the drawing engine in Klecks. The companion owns session access, transport,
capture budgets and the audience view. Changes to the generic viewport API
should remain reviewable without the server or browser session code.

## Development checks

```sh
npm ci
npm run prepare:klecks
npm run build
npm run check
npm test
```

`npm test` uses real local HTTP and WebSocket connections with synthetic pixels,
plus bounded-encoder tests. It requires permission to bind loopback sockets.
Browser acceptance exercises the real embedded drawing tools; see the checklist
in `docs/ACCEPTANCE.md`. Run both standalone and embedded Klecks builds when
changing the upstream integration. The companion scripts deliberately suppress
npm lifecycle hooks; its explicit icon, language and Parcel build commands
prepare upstream assets.

Validate container packaging with Docker running:

```sh
docker build -t klecks-live:local .
npm run test:container
```

The smoke test creates a uniquely named, non-root container on a temporary
loopback port with the same read-only filesystem, capability and memory limits
as Compose. It generates its own access key, checks packaged assets, live frame
delivery, late joins, viewer permissions, session invalidation, Docker health
and graceful shutdown, then removes only that container. An optional image tag
can be passed with `npm run test:container -- your-image:tag`. This local HTTP
test does not establish HTTPS proxy or physical iPad behaviour.

For the local HTTPS/iPad test helper, follow [LOCAL_HTTPS.md](docs/LOCAL_HTTPS.md).
The relay accepts an optional server factory so this helper can use Node's
HTTPS server with the same HTTP routes and WebSocket checks. Container and
ordinary local startup retain the default HTTP server.

## Upstream patch

`upstream.json` pins the reviewed public commit. The patch adds:

1. `ProjectViewport.subscribeViewport(listener)` and forwarding methods through
   Easel, KlApp, Embed and the lazy EmbedWrapper. Subscribe before lazy loading
   completes if needed. Always call the returned unsubscribe function.
2. An opt-in `enableCanvasResize` embed parameter for the existing crop, resize
   and rotate filters. Existing embeds retain their default controls.

The callback supplies `{ canvas, width, height, transform }`. The canvas is a
borrowed mutable surface owned by Klecks: copy it when capturing; do not mutate
it or assume its pixels remain unchanged after the callback. The transform is
the actual rendered view, including animation progress. Capture is not driven
by history entries, because a stroke enters history only when it finishes.

To refresh the patch, start from the new public Klecks revision in a clean
checkout, apply or adapt the integration, and write its focused diff to the
patch file. Update `upstream.json`, run preparation from scratch, verify the
resulting API is present and rebuild both Klecks entry points. Do not copy
uncommitted checkout contents into the distributed editor: preparation archives
the pinned Git commit and then applies the explicit patch.

An upstream proposal can focus on the transport-independent observer first.
Acceptance by Klecks' maintainer has not been requested or assumed.

## Source boundaries

Do not include generated `dist`, `.build`, `node_modules`, local environment
files, capability links, access keys, workshop drawings, analysis graphs or
personal infrastructure in source submissions. Use synthetic fixtures and
neutral hostnames in examples. Do not log authentication payloads or full
viewer links. Preserve companion, Klecks, library and font licence notices.

The source preparation also applies a separate build-security patch with
patched dependency overrides; keep it independent of the upstream viewport
proposal. `node scripts/audit-klecks.mjs` checks the reviewed build-only advisory
exception. CI scans the final runtime image and blocks HIGH/CRITICAL findings.
See `docs/SECURITY.md` and `docs/ACTIONS.md` before modifying deployment controls.
