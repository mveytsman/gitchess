import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildSite } from "../dist/website/layout.js";
import { serveStatic } from "../dist/website/static.js";

async function request(url, method = "GET", root) {
  let status, headers, body;
  await serveStatic({ url, method }, {
    writeHead(code, values) { status = code; headers = values; },
    end(value) { body = value; },
  }, root);
  return { status, headers, body: body?.toString() ?? "" };
}

test("builds independent Markdown pages with working navigation and removes stale pages", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "gitchess-site-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "website");
  const output = join(dir, "public");
  mkdirSync(join(source, "pages"), { recursive: true });
  writeFileSync(join(source, "style.css"), "body { color: black; }");
  writeFileSync(join(source, "pages/about.md"), '# About & chess\n\nAn **independent** page.\n\n```sh\ngit chess move e4\n```\n');
  writeFileSync(join(source, "pages/help.md"), '# Help\n\n[About](/about/)\n');
  buildSite(source, output);
  const home = await request("/", "GET", output);
  assert.equal(home.status, 200);
  assert.match(home.body, /<strong>independent<\/strong>/);
  assert.match(home.body, /<title>About &amp; chess — gitchess<\/title>/);
  assert.match(home.body, /href="\/about\/" aria-current="page"/);
  assert.match(home.body, /href="\/help\/"/);
  assert.match(home.body, /<code class="language-sh">git chess move e4/);
  assert.doesNotMatch(home.body, /<script/);
  assert.equal((await request("/about/", "GET", output)).body, home.body);
  assert.equal((await request("/help/", "GET", output)).status, 200);
  rmSync(join(source, "pages/help.md"));
  buildSite(source, output);
  assert.equal((await request("/help/", "GET", output)).status, 404);
});

test("serves the built About page and stylesheet, including HEAD and query strings", async () => {
  const home = await request("/");
  assert.equal(home.status, 200);
  assert.match(home.headers["Content-Type"], /text\/html/);
  assert.match(home.body, /<main>\s*<h1>/);
  assert.equal((await request("/about/?from=test")).body, home.body);
  assert.equal((await request("/about")).body, home.body);
  const head = await request("/", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  assert.equal(head.headers["Content-Length"], Buffer.byteLength(home.body));
  const css = await request("/style.css");
  assert.equal(css.status, 200);
  assert.match(css.headers["Content-Type"], /text\/css/);
  assert.equal(css.body, readFileSync(new URL("../src/website/style.css", import.meta.url), "utf8"));
});

test("rejects unsupported methods, malformed URLs and paths outside the generated site", async () => {
  for (const url of ["/missing/", "/../index.html", "/%2e%2e/index.html", "/..%5cindex.html", "/%00", "/.git/config", "/src/web.ts"]) {
    assert.equal((await request(url)).status, 404, url);
  }
  assert.equal((await request("/%ZZ")).status, 400);
  const post = await request("/", "POST");
  assert.equal(post.status, 405);
  assert.equal(post.headers.Allow, "GET, HEAD");
  assert.equal((await request("/missing/", "HEAD")).body, "");
});
