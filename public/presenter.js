import { FramePublisher } from './capture.js';
import { VERSION, socketProtocols, secureOrigin } from './protocol.js';
const $ = id => document.getElementById(id);
const frame = $('editor');
let editorReady = frame.dataset.ready === 'true', session, socket, publisher, unsubscribe, reconnectTimer, reconnectDelay = 500, stopping = false, terminal = false, starting = false, forgetting = false, exporting = false, sequence = 0;
let config = {}, access = { authorized: false };
let controlsHidden = false, unsubscribeControls, restoreBounds = '';
frame.addEventListener('editor-ready', () => { editorReady = true; buttons(); observeControls(); if (session) connect(); else state('Sharing is off'); }, { once: true });
config = await fetch('/api/config', { cache: 'no-store' }).then(r => r.json());
access = { authorized: !config.hostKeyRequired };
if (config.hostKeyRequired) {
  try {
    const response = await fetch('/api/presenter-access', { cache: 'no-store', credentials: 'same-origin' });
    if (response.ok) access = await response.json();
  } catch { /* A failed access check can be retried by signing in. */ }
}
const storageKey = 'live-draw.presenter';
function clearSavedSession() { try { sessionStorage.removeItem(storageKey); } catch { /* Keep sharing usable when browser storage is unavailable. */ } }
try { const saved = JSON.parse(sessionStorage.getItem(storageKey)); if (saved?.expiresAt > Date.now()) session = saved; else clearSavedSession(); } catch { clearSavedSession(); }
function state(text, live = false) {
  for (const id of ['status', 'compact-status']) $(id).textContent = text;
  for (const id of ['indicator', 'compact-indicator']) $(id).classList.toggle('live', live);
}
function viewers(count) {
  for (const id of ['count', 'compact-count']) { $(id).hidden = count === undefined; $(id).textContent = count === undefined ? '' : `${count} ${count === 1 ? 'viewer' : 'viewers'}`; }
}
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function closeMore() { $('more').open = false; }
function observeControls() {
  if (!controlsHidden || !editorReady || unsubscribeControls) return;
  // Borrow only viewport geometry; this does not encode or publish an image.
  unsubscribeControls = frame.contentWindow.liveDrawEditor.subscribeViewport(({ canvas }) => {
    const bounds = canvas.getBoundingClientRect(), host = frame.getBoundingClientRect();
    const geometry = [host.left + bounds.left + bounds.width / 2, host.top + bounds.top + 8, Math.max(44, bounds.width - 16)];
    if (geometry.join() === restoreBounds) return;
    restoreBounds = geometry.join();
    const restore = $('show-controls');
    restore.style.left = `${geometry[0]}px`; restore.style.top = `${geometry[1]}px`; restore.style.maxWidth = `${geometry[2]}px`;
    restore.classList.toggle('narrow', bounds.width < 200);
  });
}
function hideControls(hidden) {
  controlsHidden = hidden; closeMore();
  $('presenter-controls').hidden = hidden; $('show-controls').hidden = !hidden;
  for (const id of ['hide-controls', 'show-controls']) $(id).setAttribute('aria-expanded', String(!hidden));
  if (hidden) observeControls();
  else { unsubscribeControls?.(); unsubscribeControls = undefined; restoreBounds = ''; }
  $(hidden ? 'show-controls' : 'hide-controls').focus({ preventScroll: true });
}
function buttons() {
  $('start').hidden = !!session; $('start').disabled = starting || forgetting || !editorReady;
  $('copy').hidden = !session || stopping; $('stop').hidden = !session; $('stop').disabled = stopping;
  $('submit-key').disabled = $('cancel-key').disabled = $('host-key').disabled = $('remember-device').disabled = starting;
  $('submit-key').textContent = starting ? 'Starting…' : 'Start sharing';
  $('forget-device').hidden = !config.hostKeyRequired || !access.authorized;
  $('forget-device').disabled = !!session || starting || forgetting;
  $('forget-device').textContent = forgetting ? 'Forgetting…' : 'Forget this device';
  $('forget-device').title = session ? 'Stop sharing before forgetting this device.' : 'Remove presenter access from this browser.';
  $('export-psd').disabled = !editorReady || exporting;
}
function passwordDialog(message = '') {
  $('key-error').textContent = message; $('key-error').hidden = !message;
  if (!$('key-dialog').open) { $('remember-device').checked = false; $('key-dialog').showModal(); }
  $('host-key').focus();
}
function disconnectCapture() { unsubscribe?.(); unsubscribe = undefined; if (publisher) sequence = publisher.sequence; publisher?.dispose(); publisher = undefined; }
function capture(epoch) {
  socket.datasetEpoch = epoch;
  disconnectCapture();
  if (document.hidden || stopping) return;
  publisher = new FramePublisher({ socket, epoch, initialSequence: sequence, fps: config.fps, maxEdge: config.maxEdge, maxFrameBytes: config.maxFrameBytes, onError: message => { state('Sharing paused'); notice(message); socket?.send(JSON.stringify({ type: 'pause' })); disconnectCapture(); } });
  unsubscribe = frame.contentWindow.liveDrawEditor.subscribeViewport(publisher.notify);
}
function finish(message) {
  terminal = true; clearTimeout(reconnectTimer); disconnectCapture();
  session = undefined; stopping = false; clearSavedSession(); socket?.close(); buttons(); state('Sharing is off'); viewers(); notice(message);
}
function connect() {
  if (!session || !editorReady || terminal) return;
  if (!secureOrigin(location.origin)) { finish('Use HTTPS to share this drawing.'); return; }
  clearTimeout(reconnectTimer);
  state(stopping ? 'Stopping sharing…' : 'Connecting…');
  socket = new WebSocket(new URL('/socket', location.origin).href.replace(/^http/, 'ws'), socketProtocols({ role: 'presenter', id: session.id, token: session.presenterToken })); socket.binaryType = 'arraybuffer';
  const current = socket;
  current.addEventListener('open', () => current.send(JSON.stringify({ type: 'auth', v: VERSION, role: 'presenter', id: session.id, token: session.presenterToken })));
  current.addEventListener('message', event => {
    if (current !== socket || typeof event.data !== 'string') return;
    const message = JSON.parse(event.data);
    if (message.type === 'ended') { finish(message.reason === 'expired' ? 'The session expired. Start another when you are ready.' : ''); return; }
    if (message.type === 'ready') {
      reconnectDelay = 500;
      disconnectCapture(); sequence = 0;
      current.datasetEpoch = message.epoch;
      if (stopping) current.send(JSON.stringify({ type: 'stop' }));
      else if (document.hidden) current.send(JSON.stringify({ type: 'pause' }));
      else capture(message.epoch);
    }
    if (['ready', 'status'].includes(message.type)) {
      viewers(message.viewers);
      if (!stopping) state(message.state === 'live' ? 'Live' : message.state === 'paused' ? 'Sharing paused' : 'Connecting…', message.state === 'live');
    }
  });
  current.addEventListener('close', event => {
    if (current !== socket || terminal || !session) return;
    disconnectCapture();
    if (event.code === 1008 || session.expiresAt <= Date.now()) { finish('Session unavailable. Start a new session to share again.'); return; }
    state(stopping ? 'Stopping when reconnected…' : 'Reconnecting…');
    reconnectTimer = setTimeout(connect, reconnectDelay); reconnectDelay = Math.min(10000, reconnectDelay * 2);
  });
  current.addEventListener('error', () => state('Reconnecting…'));
}
async function start(hostKey = '') {
  if (starting || forgetting || session) return false;
  starting = true; buttons();
  $('key-error').hidden = true;
  try {
    if (!secureOrigin(location.origin)) throw new Error('Use HTTPS to share this drawing.');
    if (hostKey) {
      const login = await fetch('/api/presenter-access', { method: 'POST', credentials: 'same-origin', headers: { 'X-Host-Key': hostKey.trim(), 'X-Remember-Device': String($('remember-device').checked) } });
      const result = await login.json();
      if (!login.ok) {
        if (login.status === 403 && result.error === 'Host access key required') throw new Error('That presenter password was not accepted. Use the existing password for this server.');
        throw new Error(result.error || 'Could not enable presenter access. Try again.');
      }
      access = result; $('host-key').value = ''; $('key-dialog').close();
    }
    const response = await fetch('/api/sessions', { method: 'POST', credentials: 'same-origin' });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 403 && result.error === 'Host access key required') {
        access = { authorized: false };
        const message = hostKey ? 'This browser did not keep presenter access. Allow cookies for this site and try again.' : 'Presenter access has expired or was removed. Enter the password to start sharing again.';
        notice(message); state('Sharing is off'); passwordDialog(message); return false;
      }
      throw new Error(result.error || 'Could not start sharing. Try again.');
    }
    session = result;
    try { sessionStorage.setItem(storageKey, JSON.stringify(session)); } catch { /* This open page can share without reload persistence. */ }
    terminal = false; stopping = false;
    notice();
    $('host-key').value = ''; $('key-dialog').close();
    buttons(); connect(); return true;
  } catch (error) {
    const message = error.message === 'Failed to fetch' || error.name === 'TypeError' ? 'Could not reach the server. Check the connection and try again.' : error.message || 'Could not start sharing. Try again.';
    notice(message); state('Sharing is off');
    if ($('key-dialog').open) { $('key-error').textContent = message; $('key-error').hidden = false; $('host-key').focus(); }
    return false;
  } finally { starting = false; buttons(); if ($('key-dialog').open) $('host-key').focus(); }
}
$('start').addEventListener('click', () => { if (starting || forgetting || session) return; if (config.hostKeyRequired && !access.authorized) passwordDialog(); else void start(); });
$('cancel-key').addEventListener('click', () => { if (!starting) { $('host-key').value = ''; $('key-dialog').close(); } });
$('key-dialog').addEventListener('cancel', event => { if (starting) event.preventDefault(); else $('host-key').value = ''; });
$('key-form').addEventListener('submit', async event => { event.preventDefault(); await start($('host-key').value); });
$('forget-device').addEventListener('click', async () => {
  if (session || starting || forgetting) return;
  closeMore(); $('more-toggle').focus();
  forgetting = true; buttons();
  try {
    const response = await fetch('/api/presenter-access', { method: 'DELETE', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not forget this device. Try again.');
    access = { authorized: false };
    notice('Presenter access removed. Enter the password next time you start sharing.');
  } catch { notice('Could not forget this device. Check the connection and try again.'); }
  finally { forgetting = false; buttons(); }
});
$('stop').addEventListener('click', () => {
  stopping = true; disconnectCapture(); buttons(); state('Stopping sharing…');
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' }));
  else { socket?.close(); connect(); }
});
function viewerURL() { return `${location.origin}/watch/${session.id}#${session.viewerToken}`; }
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(viewerURL()); }
  catch { /* The dialog provides a selected link when clipboard access is unavailable. */ }
  $('viewer-link').value = viewerURL(); $('link-dialog').showModal(); $('viewer-link').select();
});
$('close-link').addEventListener('click', () => $('link-dialog').close());
let exportURL;
async function exportPSD() {
  if (!editorReady || exporting) return;
  closeMore(); $('more-toggle').focus();
  notice();
  exporting = true; buttons();
  try {
    const blob = await frame.contentWindow.liveDrawEditor.getPSD();
    if (exportURL) URL.revokeObjectURL(exportURL);
    exportURL = URL.createObjectURL(blob);
    $('download').href = exportURL; $('download').download = 'drawing.psd'; $('download').textContent = 'Download PSD';
    $('export-dialog').showModal();
  } catch { notice('Could not export PSD. Try again.'); }
  finally { exporting = false; buttons(); }
}
$('export-psd').addEventListener('click', () => void exportPSD());
$('close-export').addEventListener('click', () => { $('export-dialog').close(); if (exportURL) { URL.revokeObjectURL(exportURL); exportURL = undefined; $('download').removeAttribute('href'); } });
$('hide-controls').addEventListener('click', () => hideControls(true));
$('show-controls').addEventListener('click', () => hideControls(false));
document.addEventListener('pointerdown', event => { if (!$('more').contains(event.target)) closeMore(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('more').open) { closeMore(); $('more-toggle').focus(); event.preventDefault(); }
});
window.addEventListener('blur', () => { if (document.activeElement === frame) closeMore(); });
document.addEventListener('visibilitychange', () => {
  if (!session || socket?.readyState !== WebSocket.OPEN || stopping) return;
  disconnectCapture();
  socket.send(JSON.stringify({ type: document.hidden ? 'pause' : 'resume' }));
  if (!document.hidden) {
    // Subscribe again for a fresh snapshot even if the drawing has not changed.
    const epoch = socket.datasetEpoch;
    if (epoch) capture(epoch);
  }
});
notice(); buttons();
if (editorReady) { if (session) connect(); else state('Sharing is off'); }
