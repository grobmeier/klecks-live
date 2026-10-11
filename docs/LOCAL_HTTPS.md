# Local HTTPS on a Mac

Use the local HTTPS helper to connect an iPad and other browsers to Live Draw
on a trusted local network. It generates a seven-day certificate and presenter
password. For a public audience, use a domain with a trusted HTTPS certificate
as described in [Self-hosting](DEPLOYMENT.md).

## Prepare and run

Install Node.js 22 or newer, npm, Git and OpenSSL 3. Build the editor first:

```sh
npm ci
npm run prepare:klecks
npm run build
npm run prepare:lan
npm run start:lan
```

Preparation selects the Mac's private IPv4 address on `en0` when available.
To choose another assigned address and port:

```sh
npm run prepare:lan -- 192.168.1.20 8443
```

Use an address assigned to your Mac. The generated `.local-test/config.json`
records the URL, certificate name, fingerprint and expiry. The server listens
on that address. Keep the Mac awake and on the same network as the iPad.

The helper refuses to replace an existing `.local-test` directory. A changed
address or expired certificate requires a new setup; follow the cleanup steps
below before preparing it again.

## Connect an iPad

1. Transfer `.local-test/live-draw-test.mobileconfig` to your own iPad, for
   example through AirDrop, and open it.
2. Install the profile in **Settings → General → VPN & Device Management**.
   Check its name against the certificate name printed during preparation.
3. Enable full trust for that certificate in **Settings → General → About →
   Certificate Trust Settings**. See [Apple's certificate trust instructions](https://support.apple.com/en-us/102390).
4. Open the generated HTTPS URL in Safari. Resolve any certificate warning by
   checking the profile, trust setting, address and expiry.
5. Sign in with the **Presenter password** stored in `.local-test/host-key.txt`.
   Use **Start live** and **Copy link** to share with another device.

The profile contains only a public root certificate. Keep `server-key.pem` and
`host-key.txt` on the Mac; viewers need only the viewer link. The generated
files are excluded from Git, Docker and source packages, with private files
restricted to the current user. The CA signing key is deleted after signing.

## Connect a viewer

Every device connecting to this local server needs to trust its certificate.
For another iPad, repeat the profile and trust steps. For a Mac, import
`.local-test/live-draw-test-ca.cer` in Keychain Access and enable SSL trust for
that specific certificate.

Open the complete viewer link, including its `#` fragment. On one Mac, use
separate presenter and viewer windows and keep the presenter visible.

If another device cannot connect, check the Wi-Fi network, device-to-device
traffic and macOS permission for the Node.js server's inbound connections.
Allow the intended server through the firewall rather than disabling it.

The editor is private by default. To permit local drawing without sign-in:

```sh
EDITOR_ACCESS=public npm run start:lan
```

Broadcasting still requires the presenter password. The helper reads
`EDITOR_ACCESS`; its other streaming limits use the application defaults.

## Check the connection

With the server running, use another terminal:

```sh
npm run test:lan
```

This checks trusted HTTPS, hostname validation, editor access, protected cookies,
WSS frame delivery, late joins, viewer permissions and session stop. It trusts
the generated CA only for its own connections and leaves system trust unchanged.

## Remove the local setup

Export your drawings, then stop the server with Ctrl-C. Remove the **Live Draw iPad Test** profile from each iPad and remove the same certificate from any Mac
keychain where it was installed. Delete `.local-test` only after preserving
any other operator files you placed there. Preparing again generates a new
certificate and profile, which each connecting device must trust again.
