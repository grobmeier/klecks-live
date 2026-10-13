import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration } from '../server/config.mjs';
import { createApplication } from '../server/app.mjs';

test('network origins require HTTPS even with a long password or loopback proxy listener', () => {
  const password = 'synthetic-transport-password-'.padEnd(64, 'x');
  for (const host of ['0.0.0.0', '127.0.0.1']) {
    assert.throws(() => configuration({ HOST: host, PUBLIC_ORIGIN: 'http://draw.example.org', HOST_ACCESS_KEY: password }), /HTTPS/);
    assert.throws(() => createApplication({ host, publicOrigin: 'http://draw.example.org', hostKey: password }), /HTTPS/);
  }
  assert.throws(() => configuration({ HOST: '0.0.0.0', PUBLIC_ORIGIN: 'http://127.0.0.1', HOST_ACCESS_KEY: password }), /HTTPS/);
  assert.equal(configuration({ PUBLIC_ORIGIN: 'http://127.0.0.1:5055' }).publicOrigin, 'http://127.0.0.1:5055');
  assert.equal(configuration({ HOST: '0.0.0.0', PUBLIC_ORIGIN: 'https://draw.example.org', HOST_ACCESS_KEY: password }).publicOrigin, 'https://draw.example.org');
});
