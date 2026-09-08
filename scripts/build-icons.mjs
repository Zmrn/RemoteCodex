// Rasterize the editable SVG; encode a multi-resolution Windows ICO (PNG frames).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = await import(
  process.env.REMOTE_BRIDGE_PLAYWRIGHT || "playwright-core"
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const frames = [];
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const svg = fs.readFileSync(path.join(root, "public/app-icon.svg"), "utf8");
  for (const size of [16, 24, 32, 48, 64, 128, 192, 256, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`,
    );
    const png = await page.screenshot({ omitBackground: true });
    if ([192, 512].includes(size))
      fs.writeFileSync(path.join(root, `public/app-icon-${size}.png`), png);
    if (size <= 256) frames.push({ size, png });
  }
  const head = Buffer.alloc(6 + 16 * frames.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(frames.length, 4);
  let offset = head.length;
  frames.forEach(({ size, png }, i) => {
    const pos = 6 + 16 * i;
    head[pos] = head[pos + 1] = size === 256 ? 0 : size;
    head.writeUInt16LE(1, pos + 4);
    head.writeUInt16LE(32, pos + 6);
    head.writeUInt32LE(png.length, pos + 8);
    head.writeUInt32LE(offset, pos + 12);
    offset += png.length;
  });
  fs.writeFileSync(
    path.join(root, "public/app-icon.ico"),
    Buffer.concat([head, ...frames.map((f) => f.png)]),
  );
  console.log(
    "Built SVG-derived PNG 192/512 and ICO 16/24/32/48/64/128/192/256.",
  );
} finally {
  await browser.close();
}
