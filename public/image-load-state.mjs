// Keep the browser's empty/broken image glyph out of pending previews. A load
// succeeds only after the image decoder accepts it, not just after HTTP 200.
export function imageLoadState(image, { retry, ready = () => {}, failed = () => {}, errorClass = "" } = {}) {
  const state = document.createElement("span"), spinner = document.createElement("span"),
    label = document.createElement("span"), button = document.createElement("button"),
    detail = document.createElement("span"), meter = document.createElement("progress");
  state.className = "image-load-state";
  state.setAttribute("role", "status");
  spinner.className = "thread-spinner";
  spinner.setAttribute("aria-hidden", "true");
  button.type = "button";
  button.textContent = "重试";
  button.onclick = event => { event.preventDefault(); event.stopPropagation(); retry?.(); };
  detail.className = 'image-load-detail';
  meter.setAttribute('aria-label', '图片下载进度'); meter.max = 100;
  state.append(spinner, label, detail, meter, button);
  const loading = () => {
    image.classList.add("image-pending");
    image.hidden = false;
    image.setAttribute("aria-hidden", "true");
    image.tabIndex = -1;
    state.hidden = false;
    state.dataset.state = "loading";
    state.className = "image-load-state";
    state.setAttribute("aria-busy", "true");
    spinner.hidden = false;
    button.hidden = true;
    label.textContent = "图片加载中…";
    detail.textContent = ''; detail.hidden = true; meter.hidden = true; meter.removeAttribute('value');
  };
  const error = (message = '图片无法显示，文件可能不完整或格式不受支持') => {
    image.classList.remove("image-pending");
    image.hidden = true;
    state.hidden = false;
    state.dataset.state = "error";
    state.className = "image-load-state " + errorClass;
    state.setAttribute("aria-busy", "false");
    spinner.hidden = true;
    label.textContent = "图片加载失败";
    detail.textContent = message; detail.hidden = false; meter.hidden = true;
    button.hidden = !retry;
    failed();
  };
  image.addEventListener("load", () => {
    if (!image.naturalWidth) { error(); return; }
    image.classList.remove("image-pending");
    image.hidden = false;
    image.removeAttribute("aria-hidden");
    if (image.classList.contains("zoomable-image")) image.tabIndex = 0;
    state.dataset.state = "ready";
    state.setAttribute("aria-busy", "false");
    state.hidden = true;
    ready();
  });
  image.addEventListener("error", () => { if (image.getAttribute('src')) error(); });
  const bytes = n => n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
  const progress = ({phase, loaded, total}) => {
    if (state.dataset.state !== 'loading') return;
    if (phase === 'requesting') { label.textContent = '正在请求图片…'; return; }
    detail.hidden = false;
    if (phase === 'decoding') {
      label.textContent = '下载完成，正在显示…'; detail.textContent = bytes(loaded); meter.hidden = true; return;
    }
    const known = Number.isFinite(total) && total > 0;
    label.textContent = known ? `正在下载图片 ${Math.min(100, Math.floor(loaded / total * 100))}%` : '正在下载图片…';
    detail.textContent = known ? `${bytes(loaded)} / ${bytes(total)}` : `已下载 ${bytes(loaded)}`;
    meter.hidden = false;
    if (known) meter.value = Math.min(100, loaded / total * 100); else meter.removeAttribute('value');
  };
  loading();
  return { element: state, loading, error, progress };
}
