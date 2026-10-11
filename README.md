# Live Draw with Klecks

Draw on your iPad or computer and share a live view with anyone in a browser.
Live Draw combines the [Klecks](https://github.com/bitbof/klecks) drawing editor
with a presenter mode and a read-only audience view.

Viewers follow your ink as you draw, along with zoom, pan, rotation, mirroring
and applied edits. They see the drawing area without editor controls. Use it for
lessons, demonstrations, workshops or a shared viewer window in a video meeting.

## Features

- Klecks drawing tools, layers, filters, undo and redo.
- A viewer link for each session, with no viewer account or installation.
- A compact sharing bar with live status, viewer count and optional hiding.
- An audience view that fits the browser window and supports fullscreen.
- Presenter sign-in, remembered devices and configurable editor access.
- Local PNG and layered PSD exports.
- Self-hosting with Docker, HTTPS and configurable streaming limits.

## Run locally

Install Node.js 22 or newer, npm and Git, then run:

```sh
npm ci
npm run prepare:klecks
npm run build
npm start
```

Open **http://127.0.0.1:5055**, choose **Start live**, and use **Copy link** to open
the audience view in a separate browser window. Keep the presenter visible
while drawing; capture pauses when its page is in the background.

Local startup listens on loopback. To connect an iPad or another computer, use
[self-hosting with HTTPS](docs/DEPLOYMENT.md) or the
[local HTTPS setup](docs/LOCAL_HTTPS.md).

## Present and share

On a password-protected server, sign in with the **Presenter password** supplied
by the operator. Choose **Remember this device** on your own device to reuse
access on later visits. Viewers need only the copied viewer link.

**Hide** gives the editor the full window height. A floating **Show** button
keeps live status and the viewer count visible, and restores the sharing bar.
Use **Stop** to end the session and invalidate its viewer link.

Save a PNG through **Export** inside Klecks and confirm **Submit** in its dialog.
Use **More → Export PSD** to save layers. Drawings stay in your browser; export
before reloading or closing the presenter. The server keeps the latest shared
image in memory and discards it when the session ends or the server restarts.

See the [presenter guide](docs/PRESENTER.md) for iPad use, sharing controls,
exports and reconnecting.

## Self-host and contribute

The relay runs without a database or drawing volume. Docker Compose serves it
on host loopback behind an HTTPS reverse proxy. A configured presenter password
makes the editor private by default; `EDITOR_ACCESS=public` allows local drawing
without sign-in while keeping broadcasts password-protected.

- [Self-hosting](docs/DEPLOYMENT.md): Docker, HTTPS, access and streaming settings.
- [GitHub Actions](docs/ACTIONS.md): verification, image publication and deployment.
- [Security](docs/SECURITY.md): authentication, resource limits and dependency checks.
- [Contributing](CONTRIBUTING.md): development setup and the Klecks integration.

The build uses the exact Klecks revision in `upstream.json` and the patches in
`patches/`. The drawing engine stays in Klecks; Live Draw handles capture,
sessions, transport and the audience view. Its viewport observer is independent
of the relay and can be used by other integrations.

## Licence and attribution

Live Draw is an independently maintained companion, licensed under
[MIT](LICENSE). Klecks is created by bitbof and retains its
[MIT licence and copyright](UPSTREAM_LICENSE). Live Draw is not an official
Kleki service.

The built editor includes Klecks' licence at `/klecks/LICENSE`. Its library and
font notices are available in **Settings → Licenses** and in the pinned upstream
source. The `ws` runtime dependency includes its MIT licence. Preserve these
notices when distributing source or built assets.
