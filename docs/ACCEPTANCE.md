# Acceptance and validation

Local and synthetic checks establish the implementation's behaviour. They do
not establish iPad Safari/Apple Pencil performance, Internet latency or
production capacity. Keep these evidence layers separate when reporting results.

## Automated coverage

`npm run check` validates JavaScript syntax. `npm test` checks the binary protocol,
image metadata, bounded capture with a latest pending frame, capture disposal,
static asset routes, origin and host-key checks, capabilities, duplicate
presenters, viewer permissions, late joins, reconnect epochs, pause/resume,
stop, absolute expiry, presenter grace, authentication timeout, excessive payloads,
frame-rate bounds, restart invalidation, a 25-viewer synthetic group and an
intentionally stalled reader. These are local connections with synthetic pixels.

Presenter script fixtures also check rejected-key correction, whitespace handling,
duplicate-submit prevention, retry after network failure and session startup
when browser storage is unavailable. These exercise the actual event handlers
against synthetic DOM elements, separately from real-browser acceptance.

Device-login tests use real HTTP requests to check protected cookie attributes,
one-click session creation, expiry, revocation, restart invalidation, limits,
duplicate/forged cookies and origin/rate enforcement. Presenter fixtures cover
remembering, later starts, expired access, blocked cookies, forget failures and
editor readiness arriving during access initialization.

Private-editor tests use actual companion HTML/scripts with synthetic bundle
fixtures to check sign-in-only entry points, direct/encoded/HEAD asset denial,
authenticated loading, unknown-asset protection, expiry, revocation, public mode
and viewer-token isolation. Sign-in event-handler fixtures cover password retry,
remembering, duplicate-submit prevention, blocked cookies and network failures.
The HTTPS smoke check then loads the actual packaged Klecks embed after sign-in.

`npm run test:container` checks a locally built image under the documented
non-root, read-only, capability and memory restrictions. It validates packaged
assets and the viewport API, host-key protection, real WebSocket frame delivery,
late joins, viewer permissions, session invalidation, Docker health and graceful
shutdown. It uses synthetic pixels over loopback HTTP and removes its temporary
container afterwards.

`npm run test:lan` checks the prepared Mac HTTPS test server with explicit trust
for its generated CA, including normal certificate and hostname verification,
HTTPS assets, host-key/origin checks, WSS frames, late joins and viewer roles.
It does not modify OS trust or establish that an iPad can reach the server.
It also checks device sign-in, protected cookie issuance, password-free session
creation and server-side revocation. `npm run test:lan -- --isolated` uses the
new source and staged editor assets in a temporary loopback HTTPS server; it
does not restart the active LAN server or replace its served files.

## Browser checklist

Use separate presenter and viewer tabs, then a second viewer with a different
aspect ratio. Use disposable drawings and session links.

- Start with sharing off, then start a session, copy/open its link and check the
  viewer count. Draw black ink on the white initial paper.
- On a password-protected server, sign in with **Remember this device**, stop,
  and start again without a password. Close/reopen the browser and repeat without
  reloading a drawing you need to preserve. Stop, forget the device, and verify
  that starting asks for the password again. Test unchecked remembering and a
  rejected password. Restart should clear device access; expiry must return to
  the password dialog without reloading the editor.
- In private mode, a new unauthenticated browser must see sign-in before any
  drawing tools load. A valid viewer link must still open read-only without
  presenter sign-in. After forgetting or expiry, refreshing the presenter must
  return to sign-in; export drawings first. Explicit public mode must allow local
  drawing while preserving the broadcast password requirement.
- Hold the drawing pointer and confirm a changed image reaches the viewer
  before release. Confirm the final changed image arrives afterwards.
- Pan, zoom, rotate and mirror the presenter view. Compare the actual visible
  canvas crop to the letterboxed viewer, including animation progress.
- Resize the presenter viewport; repeat at iPad portrait and landscape sizes.
- Apply undo, redo, erasing, layer visibility and opacity, a filter, a canvas
  resize and a selection transform. Check the applied artwork, with no dialog,
  toolbars, cursor or selection handles in the shared image.
- Join a late viewer and reload a viewer; it should receive the current image.
- Disconnect and reconnect the presenter within grace. Viewers should show
  paused/waiting until fresh pixels arrive, then Live.
- Hide and return to the presenter; sharing pauses and recovers with a fresh
  image and monotonic sequence in the current connection.
- Stop and confirm the viewer clears the image and shows Session ended. Test
  expired, unavailable and capacity states, and relay restart.
- Export PNG and PSD locally and inspect the resulting files. Drawing should
  remain available after stopping sharing.

## Physical iPad gate

Record device model, iPadOS/Safari versions, Pencil model, relay/proxy versions,
network topology and actual capture settings. Use a trusted HTTPS origin.

Run a continuous 30-minute session with ordinary handwriting, annotations,
zoom/pan and erasing. Confirm touch controls in both orientations, readable ink,
no visible Pencil degradation, background/screen-lock recovery and successful
exports. Observe device heat, memory behaviour and reconnect states. Measure
end-to-end latency with a recorded presenter/viewer pair; target median below
300 ms on a healthy local network. Record the measured distribution and test
conditions rather than reporting the target as a result.

Physical iPad acceptance is pending. No public deployment or upstream acceptance
is implied by the local implementation.

## Evidence recorded on 9 October 2026

| Check | Result |
| --- | --- |
| Patched standalone Klecks build | Passed |
| Clean pinned-source preparation and patched embed build | Passed |
| Companion syntax and automated tests | 22 passed, using local HTTP/WebSocket connections |
| Live ink before pointer-up | Passed with a real drawing drag; temporary DOM pointer-event instrumentation confirmed the pointer was still down when the viewer changed; the screenshot contains visible ink |
| Following the presenter | Pan, zoom, rotation and mirroring passed; portrait 768×1024 and landscape 1024×768 layouts were checked with a viewer of a different aspect ratio |
| Applied edits | Undo/redo, erasing, layer visibility and opacity, invert filter, canvas resize, layer transform and selection move passed |
| Viewer recovery and stop | Late join and viewer reload passed; explicit stop and relay restart cleared the viewer and showed Session ended |
| Relay recovery and limits | Presenter epoch recovery, pause/resume, expiry, grace, capabilities, rate/payload limits, stalled-reader queues and a 25-viewer group passed automated checks |
| PNG and PSD exports | Downloaded files had original 1600×1000 dimensions; PSD had the expected 8BPS signature |
| Docker image build and container runtime | Previous image passed clean pinned-source/Linux embed build and the hardened runtime smoke test; its temporary test container was removed. The latest rebuild after adding the HTTPS server adapter encountered a Docker EOF and repeated RPC timeouts; the task-owned rebuild was cancelled. Repeat current-source image build and runtime checks when Docker is responsive |
| Local Mac HTTPS/WSS setup | Passed: seven-day test CA/profile generated; actual HTTPS certificate chain and hostname verification, packaged editor, host-key/origin checks, WSS frames, late joins and viewer permissions passed; generated secrets are outside source packages; iPad installation and reachability remain pending |
| iPad Safari, Pencil, latency and 30-minute endurance | Pending physical-device acceptance |

The browser tests used the Codex in-app browser. Its log reported an unattributed
MutationObserver error during iframe initialisation; drawing and the tested
controls continued to work. Check the actual Safari console during device
acceptance. Presenter network-loss recovery is covered by the relay tests;
Safari background/screen-lock recovery remains part of the physical-device gate.

Temporary pointer instrumentation was applied only to an ignored generated
editor bundle and removed afterwards. Review screenshots contain only synthetic
drawings and are kept outside the source package.

## Session-start fix on 10 October 2026

The running HTTPS relay accepted the generated local host key and delivered
frames to authenticated viewers and late joins. A reported `Host access key
required` message identifies a rejected key. The presenter now explains that
the key already exists, keeps rejected attempts in the dialog, trims pasted
whitespace, prevents duplicate submissions and tolerates unavailable browser
storage. The served presenter files were updated without a relay restart.

All 25 automated tests and the HTTPS/WSS smoke check passed. Direct inspection
of the user's HTTPS tab was rejected by the browser URL policy, so actual user
retry and device acceptance remain pending. Existing drawings should be exported
before any refresh, which reloads the embedded project.

## Presenter device access on 10 October 2026

The agreed presenter-login flow is implemented: an existing presenter password,
unchecked **Remember this device**, one-click later starts and **Forget this
device** after stopping sharing. Device credentials use separate protected
cookies and hashed, bounded in-memory authorizations. Restart invalidates them.
QR pairing and durable authorizations are deferred.

All 40 automated tests and JavaScript syntax checks passed. An isolated server
using the actual prepared TLS certificate passed certificate/hostname checks,
Secure/HttpOnly/SameSite cookie issuance, password-free session creation,
server-side revocation, WSS frames, viewer permissions, late joins and stop.
After explicit approval, the served presenter assets were updated and the LAN
relay was restarted. The running server passed the same HTTPS/WSS checks,
including the new dialog controls, presenter access, revocation and viewer
delivery. Real-browser device-login and physical iPad acceptance remain pending.

## Private editor access on 10 October 2026

The agreed `EDITOR_ACCESS=private|public` setting is implemented. A configured
presenter password defaults the editor to private; keyless loopback remains
public. Private mode uses a lightweight sign-in page and server-side protection
for editor HTML, scripts and bundles. Viewer pages, their required assets and
licence notices remain public, with live images protected by viewer capabilities.

All 53 tests and syntax checks passed, including the native password-form POST
safeguard when JavaScript is unavailable. An isolated HTTPS/WSS check passed private
entry and asset gating, authenticated loading of the actual Klecks embed,
remembered access and revocation, unauthenticated read-only viewer delivery,
late joins and stop. Private mode is now active on the local LAN relay. Checks
against that running server also passed sign-in-only entry, editor-bundle denial,
authenticated editor loading, revocation, read-only viewer delivery and stop.
Real-browser sign-in and physical iPad acceptance remain separate open gates.

## Online deployment preparation on 10 October 2026

The current-source Linux container build and hardened runtime checks passed,
including explicit CPU/process/swap bounds. The final image uses a pinned
Distroless Node 24 runtime. Its local Trivy scan reports zero HIGH/CRITICAL
findings, with no blanket ignore of unfixed advisories. The runtime npm audit is
clean. Two editor build-package issues are patched; one remaining build-only
advisory is explicitly reviewed in `SECURITY.md`.

An isolated trusted HTTPS/WSS check of the new online smoke script passed.
Hostile TLS upgrade/reset testing found and fixed an unhandled socket error;
all 54 app tests pass. The Aegis receiver's eight tests, Ansible/shell syntax and
Caddy 2.11.4 route validation pass. GitHub-hosted AMD64 verification, actual
public deployment and physical iPad acceptance must be recorded separately.
