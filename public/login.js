const $ = id => document.getElementById(id);
let signingIn = false;
function error(message) { $('login-error').textContent = message; $('login-error').hidden = false; }
function buttons() {
  $('submit-login').disabled = $('host-key').disabled = $('remember-device').disabled = signingIn;
  $('submit-login').textContent = signingIn ? 'Opening…' : 'Open drawing tools';
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (signingIn) return;
  signingIn = true; buttons(); $('login-error').hidden = true;
  try {
    const response = await fetch('/api/presenter-access', { method: 'POST', credentials: 'same-origin', headers: {
      'X-Host-Key': $('host-key').value.trim(), 'X-Remember-Device': String($('remember-device').checked),
    } });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 403 && result.error === 'Host access key required') throw new Error('That presenter password was not accepted. Use the existing password for this server.');
      throw new Error(result.error || 'Could not sign in. Try again.');
    }
    $('host-key').value = '';
    // Confirm the browser retained its cookie before navigating. Otherwise a
    // blocked cookie would lead back to this page with no useful explanation.
    const check = await fetch('/api/presenter-access', { cache: 'no-store', credentials: 'same-origin' });
    if (!check.ok || !(await check.json()).authorized) throw new Error('This browser did not keep presenter access. Allow cookies for this site and try again.');
    location.replace('/present');
  } catch (failure) {
    error(failure.name === 'TypeError' ? 'Could not reach the server. Check the connection and try again.' : failure.message || 'Could not sign in. Try again.');
  } finally { signingIn = false; buttons(); if (!$('login-error').hidden) $('host-key').focus(); }
});
