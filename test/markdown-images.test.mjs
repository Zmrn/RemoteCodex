import test from "node:test";
import assert from "node:assert/strict";
import { markdownImageAt, webImageUrl } from "../public/markdown-images.mjs";
test("Markdown images retain HTTPS sources, labels, parentheses and optional titles",()=>{
  for (const text of ['![样图](https://example.com/ui.png)', '![样图](<https://example.com/ui.png> "caption")', '![样图](https://example.com/a_(b).png)', '![样\\]图](https://example.com/ui.png)']) {
    const image=markdownImageAt(text,0);assert.equal(image.end,text.length);assert.ok(webImageUrl(image.url));assert.match(image.alt,/样/);
  }
  assert.equal(markdownImageAt('![unfinished](https://example.com/a.png',0),null);
  assert.equal(markdownImageAt('[ordinary](https://example.com/a.png)',0),null);
});
test("image embeds reject active content, credentials, plaintext and local destinations",()=>{
  for(const url of ['javascript:alert(1)','data:image/svg+xml,xxx','file:///C:/private.png','http://example.com/i.png','https://user:password@example.com/i.png','https://127.0.0.1/i.png','https://localhost/a.png','https://192.168.1.1/a.png','https://[::1]/a.png'])assert.equal(webImageUrl(url),null,url);
  assert.equal(webImageUrl('https://example.com/img.png?q=1#x'),'https://example.com/img.png?q=1#x');
});
