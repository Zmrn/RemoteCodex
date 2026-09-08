export function clipboardImage(data) {
  const files = [...(data?.files ?? [])];
  for (const item of data?.items ?? []) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file && !files.includes(file)) files.push(file);
    }
  }
  return files.find((file) => file.type.startsWith("image/")) ?? null;
}
export function validateImage(file) {
  if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw Error("请使用 PNG、JPEG 或 WebP 图片");
  if (!file.size || file.size > 5 * 1024 * 1024)
    throw Error("图片大小需在 5 MB 以内");
  return file;
}
