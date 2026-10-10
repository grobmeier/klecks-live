import { encodeFrame } from './protocol.js';

/** One encoder, one reusable surface, and only the most recent pending view. */
export class FramePublisher {
  constructor({ socket, epoch, fps, maxEdge, maxFrameBytes, onError, initialSequence = 0, makeCanvas = () => document.createElement('canvas') }) {
    Object.assign(this, { socket, epoch, fps, maxEdge, maxFrameBytes, onError });
    this.surface = makeCanvas(); this.sequence = initialSequence; this.active = true; this.busy = false; this.lastSent = 0;
  }
  notify = frame => { if (!this.active) return; this.pending = frame; this.schedule(); };
  schedule() {
    if (!this.active || this.busy || this.timer || !this.pending) return;
    const wait = Math.max(0, 1000 / this.fps - (performance.now() - this.lastSent));
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, wait);
  }
  async flush() {
    if (!this.active || !this.pending || this.socket.readyState !== 1) return;
    if (this.socket.bufferedAmount > this.maxFrameBytes) { this.timer = setTimeout(() => { this.timer = undefined; this.schedule(); }, 100); return; }
    const frame = this.pending; this.pending = undefined; this.busy = true;
    try {
      const scale = Math.min(1, this.maxEdge / Math.max(frame.canvas.width, frame.canvas.height));
      const width = Math.max(1, Math.round(frame.canvas.width * scale));
      const height = Math.max(1, Math.round(frame.canvas.height * scale));
      if (this.surface.width !== width) this.surface.width = width;
      if (this.surface.height !== height) this.surface.height = height;
      const context = this.surface.getContext('2d');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
      context.drawImage(frame.canvas, 0, 0, width, height);
      let blob = await new Promise(resolve => this.surface.toBlob(resolve, 'image/webp', 0.92));
      if (!blob || !['image/png', 'image/webp'].includes(blob.type)) blob = await new Promise(resolve => this.surface.toBlob(resolve, 'image/png'));
      if (!blob || blob.size > this.maxFrameBytes) throw new Error('Drawing update exceeds the configured image budget');
      const image = await blob.arrayBuffer();
      if (!this.active || this.socket.readyState !== 1) return;
      this.socket.send(encodeFrame({ epoch: this.epoch, seq: ++this.sequence, width, height, mime: blob.type }, image));
      this.lastSent = performance.now();
    } catch (error) { if (this.active) this.onError(error.message); }
    finally { this.busy = false; this.schedule(); }
  }
  dispose() {
    this.active = false; this.pending = undefined; clearTimeout(this.timer); this.timer = undefined;
    // Release after any asynchronous encode has copied its data.
    this.surface.width = 1; this.surface.height = 1;
  }
}
