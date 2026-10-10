# Guarded GitHub Actions deployment

Every main/feature/fix push and pull request runs verification on an isolated
GitHub-hosted Ubuntu runner. Deployment is a separate manual choice, accepted
only for `main`. It requires the `online-test` environment and its dedicated
SSH key. No self-hosted runner, general administrator SSH key or long-lived
registry token is required.

The pipeline checks syntax and runtime advisories, builds the pinned editor
and exact Linux image, runs the integration and hardened-container tests, and
scans the final image with a checksum-pinned Trivy release. HIGH/CRITICAL image
findings fail the workflow, including findings without a vendor fix. The
editor build has one explicit exception documented in [SECURITY.md](SECURITY.md).

Only a successful manual run uploads its exact tested image for the deployment
job. That job publishes the private GHCR package with its temporary repository
token and sends an immutable digest plus full Git revision to the confined
server receiver. Its temporary registry token goes over SSH stdin, never a
command argument. The receiver verifies the image label and platform, starts
only Live Draw, checks private readiness and rolls back on failure. It removes
temporary registry authentication. The presenter password stays on the server.

Actions are pinned to full commits with minimal job permissions, following
[GitHub's secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use).
Dependency updates are proposed weekly through Dependabot. Review and verify
them; they cannot deploy on a push.

## First activation

The infrastructure receiver and scoped installer are maintained in the private
Aegis infrastructure repository. The operator must inspect the target read-only
and approve provisioning before installing them. Use a new Ed25519 deployment
key, protect its private half locally, and put only that key in the environment
secret `LIVE_DRAW_SSH_KEY`. Register these environment variables:

| Variable | Value |
| --- | --- |
| `LIVE_DRAW_HOST` | Confirmed server hostname or address |
| `LIVE_DRAW_SSH_USER` | `klecks-live-deploy` |
| `LIVE_DRAW_KNOWN_HOSTS` | Server host-key entry verified through the existing administrator connection |

Require environment review if the account's GitHub plan supports it. Manual
dispatch on main remains required regardless. Keep the repository and its new
GHCR package private; verify package visibility after first publication.

1. Install the confined receiver without activating the public route. This
   generates a new server-only presenter password and preserves it on repeat
   installation. It does not start an empty image or modify other services.
2. Merge the verified workflow into main and choose **Run workflow**, with
   **deploy** enabled. The first receiver run checks local private readiness;
   its result explicitly reports that public verification is still pending.
3. Activate only the new Caddy route after the first image is healthy. Validate
   the entire proxy configuration before reload and wait for trusted HTTPS.
   Run the authenticated HTTPS/WSS smoke inside the runtime container. No
   presenter password is sent to GitHub.
4. Mark the route active. All subsequent deployments must pass the public
   HTTPS/WSS check as well as local readiness, or restore the previous image.
5. Open the public sign-in page on the iPad. Obtain the generated presenter
   password through the operator's private channel, then test a disposable
   drawing and a viewer link on another device.

For the Aegis pilot, the reviewed policy uses a loopback-only port, two sessions,
ten viewers per session, eight frames per second, a 1280-pixel maximum edge and
512 KiB image limit. It has no database or persistent drawing volume. Existing
service/secrets Borg roots cover operator configuration and deployment receipts;
live drawings must be exported separately.

## Later deployment and rollback

Export active drawings before running a deployment or rollback. Restart clears
all live sessions and remembered-device logins. The previous digest remains
available for rollback; this does not recover the in-memory drawing session.

The server's status command reports the running identity and local restrictions
without creating a session. Its rollback command can restore only the previous
image from this repository. A deploy key permits these three receiver commands
and has no shell, forwarding or general Docker access.

After every change, confirm the Actions result, server image digest/revision,
private sign-in and direct-asset denial, trusted HTTPS/WSS delivery and viewer
permissions. A workflow result alone does not establish iPad acceptance.
