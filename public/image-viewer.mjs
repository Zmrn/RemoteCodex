import { imageLoadState } from "./image-load-state.mjs";
let viewer;

function createViewer() {
  const element = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };
  const dialog = element("dialog", "image-viewer");
  dialog.id = "image-viewer";
  dialog.setAttribute("aria-label", "图片预览");
  const toolbar = element("div", "image-viewer-toolbar");
  const title = element("span", "image-viewer-title");
  const size = element("button", "image-viewer-size", "原始尺寸");
  size.type = "button";
  const download = element("a", "image-viewer-download", "下载原图");
  const close = element("button", "icon-button", "×");
  close.type = "button";
  close.setAttribute("aria-label", "关闭图片预览");
  const stage = element("div", "image-viewer-stage");
  const canvas = element("div", "image-viewer-canvas");
  const image = element("img");
  image.draggable = false;
  const loading = imageLoadState(image, { retry: () => {
    const src = image.getAttribute("src");
    if (!src) return;
    loading.loading(); image.removeAttribute("src"); image.src = src;
  } });
  canvas.append(image, loading.element);
  stage.append(canvas);
  toolbar.append(title, size, download, close);
  dialog.append(toolbar, stage);
  document.body.append(dialog);
  let ownedUrl = null,
    sequence = 0;
  const resize = (original) => {
    dialog.classList.toggle("original-size", original);
    size.textContent = original ? "适应窗口" : "原始尺寸";
    size.setAttribute("aria-pressed", String(original));
    stage.scrollTo(0, 0);
  };
  size.onclick = () => resize(!dialog.classList.contains("original-size"));
  image.ondblclick = size.onclick;
  close.onclick = () => dialog.close();
  stage.onclick = (event) => {
    if (event.target === stage || event.target === canvas) dialog.close();
  };
  const clear = () => {
    if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    ownedUrl = null;
    image.removeAttribute("src");
    download.removeAttribute("href");
  };
  dialog.addEventListener("close", () => {
    sequence++;
    clear();
  });
  return async (src, name, downloadRoute) => {
    const request = ++sequence;
    clear();
    resize(false);
    title.textContent = name;
    title.title = name;
    image.alt = name;
    loading.loading();
    image.src = src;
    image.referrerPolicy = "no-referrer";
    download.href = src;
    if (downloadRoute) download.dataset.downloadRoute = downloadRoute;
    else delete download.dataset.downloadRoute;
    const remote = /^https:\/\//.test(src);
    download.textContent = remote ? "打开原图" : "下载原图";
    if (remote) {
      download.removeAttribute("download");
      download.target = "_blank";
      download.rel = "noopener noreferrer";
    } else {
      download.download = name;
      download.removeAttribute("target");
    }
    dialog.showModal();
    close.focus();
    // Keep the original available if a background refresh releases the thumbnail URL.
    if (src.startsWith("blob:")) {
      try {
        const blob = await (await fetch(src)).blob();
        if (request !== sequence || !dialog.open) return;
        ownedUrl = URL.createObjectURL(blob);
        image.src = download.href = ownedUrl;
      } catch {
        /* The already displayed thumbnail remains available. */
      }
    }
  };
}

export function zoomableImage(image, name = image.alt || "image.png") {
  image.classList.add("zoomable-image");
  image.tabIndex = 0;
  image.setAttribute("role", "button");
  image.setAttribute("aria-haspopup", "dialog");
  image.setAttribute("aria-label", "放大查看：" + name);
  image.title = "点击放大查看";
  image.onclick = () => {
    const src = image.currentSrc || image.getAttribute("src");
    if (!src || image.hidden || image.classList.contains("image-pending")) return;
    (viewer ??= createViewer())(src, name, image.dataset.downloadRoute);
  };
  image.onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      image.click();
    }
  };
}
