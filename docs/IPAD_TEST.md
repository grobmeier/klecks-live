# iPad test on a local Mac

This setup is for physical-device acceptance on a trusted local network. It
uses a seven-day test certificate and an operator key, without changing system
certificate trust automatically. For ordinary audience use, prefer a domain
with a publicly trusted HTTPS certificate as described in
[DEPLOYMENT.md](DEPLOYMENT.md).

## Prepare and run

Build the editor first. With Node.js 22 or newer and OpenSSL 3 available:

```sh
npm run prepare:lan
npm run start:lan
```

Preparation selects the Mac's private IPv4 address on `en0` when available.
To choose another assigned interface or port explicitly:

```sh
npm run prepare:lan -- 192.168.1.20 8443
```

The address and port in this example are placeholders. Preparation refuses to
replace an existing `.local-test` directory. The generated config records the
actual URL, certificate name, fingerprint and expiry. The server binds only to
the selected address. It requires a new setup if the address changes or the
certificate expires. Keep the Mac awake and on the same network during testing.

`.local-test` is ignored by Git and Docker and excluded from the source package.
Its directory is restricted to the current user; private keys and the host key
are user-readable only. The CA signing key is deleted after signing the server
certificate. Keep the remaining `server-key.pem` and `host-key.txt` on the Mac.

In another terminal, run:

```sh
npm run test:lan
```

The smoke test explicitly trusts the generated public CA for its own HTTPS/WSS
connections, checks hostname validation, packaged assets, role and origin
checks, live frames, late joins and session stop. Ordinary system trust must
reject the new CA until you install it. The test never disables certificate
verification or prints access keys/capabilities.

## On the iPad

1. Transfer only `.local-test/live-draw-test.mobileconfig` to your own iPad,
   for example through AirDrop, and open it. Install the downloaded profile in
   Settings → General → VPN & Device Management. Confirm its name matches the
   certificate name printed by preparation. The profile contains only a public
   root certificate; it does not enrol the device or contain private keys.
2. Go to Settings → General → About → Certificate Trust Settings and enable
   full trust for that test certificate. Manual installation alone does not
   enable SSL trust; see [Apple's instructions](https://support.apple.com/en-us/102390).
3. Open the prepared HTTPS URL in Safari. It must open without a certificate
   warning. If it does not, check the installed profile, trust toggle, current
   address and certificate expiry before proceeding.
4. The editor is private by default. Enter the **Presenter password** copied
   locally from `.local-test/host-key.txt` before the drawing tools open. This is
   the existing generated host key. Select **Remember this device** on your own
   iPad to skip password entry on later visits. Access lasts up to 30 days, or
   until the server restarts. Leave it unchecked on shared devices. Draw with
   Apple Pencil, choose **Start live session** and copy the viewer link. Keep the
   password private; viewers need only that link. Open it on a second device
   that also trusts this test certificate, without signing in as a presenter.
5. Stop sharing and start again: it should start without asking for the password.
   Stop, choose **Forget this device**, and start again: the password dialog must
   return. Confirm a wrong password stays in the dialog and can be corrected.
   After a server restart, sign in again. Do not refresh drawings you need to keep.

`EDITOR_ACCESS=public npm run start:lan` restores a public editor for an intentional
test; live-session creation still needs the presenter password. Private mode is
the default when the generated password is configured.

Both browsers connect to the same running server through the complete copied
viewer link, including its `#` fragment. Opening the presenter address on another
device does not join the first session. When testing on one Mac, keep the
presenter visible and open the viewer in a separate browser window. Switching
away from the presenter tab pauses capture, so a viewer may show Presenter paused.

Refreshing an existing presenter loads UI changes but resets its drawing;
export PNG/PSD first if you need to refresh. The updated device-login flow also
requires the updated server process. An already open older page can still use
its original key dialog after that server update.

For a Mac viewer, import `.local-test/live-draw-test-ca.cer` using Keychain Access
and enable SSL trust for this specific test certificate. For another iPad, repeat
the profile and trust steps. Do not distribute this development certificate to
an ordinary audience; use publicly trusted HTTPS for that workflow.

If the iPad cannot reach the Mac, check that both devices are on the same Wi-Fi,
that the network permits device-to-device traffic, and that macOS permits the
Node.js server's inbound connections. Do not disable the firewall to solve this;
allow only the intended server when required.

## Acceptance and cleanup

Use the [physical-device checklist](ACCEPTANCE.md#physical-ipad-gate), including
30 minutes of drawing, both orientations, background/screen lock, exports and
measured latency. Record results separately from the Mac smoke test. Device
acceptance is pending until those checks are completed.

Export drawings before stopping the server with Ctrl-C; stopping ends sessions.
Remove the **Live Draw iPad Test** profile from each test iPad afterwards. Remove
the same certificate from any Mac keychain where you installed it. When the
server is stopped and the test is finished, remove the local `.local-test`
directory. A new setup generates a new CA/profile, which must be installed again.
