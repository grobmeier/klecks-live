# Presenter guide

Live Draw shares the visible drawing area from Klecks. One presenter controls
the artwork and the view; an audience follows through a read-only browser page.

## Start a session

1. Open your Live Draw address. On an iPad, use Safari and draw with Apple Pencil
   or touch; on a computer, use your mouse or pen tablet.
2. Sign in with the **Presenter password** supplied by the server operator.
   Select **Remember this device** on your own device to reuse access later.
3. Choose **Start live**, then **Copy link**.
4. Send that viewer link to your audience. Viewers open it in a browser without
   signing in or installing an application.

A public-editor server allows drawing before sign-in and asks for the presenter
password when sharing starts. The presenter password authorizes broadcasting;
it is separate from the viewer link.

Copy the complete link, including everything after `#`. Another device joins
through that link; opening the main editor address opens a separate drawing.
Anyone with the link can watch until the session ends or expires.

## Make room for drawing

The sharing bar shows live status, viewer count, **Start live**, **Copy link**
and **Stop**. **More** contains PSD export and **Forget this device**.

Choose **Hide** to give the editor the full window height. The floating **Show**
button displays the session state and viewer count. Tap it to restore the bar.
It follows the drawing area when you move Klecks' sidebar or rotate your iPad.
Hiding and showing controls preserve the drawing and the live session.

The bar starts visible when the page opens. On narrow screens it wraps so the
controls remain within reach.

## What viewers see

Viewers follow the current canvas crop, including zoom, pan, rotation and
mirroring. Strokes arrive while you draw. Undo, redo, filters, layer changes and
other applied edits update the shared image. Toolbars, dialogs, brush cursors
and selection handles stay out of the audience view.

The image fills the available viewer space while preserving its aspect ratio.
Viewers can choose **Fullscreen** for more room. A viewer window can also be
shared in a video meeting.

Keep the presenter page visible while drawing. Moving it to the background
pauses capture; returning sends a fresh view. A network interruption triggers
reconnection, and late viewers receive the latest image. By default, presenter
reconnection has a two-minute grace period and sessions last four hours. The
server operator can change these limits.

## Save your work

- **PNG:** choose **Export** inside Klecks, then confirm **Submit** in its dialog.
- **PSD:** choose **More → Export PSD** to download the drawing with layers.

Exports use the original drawing dimensions and are generated locally. Your
work remains available after you stop sharing.

Export before reloading or closing the presenter. The embedded editor does not
restore drawings after a reload, and the relay stores no project files.

## End sharing and sign out

Choose **Stop** to end the session, clear the audience image and invalidate its
viewer link. A new session creates a new link.

After stopping, choose **More → Forget this device** to revoke this browser's
presenter access. Other devices keep their own access. Remembered access lasts
up to 30 days; leaving remembering unchecked uses a browser-session cookie with
an eight-hour server expiry. Server restarts clear all device logins and live
sessions, so sign in again afterwards.

## Connection help

| Message or symptom | Action |
| --- | --- |
| Presenter password rejected | Use the password from this server's operator; the viewer link is not a password. |
| Presenter access cannot be saved | Enable cookies for the Live Draw site and sign in again. |
| Presenter paused | Keep the presenter page visible and return to it after switching apps. |
| Reconnecting | Check the presenter's connection and return within the session's recovery window. |
| Session unavailable or ended | Ask the presenter for the current viewer link. |
| Viewer limit reached | Ask the operator to review the configured audience limit. |
| Local iPad connection fails | Check HTTPS trust, Wi-Fi reachability and the [local HTTPS guide](LOCAL_HTTPS.md). |
