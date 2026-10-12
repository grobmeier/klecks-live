# Security

Live Draw separates presenter access from viewer access. The relay stores
sessions, device credentials and the latest shared image in memory.

## Presenter access

`HOST_ACCESS_KEY` is the operator-managed presenter password. Non-loopback
binding requires an explicit HTTPS origin and a password of at least 32
characters. Remote HTTP origins are rejected at startup, including behind a
loopback proxy listener. Browser clients refuse to transmit passwords and
session capabilities over remote HTTP.
Private editor mode also requires a password and protects editor HTML, scripts
and Klecks bundles before they are downloaded.

Sign-in exchanges the password for a separate 256-bit random device credential.
The relay retains its hash. Cookies are host-only, HttpOnly and SameSite=Strict;
HTTPS adds `Secure` and the `__Host-` prefix. Remembered access expires after
30 days, and browser-session access after eight hours. Restart clears all
credentials. Forgetting a device revokes only that browser's access.

HTTP mutations and WebSocket upgrades require the configured origin. Cookie
security uses `PUBLIC_ORIGIN`, including behind TLS termination, rather than
arbitrary forwarded headers. Network sign-in requires HTTPS. The browser does
not save the presenter password in local storage.

`EDITOR_ACCESS=public` allows editor downloads and local drawing without
sign-in, while session creation remains password-protected. Code already loaded
in a browser continues to run locally after access is revoked.

## Viewer access and drawing data

Each session has separate presenter and viewer capabilities. Presenter control
stays in the presenter's `sessionStorage`; the viewer link carries only its
viewer capability in the URL fragment. Fragments are absent from HTTP request
URLs. WebSocket upgrades carry the capability in `Sec-WebSocket-Protocol`,
which must be excluded from proxy logs. The relay validates it before accepting
the connection and binds the first authentication message to the same session
and role. Viewer sockets accept at most 2 KiB per incoming message; only valid
presenter capabilities unlock the frame-sized receive budget.

A viewer capability grants read-only access to that session. Anyone holding
the link can watch until stop or expiry; viewers do not have named accounts.
Share links with the intended audience and exclude capabilities, cookies and
passwords from logs.

The relay retains only the latest complete bounded image. It records no session
and stores no project. Stop, expiry and restart discard retained pixels.
Viewers can save or screenshot images they receive. Save drawings through the
presenter's local export controls before reload, restart or deployment.

## Resource controls

The relay bounds sessions, viewers, frame size, frame rate, unauthenticated
connections, queued output and authentication attempts. Startup validates
combined media budgets against declared and detected runtime memory limits.
Retained frames and unique queued payloads are accounted for globally, with
headroom for active reception and connection state. Each session reserves only
one presenter receive slot, including before its first authentication message. Sequence numbers and
connection epochs prevent stale frames replacing newer views. Slow viewers
are disconnected when their outgoing queue exceeds its budget.

Client limits use the socket peer address by default. Only exact configured
`TRUSTED_PROXY_ADDRESSES` may supply a single valid `X-Real-IP`; the proxy must
overwrite that header from its own peer address. Other forwarded headers are
ignored. Password failures, sign-ins, session creation and authenticated socket
upgrades have independent budgets. Anonymous failures cannot exhaust an
authorized client's session or reconnect budget. Keep the application port on
host loopback. Application budgets complement host and
network controls; they do not provide volumetric attack protection.

The supplied container runs as UID/GID 1000 without a shell, npm or build tools.
Compose sets a read-only filesystem, drops Linux capabilities, prevents
privilege escalation and limits CPU, memory, swap and process count. It mounts
no host directories or Docker socket. See [Self-hosting](DEPLOYMENT.md) for
configuration and proxy logging requirements.

## Dependencies and image checks

The Docker build pins the Klecks revision, npm lockfiles and container base
digests. CI audits runtime dependencies and scans the exact Linux AMD64 image
with Trivy. HIGH and CRITICAL image findings fail the workflow, including
findings without a vendor fix. Review the security artifact for lower-severity
findings and update dependencies as vulnerability data changes.

The separate `klecks-build-security.patch` overrides `brace-expansion` with
2.1.7 and `source-map-js` with 1.2.2 in the editor's build dependency tree.
It stays independent of the viewport API patch.

The build audit permits one exact advisory,
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), only for
`braces`, `micromatch` and `@parcel/watcher`. These Parcel/Sass dependencies
process trusted build source and are absent from the browser import graph and
final runtime image. `scripts/audit-klecks.mjs` rejects other HIGH or CRITICAL
build findings. Keep builds isolated and lifecycle hooks disabled; review the
exception when updating upstream, dependencies or build inputs.

The runtime uses a digest-pinned Distroless Node.js 24 image and contains only
the application and runtime dependency tree. Deployment uses the exact tested
and scanned image by immutable digest. Build-stage OS packages can change, so
source pins do not imply byte-identical images.

## Deployment access

Manual dispatch on `main` is required for publication and deployment. Verification
jobs cannot access deployment secrets or write packages. The deployment job uses
a short-lived registry token and a dedicated SSH key with a pinned host key.

The confined receiver checks the package allowlist, image platform and Git
revision label, then updates only Live Draw. It accepts deployment, status and
rollback commands without providing general shell or Docker access. Operator
secrets remain on the host; temporary registry credentials are removed after
pulling. Failed readiness restores the previous image.

See [GitHub Actions](ACTIONS.md) for provisioning and release operation, and
[Testing](TESTING.md) for access-control and deployment checks.

## Report a vulnerability

Report vulnerabilities privately using the contact details on the
[maintainer's GitHub profile](https://github.com/grobmeier). Include the affected
revision, configuration and a minimal reproduction with synthetic data. Keep
passwords, device credentials, viewer links and real drawings out of reports.
Public issues are for reports that do not expose exploitable security details.
