import test from "node:test";
import assert from "node:assert/strict";
import { citationParts, copyMarkdown, fenceStart, fenceEnd } from "../public/citations.mjs";
const cite = (...ids) => "\ue200cite\ue202" + ids.join("\ue202") + "\ue201";

test("opaque web citation IDs become stable per-message numbers, without guessed URLs", () => {
  const ids = new Map();
  assert.deepEqual(citationParts("正文" + cite("turn1view0", "turn2search1", "turn1view0") + "。", ids), [{text:"正文"},{refs:[1,2]},{text:"。"}]);
  assert.deepEqual(citationParts(cite("turn2search1"), ids), [{refs:[2]}]);
  assert.deepEqual(citationParts(cite("turn2search1")), [{refs:[1]}]);
});
test("incomplete streaming markers and malformed cite payloads have readable fallback", () => {
  for (const token of ["\ue200", "\ue200c", "\ue200ci", "\ue200cit", "\ue200cite", "\ue200cite\ue202turn1", cite(""), cite("<script>")])
    assert.deepEqual(citationParts("正文 " + token), [{text:"正文 "},{refs:[]}]);
  assert.deepEqual(citationParts("普通 turn1search0 文本 \ue200other\ue201"), [{text:"普通 turn1search0 文本 \ue200other\ue201"}]);
});
test("copy removes actual citation markup and preserves Markdown, links and literal code", () => {
  const marker = cite("turn1view0"), text = "**结论" + marker + "**\n- 内容" + marker + "\n[网页](https://example.com/)\n`" + marker + "`\n``" + marker + "``\n```text\n" + marker + "\n```\n~~~\n" + marker + "\n~~~";
  const copied = copyMarkdown(text);
  assert.ok(copied.startsWith("**结论[来源 1]**\n- 内容[来源 1]"));
  assert.equal((copied.match(/\ue200cite/g) ?? []).length, 4);
  assert.ok(copied.includes("[网页](https://example.com/)"));
  assert.ok(copied.endsWith("请在官方 ChatGPT 中查看来源。"));
  assert.equal(copyMarkdown("普通 `代码`\r\n文本"), "普通 `代码`\r\n文本");
});
test("longer and indented fences retain code until a matching delimiter", () => {
  const raw = "  ````\n```\n" + cite("turn0search0") + "\n  ````";
  assert.equal(copyMarkdown(raw), raw);
  assert.equal(fenceStart("  ~~~~js")[1], "~~~~");
  assert.equal(fenceEnd("~~~", "~~~~"), false);
  assert.equal(fenceEnd("  ~~~~~", "~~~~"), true);
});
