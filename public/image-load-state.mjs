// Keep the browser's empty/broken image glyph out of pending previews. A load
// succeeds only after the image decoder accepts it, not just after HTTP 200.
export function imageLoadState(image, { retry, ready = () => {}, failed = () => {}, errorClass = "" } = {}) {
  const state = document.createElement("span"), spinner = document.createElement("span"),
    label = document.createElement("span"), button = document.createElement("button");
  state.className = "image-load-state";
  state.setAttribute("role", "status");
  spinner.className = "thread-spinner";
  spinner.setAttribute("aria-hidden", "true");
  button.type = "button";
  button.textContent = "重试";
  button.onclick = event => { event.preventDefault(); event.stopPropagation(); retry?.(); };
  state.append(spinner, label, button);
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
  };
  const error = () => {
    image.classList.remove("image-pending");
    image.hidden = true;
    state.hidden = false;
    state.dataset.state = "error";
    state.className = "image-load-state " + errorClass;
    state.setAttribute("aria-busy", "false");
    spinner.hidden = true;
    label.textContent = "图片加载失败";
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
  image.addEventListener("error", error);
  loading();
  return { element: state, loading, error };
}
