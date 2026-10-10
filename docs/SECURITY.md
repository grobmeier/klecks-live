# Online pilot security review

Review date: 10 October 2026. This is a bounded private pilot assessment, not a
penetration-test certificate or a guarantee against all attacks.

## Access and data boundaries

- Editor downloads and session creation require a random operator password or
  its separate protected device cookie. The online policy requires private mode.
- HTTPS cookies are host-only, Secure, HttpOnly and SameSite=Strict. Exact-origin
  checks protect mutations and WebSocket upgrades. TLS certificate verification
  is required, including in operator smoke checks.
- Viewer capabilities never grant drawing or presenter control. Anyone holding
  a viewer link can watch until stop/expiry; share links only with intended
  viewers. There is no attendee identity verification.
- Only the latest bounded image stays in relay memory. There is no recording,
  autosave or server project store. A viewer can still save or screenshot pixels
  already received. Export drawings before reload or deployment.
- Frame size/rate, sessions, viewers, unauthenticated connections, outgoing
  queues and authentication attempts are bounded. These are resource controls,
  not a DDoS protection service. Behind Caddy, the existing authentication budget
  is shared by the proxy's address; the pilot must stay within that limit.
- The proxy omits password headers, cookies and authorization from access logs.
  Capabilities in link fragments never enter HTTP request URLs. Log rotation
  and host resource limits protect the other services.

The Internet-facing app has no Docker socket, host mounts, shell, npm or build
tools. It runs as UID/GID 1000 with a read-only filesystem, no Linux capabilities,
no privilege escalation and explicit CPU/memory/process budgets. The public
proxy alone exposes HTTPS; the app port binds to host loopback.

## Dependency and image gates

The relay's pinned `ws` dependency has no reported npm advisories in this review.
The editor pin has two patched build-package overrides: `brace-expansion` 2.1.7
and `source-map-js` 1.2.2. These live in a separate build-security patch so the
generic upstream viewport proposal remains independent.

One remaining unpatched advisory,
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), propagates
from `braces` through `micromatch` and `@parcel/watcher`. They are Parcel/Sass
build dependencies, process fixed trusted source, and are absent from the browser
import graph and final image. `scripts/audit-klecks.mjs` permits only this exact
advisory and these package names; new high/critical build findings fail the build.
Keep the build isolated and lifecycle hooks disabled. Review this exception when
updating upstream, accepting new build inputs or when a patch becomes available.

The original Debian runtime failed the image gate with vulnerable utility and
npm packages. The replacement uses a digest-pinned
[Distroless Node runtime](https://github.com/GoogleContainerTools/distroless),
with only the application dependency tree copied in. The current local runtime
scan reports zero HIGH/CRITICAL findings. CI must repeat the scan for Linux AMD64
and for every candidate; vulnerability data can change after a successful run.
The gate does not ignore unfixed image advisories. Lower-severity advisories and
scanner coverage limits remain part of ongoing review.

## Deployment boundary

Only manual main dispatch may publish/deploy the exact tested image. Verification
jobs have no deployment secret or package-write permission. The deploy job uses
short-lived repository registry authentication and a dedicated, host-key-pinned
SSH identity. The root-owned receiver accepts only a digest from this package,
a matching commit label, status or rollback. It never invokes a shell, accepts
arbitrary Compose content or executes commands for another service.

Deployment secrets are root-only on the operator host. The receiver's temporary
registry credentials are confined to `/run` and removed after pulling; GitHub
does not receive the presenter password. Failed readiness restores only this
service's previous digest, or removes the failed first deployment. Session data
cannot survive a restart or rollback.

## Validation and remaining acceptance

Local syntax, 54 app tests, hardened Linux container checks and isolated trusted
HTTPS/WSS checks passed. Tests include rejected-password retry, cookie expiry and
revocation, encoded asset paths, forged capabilities, frame/queue budgets,
late viewers, role restrictions and stop. Hostile TLS upgrade/reset checks found
and fixed an unhandled socket error that could crash the relay.

The Aegis receiver has eight tests covering command injection, image-identity
mismatch, rollback, first-install failure, temporary credentials and status.
Shell/Ansible syntax and the route in the target Caddy version pass locally.
GitHub-hosted verification, first live deployment, public HTTPS/WSS acceptance
and physical iPad/Pencil endurance remain distinct gates until recorded as passed.

For this pilot, use disposable, non-sensitive drawings. Physical Safari sign-in,
remember/forget, actual Pencil latency and 30-minute endurance remain in
[ACCEPTANCE.md](ACCEPTANCE.md). Do not describe synthetic viewer limits as measured
production capacity.
