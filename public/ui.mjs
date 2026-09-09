export { markdown, inline } from "./markdown.mjs";
export { copyMarkdown } from "./citations.mjs";
const paths = {
  image: "M3 3h18v18H3Z M3 16l5-5 4 4 3-3 6 6 M15 7h.1",
  bolt: "m14 2-10 12h7l-1 8 10-12h-7Z",
  queue: "M4 5v10a2 2 0 0 0 2 2h12 m-3-3 3 3-3 3 M9 5h10 M9 9h7",
  steer: "M4 4v6a3 3 0 0 0 3 3h13 m-5-5 5 5-5 5",
  trash: "M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7",
  menu: "M5 8h14 M5 15h10",
  sidebar:
    "M8 3v18 M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z",
  back: "m14 5-7 7 7 7 M7 12h14",
  forward: "m10 5 7 7-7 7 M3 12h14",
  search: "M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Zm5.5-2 5 5",
  new: "M12 4H6a3 3 0 0 0-3 3v11a3 3 0 0 0 3 3h11a3 3 0 0 0 3-3v-6 M14 4l3-3 4 4-3 3-9 9-5 1 1-5Z M14 4l4 4",
  folder:
    "M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z M3 10h18",
  files: "M8 3h7l4 4v14H8Z M15 3v5h4 M5 5H3v15h2",
  device: "M3 4h18v13H3Z M8 21h8 M12 17v4",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M9 9a3 3 0 1 1 4 3c-1 .5-1 1-1 2 M12 17v.1",
  chevron: "m7 10 5 5 5-5",
  plus: "M12 4v16 M4 12h16",
  upload: "M12 16V3 m-5 5 5-5 5 5 M5 14v6h14v-6",
  external: "M13 3h8v8 M10 14 21 3 M9 3H3v18h18v-6",
  more: "M5 12h.1 M12 12h.1 M19 12h.1",
  refresh: "M20 7a9 9 0 1 0 1 8 M20 2v6h-6",
  close: "m6 6 12 12 M6 18 18 6",
  send: "M12 20V4 m-6 6 6-6 6 6",
  copy: "M8 8h13v13H8Z M16 5V2H2v14h3",
  check: "m5 12 4 4L20 5",
  shield: "m12 2 8 3v7c0 5-8 10-8 10S4 17 4 12V5Z M12 7v6 M12 16v.1",
  stop: "M7 7h10v10H7Z",
  download: "M12 3v12 m-5-5 5 5 5-5 M4 17v4h16v-4",
  settings: "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
};
export function icon(name) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [k, v] of Object.entries({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.5",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    n.setAttribute(k, v);
  const p = document.createElementNS(n.namespaceURI, "path");
  p.setAttribute("d", paths[name] ?? paths.more);
  n.append(p);
  return n;
}
