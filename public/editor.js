const editor = new window.Klecks({
  embedUrl: new URL('/klecks/', location.origin).href,
  logoImg: '/logo.svg',
  enableCanvasResize: true,
  project: { width: 1600, height: 1000, layers: [{ name: 'Paper', isVisible: true, opacity: 1, mixModeStr: 'source-over', image: { fill: '#ffffff' } }] },
  onSubmit: async (success, failure) => { try { await exportPNG(); success(); } catch { failure(); } },
});
async function exportDrawing(format = 'png') {
  const blob = await (format === 'psd' ? editor.getPSD() : editor.getPNG());
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = `drawing.${format}`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const exportPNG = () => exportDrawing('png');
window.liveDrawEditor = { subscribeViewport: listener => editor.subscribeViewport(listener), getPNG: () => editor.getPNG(), getPSD: () => editor.getPSD() };
let unsubscribe;
unsubscribe = editor.subscribeViewport(() => {
  const frame = parent.document.getElementById('editor');
  frame.dataset.ready = 'true';
  frame.dispatchEvent(new Event('editor-ready'));
  const label = document.querySelector('.toolspace-row-button__submit');
  if (label) { label.textContent = 'Export'; label.parentElement.title = 'Export PNG'; }
  queueMicrotask(() => unsubscribe?.());
});
