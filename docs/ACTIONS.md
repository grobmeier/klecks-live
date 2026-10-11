# GitHub Actions

The workflow in `.github/workflows/pipeline.yml` verifies pushes to `main`,
`feature/**` and `bugfix/**`, and all pull requests. Deployment runs only through
manual dispatch on `main` with **deploy** enabled.

## Verification

The GitHub-hosted Ubuntu job:

1. Installs the companion's locked dependencies with lifecycle hooks disabled.
2. Checks JavaScript syntax and audits runtime dependencies.
3. Builds the pinned Klecks editor and a Linux AMD64 container image.
4. Extracts its built assets and runs the application tests.
5. Runs the hardened-container smoke test against that image.
6. Scans the image with a checksum-pinned Trivy release.

HIGH and CRITICAL image findings fail verification, including findings without
a vendor fix. The editor's build-only advisory exception is documented in
[Security](SECURITY.md). The security report is retained as a workflow artifact
for 14 days.

Actions use pinned commit revisions and job-specific permissions. Verification
has no deployment secret or package-write permission. Dependabot proposes
weekly updates; dependency pushes run verification without deploying.

## Deployment configuration

The `online-test` GitHub environment holds the dedicated deployment SSH key and
server connection settings:

| Type | Name | Value |
| --- | --- | --- |
| Secret | `LIVE_DRAW_SSH_KEY` | Private key for the confined deployment account |
| Variable | `LIVE_DRAW_HOST` | Server hostname or address |
| Variable | `LIVE_DRAW_SSH_USER` | `klecks-live-deploy` |
| Variable | `LIVE_DRAW_KNOWN_HOSTS` | Independently verified server host-key entry |

Restrict the environment to `main` and configure reviewers to suit your release
policy. Pin the host key before adding it to the environment; SSH requires a
matching key and rejects unknown hosts.

The supplied publication step targets `grobmeier/klecks-live` and
`ghcr.io/grobmeier/klecks-live`. A fork must update the repository guards, registry
prefix and Docker source label together with the server receiver's allowlist.
Set repository and package visibility according to your distribution policy.

## Server receiver

The workflow requires a confined SSH receiver provisioned by the operator.
The receiver is maintained separately from this application repository. It
accepts only:

- `deploy <sha256-digest> <full-git-revision>`
- `status`
- `rollback`

The deployment identity has no interactive shell, forwarding or general Docker
access. The receiver accepts images only from the configured package, verifies
the Linux AMD64 platform and revision label, and updates only Live Draw.
Presenter credentials and Compose configuration stay on the server.

Provision the receiver and loopback service port before activating the HTTPS
route. Establish local private-editor readiness, configure the proxy, then
enable public HTTPS/WSS checks for subsequent deployments. Those checks cover
sign-in, protected assets, live frame delivery and viewer permissions.

## Deploy a revision

Export active drawings before deployment. A restart ends sessions and clears
remembered-device access.

In GitHub, open **Actions → Verify and deploy Live Draw → Run workflow**.
Select `main` and enable **deploy**. From the command line:

```sh
gh workflow run pipeline.yml --ref main -f deploy=true
```

A successful verification job passes its exact tested image to deployment as
an artifact retained for one day. Deployment publishes it to GHCR using the
short-lived repository token and sends the immutable digest and Git revision
to the receiver. Registry authentication travels over SSH stdin and is removed
from the server after the pull. The presenter password never goes to GitHub.

## Verify and roll back

Confirm the Actions result and compare the receiver's reported revision and
image digest with the deployed revision. Check trusted HTTPS, presenter sign-in,
protected editor assets and read-only viewer delivery using the
[online smoke check](TESTING.md#deployed-httpswss).

Failed readiness restores the previous image, or removes a failed first
installation. The receiver also provides explicit rollback to its retained
previous digest. Rollback restores application code; sessions and device
logins must be created again.
