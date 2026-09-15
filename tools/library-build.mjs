// Build the Library's sample jars from their recipes.
//
// The jars in library/jars/ are made in the app — the real tools on the real
// kernel — and this is the hand that makes them: a headless Chromium (the
// launcher's Playwright) opens a lab page that loads the sand kernel from a
// launcher checkout, replays each recipe in tools/library-recipes.mjs, and
// hands back the settled grid. The kernel is deterministic, so a rebuild
// from unchanged recipes writes identical files.
//
// Needs a launcher checkout with the kernel and Playwright installed:
//   ARCADE_FLEET_ROOT=../paulgibeault.github.io node tools/library-build.mjs [id ...]
// The default root is the sibling checkout. Writes:
//   library/jars/<id>.json   the v2 gallery record (persist.js)
//   library/<id>.png         the jar, air transparent, 192×320
//
// Usage: node tools/library-build.mjs            # every recipe
//        node tools/library-build.mjs petra      # just one
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FLEET = path.resolve(ROOT, process.env.ARCADE_FLEET_ROOT || "../paulgibeault.github.io");
if (!fs.existsSync(path.join(FLEET, "sdk/v3/arcade-sim-sand.wasm"))) {
  console.error(`no kernel at ${FLEET}/sdk/v3/ — set ARCADE_FLEET_ROOT to a launcher checkout`);
  process.exit(1);
}
const { chromium } = createRequire(path.join(FLEET, "package.json"))("playwright");

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm",
  ".html": "text/html", ".json": "application/json", ".css": "text/css" };
const LAB = `<!doctype html><meta charset="utf-8"><title>library lab</title>
<script src="/sdk/v3/arcade-sim-sand.js"></script>
<script type="module">
  import { makeJar, RECIPE_IDS } from '/sand-art/tools/library-make.mjs';
  window.__lab = { makeJar, ids: RECIPE_IDS };
</script>`;

// One origin for the kernel and the app, the way the launcher serves them.
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      let file = null;
      if (url.pathname === "/lab/") { res.writeHead(200, { "content-type": "text/html" }); res.end(LAB); return; }
      if (url.pathname.startsWith("/sdk/")) file = path.join(FLEET, url.pathname);
      else if (url.pathname.startsWith("/sand-art/")) file = path.join(ROOT, url.pathname.slice("/sand-art/".length));
      if (!file || !file.startsWith(file.startsWith(FLEET) ? FLEET : ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end("not found: " + url.pathname); return;
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

const want = process.argv.slice(2);
const srv = await serve();
const origin = `http://127.0.0.1:${srv.address().port}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.error("console:", m.text()); });
  await page.goto(`${origin}/lab/`);
  await page.waitForFunction(() => window.__lab && window.ArcadeSimSand);
  const ids = want.length ? want : await page.evaluate(() => window.__lab.ids);
  fs.mkdirSync(path.join(ROOT, "library/jars"), { recursive: true });
  for (const id of ids) {
    const t0 = Date.now();
    const out = await page.evaluate((id) => window.__lab.makeJar(id), id);
    const jar = path.join(ROOT, "library/jars", `${id}.json`);
    const png = path.join(ROOT, "library", `${id}.png`);
    fs.writeFileSync(jar, JSON.stringify(out.record) + "\n");
    fs.writeFileSync(png, Buffer.from(out.png.split(",")[1], "base64"));
    const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0);
    console.log(`${id}: ${out.stats.strokes} strokes, ${out.stats.steps} steps, ${out.stats.floating} grains in the air, ` +
      `${Date.now() - t0} ms → ${kb(jar)} KB record, ${kb(png)} KB png`);
  }
} finally {
  await browser.close();
  srv.close();
}
