import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { FramePublisher } from '../public/capture.js';
import { decodeFrame, imageDimensions, encodeFrame } from '../public/protocol.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY7sAAAAASUVORK5CYII=', 'base64');
test('protocol rejects truncated headers and inconsistent metadata', () => {
  assert.throws(() => decodeFrame(new Uint8Array(3)));
  assert.throws(() => decodeFrame(encodeFrame({ epoch: 'a', seq: -1, width: 1, height: 1, mime: 'image/png' }, png)));
  assert.deepEqual(imageDimensions(png, 'image/png'), { width: 1, height: 1 });
  assert.throws(() => imageDimensions(png, 'image/webp'));
  const larger = encodeFrame({ epoch: 'test', seq: 1, width: 1, height: 1, mime: 'image/png' }, new Uint8Array(3 * 1024 * 1024));
  assert.throws(() => decodeFrame(larger));
  assert.equal(decodeFrame(larger, 4 * 1024 * 1024).image.length, 3 * 1024 * 1024);
});
test('capture keeps one encoder and the latest pending view, and sends no frames after disposal', async () => {
  const completions = [], sent = [], drawn = [];
  const surface = { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage(canvas) { drawn.push(canvas.id); } }), toBlob(done) { completions.push(done); } };
  const socket = { readyState: 1, bufferedAmount: 0, send(bytes) { sent.push(bytes); } };
  const publisher = new FramePublisher({ socket, epoch: 'test', initialSequence: 4, fps: 30, maxEdge: 1600, maxFrameBytes: 2048, makeCanvas: () => surface, onError: message => assert.fail(message) });
  publisher.notify({ canvas: { id: 1, width: 100, height: 50 } }); await delay(40);
  publisher.notify({ canvas: { id: 2, width: 100, height: 50 } }); publisher.notify({ canvas: { id: 3, width: 100, height: 50 } });
  assert.equal(completions.length, 1); assert.equal(publisher.pending.canvas.id, 3);
  completions[0](new Blob([png], { type: 'image/png' })); await delay(50);
  assert.deepEqual(drawn, [1, 3]); assert.equal(sent.length, 1); assert.equal(completions.length, 2);
  assert.equal(decodeFrame(sent[0]).header.seq, 5);
  publisher.dispose(); completions[1](new Blob([png], { type: 'image/png' })); await delay(5);
  assert.equal(sent.length, 1); assert.equal(surface.width, 1);
});
