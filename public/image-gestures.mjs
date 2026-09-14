// A preview owns its gestures. Browser/page zoom remains available outside it.
export function imageGestures(stage, image, { changed = () => {} } = {}) {
  const pointers = new Map();
  let width = 0, height = 0, fit = 0, areaWidth = 0, areaHeight = 0;
  let scale = 1, x = 0, y = 0, baseline, moved = false, fromImage = false;
  let pointerType = '', lastTap, suppressClick = false;
  const maximum = () => Math.max(8, fit ? 1 / fit : 1);
  const limit = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const point = event => {
    const r = stage.getBoundingClientRect();
    return { x: event.clientX - r.left - r.width / 2, y: event.clientY - r.top - r.height / 2 };
  };
  function render() {
    const dx = Math.max(0, (width * scale - areaWidth) / 2);
    const dy = Math.max(0, (height * scale - areaHeight) / 2);
    x = limit(x, -dx, dx); y = limit(y, -dy, dy);
    image.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    stage.classList.toggle('image-can-pan', scale > 1.001);
    changed(scale > 1.001);
  }
  function zoom(next, at = { x: 0, y: 0 }) {
    next = limit(next, 1, maximum());
    const ratio = next / scale;
    x = at.x - (at.x - x) * ratio;
    y = at.y - (at.y - y) * ratio;
    scale = next; render();
  }
  function measure() {
    if (!image.naturalWidth || image.hidden || image.classList.contains('image-pending')) return;
    const canvas = image.parentElement, css = getComputedStyle(canvas);
    const aw = Math.max(1, canvas.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight));
    const ah = Math.max(1, canvas.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom));
    const nextFit = Math.min(1, aw / image.naturalWidth, ah / image.naturalHeight);
    const nextWidth = image.naturalWidth * nextFit, nextHeight = image.naturalHeight * nextFit;
    if (width === nextWidth && height === nextHeight && areaWidth === aw && areaHeight === ah) return;
    const absoluteScale = fit * scale;
    areaWidth = aw; areaHeight = ah; fit = nextFit; width = nextWidth; height = nextHeight;
    // Fit stays fit after rotation; a magnified image preserves its pixel scale.
    if (scale > 1.001) scale = limit(absoluteScale / fit, 1, maximum());
    image.style.width = width + 'px'; image.style.height = height + 'px';
    cancel(); render();
  }
  function sample() {
    const values = [...pointers.values()].slice(0, 2);
    const a = values[0], b = values[1];
    return b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) }
      : { ...a, distance: 0 };
  }
  function rebase() { baseline = pointers.size ? { ...sample(), scale, panX: x, panY: y } : null; }
  function cancel() {
    const ids = [...pointers.keys()]; pointers.clear(); baseline = null;
    for (const id of ids) if (stage.hasPointerCapture(id)) stage.releasePointerCapture(id);
    stage.classList.remove('image-dragging'); lastTap = null; suppressClick = true;
  }
  function reset() {
    cancel(); scale = 1; x = y = 0; fit = width = height = 0;
    suppressClick = false; fromImage = false;
    image.style.removeProperty('width'); image.style.removeProperty('height');
    render();
  }
  const fitWindow = () => { cancel(); scale = 1; x = y = 0; render(); };
  const toggle = at => { cancel(); zoom(scale > 1.001 ? 1 : 2.5, at); };
  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !fit || image.hidden || image.classList.contains('image-pending') || event.target.closest('button,a')) return;
    if (!pointers.size) { moved = false; fromImage = event.target === image; suppressClick = false; }
    pointerType = event.pointerType;
    pointers.set(event.pointerId, point(event));
    if (pointers.size > 1) { moved = true; lastTap = null; }
    stage.setPointerCapture(event.pointerId); rebase();
    stage.classList.add('image-dragging');
  });
  stage.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId) || !baseline) return;
    event.preventDefault(); pointers.set(event.pointerId, point(event));
    const current = sample();
    if (Math.hypot(current.x - baseline.x, current.y - baseline.y) > 5) moved = true;
    const next = baseline.distance > 0 ? limit(baseline.scale * current.distance / baseline.distance, 1, maximum()) : baseline.scale;
    const ratio = next / baseline.scale;
    x = current.x - (baseline.x - baseline.panX) * ratio;
    y = current.y - (baseline.y - baseline.panY) * ratio;
    scale = next; render();
  });
  function end(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (event.type !== 'pointerup') { moved = true; lastTap = null; }
    if (pointers.size) { rebase(); return; }
    baseline = null; stage.classList.remove('image-dragging'); suppressClick = moved;
    if (!moved && fromImage && event.pointerType === 'touch') {
      const at = point(event), now = performance.now();
      if (lastTap && now - lastTap.time < 350 && Math.hypot(at.x - lastTap.x, at.y - lastTap.y) < 28) {
        toggle(at); lastTap = null; suppressClick = true;
      } else lastTap = { ...at, time: now };
    }
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(type, end);
  stage.addEventListener('click', event => {
    // Pointer capture can retarget a click to the stage. Never close after a
    // pan/pinch or an image tap, even when the final finger lands on background.
    if (event.target.closest('button,a')) return;
    if (suppressClick || fromImage && event.detail > 0) { event.stopImmediatePropagation(); event.preventDefault(); }
  }, true);
  stage.addEventListener('dblclick', event => {
    if (pointerType === 'touch' || !fit || !fromImage) return;
    event.preventDefault(); toggle(point(event));
  });
  stage.addEventListener('wheel', event => {
    event.preventDefault();
    if (!fit) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? areaHeight : 1);
    zoom(scale * Math.exp(-limit(delta, -300, 300) * 0.002), point(event));
  }, { passive: false });
  // Ctrl+wheel over the toolbar must not zoom the app while preview is modal.
  stage.parentElement.addEventListener('wheel', event => { if (event.ctrlKey) event.preventDefault(); }, { passive: false });
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  new ResizeObserver(measure).observe(stage);
  return { measure, reset, fit: fitWindow, toggleSize() {
    cancel(); if (scale > 1.001) fitWindow(); else zoom(fit ? 1 / fit : 1);
  } };
}
