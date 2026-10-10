import { FramePublisher } from './capture.js';
import { VERSION } from './protocol.js';
const $ = id => document.getElementById(id);
const frame = $('editor');
let editorReady = frame.dataset.ready === 'true', session, socket, publisher, unsubscribe, reconnectTimer, reconnectDelay = 500, stopping = false, terminal = false, starting = false, forgetting = false, sequence = 0;
let config = {}, access = { authorized: false };
frame.addEventListener('editor-ready', () => { editorReady = true; buttons(); if (session) connect(); else state('Sharing is off'); }, { once: true });
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
function state(text, live = false) { $('status').textContent = text; $('indicator').classList.toggle('live', live); }
function buttons() {
  $('start').hidden = !!session; $('start').disabled = starting || forgetting || !editorReady;
  $('copy').hidden = !session || stopping; $('stop').hidden = !session; $('stop').disabled = stopping;
  $('submit-key').disabled = $('cancel-key').disabled = $('host-key').disabled = $('remember-device').disabled = starting;
  $('submit-key').textContent = starting ? 'Starting…' : 'Start sharing';
  $('forget-device').hidden = !config.hostKeyRequired || !access.authorized;
  $('forget-device').disabled = !!session || starting || forgetting;
  $('forget-device').textContent = forgetting ? 'Forgetting…' : 'Forget this device';
  $('forget-device').title = session ? 'Stop sharing before forgetting this device.' : 'Remove presenter access from this browser.';
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
  publisher = new FramePublisher({ socket, epoch, initialSequence: sequence, fps: config.fps, maxEdge: config.maxEdge, maxFrameBytes: config.maxFrameBytes, onError: message => { state('Sharing paused'); $('notice').textContent = message; socket?.send(JSON.stringify({ type: 'pause' })); disconnectCapture(); } });
  unsubscribe = frame.contentWindow.liveDrawEditor.subscribeViewport(publisher.notify);
}
function finish(message) {
  terminal = true; clearTimeout(reconnectTimer); disconnectCapture();
  session = undefined; stopping = false; clearSavedSession(); socket?.close(); buttons(); state('Sharing is off'); $('count').hidden = true; $('notice').textContent = message;
}
function connect() {
  if (!session || !editorReady || terminal) return;
  clearTimeout(reconnectTimer);
  state(stopping ? 'Stopping sharing…' : 'Connecting…');
  socket = new WebSocket(new URL('/socket', location.origin).href.replace(/^http/, 'ws')); socket.binaryType = 'arraybuffer';
  const current = socket;
  current.addEventListener('open', () => current.send(JSON.stringify({ type: 'auth', v: VERSION, role: 'presenter', id: session.id, token: session.presenterToken })));
  current.addEventListener('message', event => {
    if (current !== socket || typeof event.data !== 'string') return;
    const message = JSON.parse(event.data);
    if (message.type === 'ended') { finish(message.reason === 'expired' ? 'The session expired. Start another when you are ready.' : 'Sharing stopped. Viewer access has ended.'); return; }
    if (message.type === 'ready') {
      reconnectDelay = 500;
      disconnectCapture(); sequence = 0;
      current.datasetEpoch = message.epoch;
      if (stopping) current.send(JSON.stringify({ type: 'stop' }));
      else if (document.hidden) current.send(JSON.stringify({ type: 'pause' }));
      else capture(message.epoch);
    }
    if (['ready', 'status'].includes(message.type)) {
      $('count').hidden = false; $('count').textContent = `${message.viewers} ${message.viewers === 1 ? 'viewer' : 'viewers'}`;
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
        $('notice').textContent = message; state('Sharing is off'); passwordDialog(message); return false;
      }
      throw new Error(result.error || 'Could not start sharing. Try again.');
    }
    session = result;
    try { sessionStorage.setItem(storageKey, JSON.stringify(session)); } catch { /* This open page can share without reload persistence. */ }
    terminal = false; stopping = false;
    $('notice').textContent = 'Anyone with the viewer link can watch until you stop sharing or the session expires.';
    $('host-key').value = ''; $('key-dialog').close();
    buttons(); connect(); return true;
  } catch (error) {
    const message = error.message === 'Failed to fetch' || error.name === 'TypeError' ? 'Could not reach the server. Check the connection and try again.' : error.message || 'Could not start sharing. Try again.';
    $('notice').textContent = message; state('Sharing is off');
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
  forgetting = true; buttons();
  try {
    const response = await fetch('/api/presenter-access', { method: 'DELETE', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not forget this device. Try again.');
    access = { authorized: false };
    $('notice').textContent = 'Presenter access removed. Enter the password next time you start sharing.';
  } catch { $('notice').textContent = 'Could not forget this device. Check the connection and try again.'; }
  finally { forgetting = false; buttons(); }
});
$('stop').addEventListener('click', () => {
  stopping = true; disconnectCapture(); buttons(); state('Stopping sharing…');
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' }));
  else { socket?.close(); connect(); }
});
function viewerURL() { return `${location.origin}/watch/${session.id}#${session.viewerToken}`; }
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(viewerURL()); $('notice').textContent = 'Viewer link copied. Anyone with the link can watch this session.'; }
  catch { $('notice').textContent = 'Copy the viewer link below to share this session.'; }
  $('viewer-link').value = viewerURL(); $('link-dialog').showModal(); $('viewer-link').select();
});
$('close-link').addEventListener('click', () => $('link-dialog').close());
let exportURL;
async function exportDrawing(format) {
  $('export').disabled = $('export-psd').disabled = true;
  try {
    const blob = await frame.contentWindow.liveDrawEditor[format === 'psd' ? 'getPSD' : 'getPNG']();
    if (exportURL) URL.revokeObjectURL(exportURL);
    exportURL = URL.createObjectURL(blob);
    $('download').href = exportURL; $('download').download = `drawing.${format}`; $('download').textContent = `Download ${format.toUpperCase()}`;
    $('export-dialog').showModal();
  } catch { $('notice').textContent = 'Export is not ready. Wait for the drawing tools to load.'; }
  finally { $('export').disabled = $('export-psd').disabled = false; }
}
$('export').addEventListener('click', () => void exportDrawing('png'));
$('export-psd').addEventListener('click', () => void exportDrawing('psd'));
$('close-export').addEventListener('click', () => { $('export-dialog').close(); if (exportURL) { URL.revokeObjectURL(exportURL); exportURL = undefined; $('download').removeAttribute('href'); } });
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
buttons();
if (editorReady && session) connect();
