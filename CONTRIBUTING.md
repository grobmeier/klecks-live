# Contributing

Live Draw keeps the drawing engine in Klecks. The companion handles session
access, viewport capture, streaming limits and the audience page. Keep changes
to the viewport API independent of the relay and session protocol.

## Development setup

Install Node.js 22 or newer, npm and Git:

```sh
npm ci
npm run prepare:klecks
npm run build
npm run check
npm test
npm start
```

Open `http://127.0.0.1:5055`. Use separate presenter and viewer windows with the
presenter visible while drawing.

Preparation fetches the exact public revision in `upstream.json`, applies the
patches and stages it in `.build/klecks`. To use an existing checkout containing
that commit:

```sh
npm run prepare:klecks -- --from /path/to/klecks
```

Preparation archives the pinned Git commit, replaces only `.build/klecks` and
applies the explicit patches. It does not include uncommitted checkout changes.
The build runs icon, language and Parcel commands explicitly with npm lifecycle
hooks disabled.

## Check a change

Run syntax checks and tests after a build. Tests use loopback HTTP/WebSocket
connections and require permission to bind local sockets. Follow
[Testing](docs/TESTING.md) for coverage, container checks and HTTPS/WSS checks.

For interface changes, exercise the real editor and viewer at desktop, tablet
and narrow-screen sizes. Check drawing, viewport transforms, sharing, stop and
exports. Use neutral artwork and disposable viewer links.

Keep changes focused. Describe the resulting behaviour and the checks you ran.
Keep generated assets, local credentials, drawings and infrastructure out of
source submissions. Use synthetic fixtures and example hostnames; never log
passwords, authentication messages, cookies or complete viewer links.

## Klecks viewport API

`patches/klecks-viewport.patch` adds:

- `ProjectViewport.subscribeViewport(listener)`, forwarded through Easel, KlApp,
  Embed and the lazy EmbedWrapper.
- An opt-in `enableCanvasResize` embed setting for the existing crop, resize and
  rotate controls.

The observer supplies `{ canvas, width, height, transform }` after rendering.
The canvas is a borrowed mutable surface owned by Klecks. Copy it for capture;
do not modify it or retain assumptions about its pixels after the callback.
The transform represents the actual rendered view, including animation.

Subscriptions can be created before lazy loading finishes. Call the returned
unsubscribe function when finished. With no subscribers, Klecks performs no
capture encoding or network work. Live capture observes rendering rather than
history entries so strokes reach viewers before pointer release.

The observer is suitable for an upstream contribution on its own. Keep
transport, authentication and audience UI changes in the companion.

## Update the upstream pin

1. Start from the new public Klecks revision in a clean checkout.
2. Apply or adapt the viewport integration and save its focused diff in
   `patches/klecks-viewport.patch`.
3. Update `upstream.json` and prepare the source again.
4. Build both the embedded and standalone Klecks entry points.
5. Run the companion checks, container checks and dependency audits.

`npm run build` builds the embed. After it has prepared icons and languages,
build the standalone entry point with:

```sh
npm --prefix .build/klecks run build
```

Keep `patches/klecks-build-security.patch` separate from the viewport API patch.
Its dependency overrides and the exact audit exception are documented in
[Security](docs/SECURITY.md). Review them when changing the upstream pin or
build inputs. [GitHub Actions](docs/ACTIONS.md) runs the final-image security
scan and deployment checks.

## Licences

Preserve the companion's MIT licence, Klecks' copyright and MIT terms, and the
library and font notices included by upstream. The built editor exposes its
licence and **Settings → Licenses** dialog. See the
[README attribution](README.md#licence-and-attribution) for distribution details.
