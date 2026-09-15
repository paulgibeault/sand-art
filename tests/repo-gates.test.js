/* Source-level gates: the floor every fleet app meets (GAME_INTEGRATION §13a),
 * plus the service-worker shape fleet CI's version rewrite depends on (§10).
 *
 * Deliberately about the SOURCE. What the published artifact must contain is
 * tools/verify-artifact.mjs's job, and it checks the staged output rather than
 * the checkout — the only way to catch a staging rule that drops a file the
 * game needs.
 */
import { test } from "node:test";
import assert from "node:assert";
import { execSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT, PRECACHE_EXCLUDE, isDevOnly } from "../tools/stage.mjs";

const tracked = execSync("git ls-files -z", { cwd: ROOT, encoding: "utf8" })
    .split("\0").filter(Boolean);

test("every tracked JS file parses", () => {
    for (const f of tracked.filter((f) => /\.(js|mjs)$/.test(f))) {
        const r = spawnSync(process.execPath, ["--check", f], { cwd: ROOT });
        assert.strictEqual(r.status, 0, `node --check ${f} failed:\n${r.stderr}`);
    }
});

test("every tracked JSON file parses", () => {
    for (const f of tracked.filter((f) => f.endsWith(".json"))) {
        assert.doesNotThrow(
            () => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")),
            `${f} is not valid JSON`);
    }
});

test("the pure modules import under node with no Arcade global in sight", async () => {
    // main.js reads Arcade at import time and is the one module that may.
    // Everything it imports must stay node-importable, or the suite below
    // stops being able to state a situation to a tool without a browser.
    assert.strictEqual(typeof globalThis.Arcade, "undefined");
    for (const m of ["../tools.js", "../palette.js", "../persist.js", "../template.js", "../hints.js",
        "../sheet.js", "../gallery-ui.js", "../library-ui.js", "../gestures.js", "../history.js", "../tools/library-recipes.mjs"]) {
        await assert.doesNotReject(() => import(m), `${m} touches the DOM or the SDK at import time`);
    }
});

// ---------------------------------------------------------------------------
// sw.js — the shape fleet CI rewrites, and the two rules of a shared origin
// ---------------------------------------------------------------------------

const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");

test("sw.js declares APP_VERSION in the exact form fleet-ci's sed targets", () => {
    // `grep -q "^const APP_VERSION = '"` then an anchored sed. Re-indenting,
    // double quotes or a rename turn the deploy-time rewrite into a silent
    // no-op: the cache identity freezes and every later fix reaches nobody.
    // Deliberately a shape check, not equality with package.json — that
    // false-fails any PR left open across a deploy (§10).
    assert.match(sw, /^const APP_VERSION = '[^']*';$/m);
    assert.match(sw, /^const GAME_ID = 'sand-art';/m, "GAME_ID must match Arcade.init({ gameId })");
    assert.match(sw, /^const CACHE_NAME = `\$\{GAME_ID\}-v\$\{APP_VERSION\}`;$/m,
        "CACHE_NAME must derive from APP_VERSION, never hardcode one");
});

test("sw.js carries the generated precache region inject-precache fills at stage time", () => {
    const begin = sw.indexOf("// arcade:precache-begin");
    const end = sw.indexOf("// arcade:precache-end");
    assert.ok(begin !== -1 && end > begin, "missing arcade:precache-begin/-end markers");
});

test("sw.js never precaches launcher-owned files", () => {
    // The SDK, the audio graph and the sand kernel (js + wasm) are served by
    // the launcher origin from /sdk/v3/. Caching them here pins this game to
    // a stale one and is what the SDK's cache audit reports as a console
    // error. verify-artifact.mjs rejects the first two; the kernel is ours to
    // remember.
    // Quoted strings only, the way verify-artifact reads the list: the
    // template's header names /arcade-sdk.js in prose, which is not a cache entry.
    assert.doesNotMatch(sw, /['"][^'"]*arcade-(?:sdk|audio|sim-sand)\.(?:js|wasm)['"]/);
});

test("sw.js cleans up only its own caches and never activates unannounced", () => {
    assert.match(sw, /\.filter\(\((\w+)\) => \1\.startsWith\(`\$\{GAME_ID\}-`\) && \1 !== CACHE_NAME\)/,
        "activate-time cleanup must be filtered to this game's prefix");
    assert.ok(sw.includes("'arcade:sw.skipWaiting'"), "the launcher's update control needs this message");
    assert.doesNotMatch(sw, /^\s*self\.skipWaiting\(\);/m, "no unconditional skipWaiting() on install");
    assert.match(sw, /if \(!url\.pathname\.startsWith\(SCOPE\)\) return;/, "the scope guard is the load-bearing line");
});

// ---------------------------------------------------------------------------
// staging declaration
// ---------------------------------------------------------------------------

test("stage.mjs publishes what the page and manifest name, and drops the dev set", () => {
    for (const f of ["index.html", "main.js", "tools.js", "palette.js", "persist.js",
        "template.js", "hints.js", "importer.js", "gallery-ui.js", "sheet.js",
        "library-ui.js", "library.json", "gestures.js", "history.js",
        "style.css", "manifest.json", "sw.js", "icon.svg", "icon.png"]) {
        assert.ok(tracked.includes(f), `${f} is not tracked`);
        assert.ok(!isDevOnly(f), `${f} would be dropped from the deploy`);
    }
    // The Library's jars and pictures ship; its SOURCES.md is prose and stays.
    const library = tracked.filter((f) => f.startsWith("library/"));
    assert.ok(library.some((f) => f.startsWith("library/jars/")), "no sample jars are tracked");
    for (const f of library) {
        assert.strictEqual(isDevOnly(f), f.endsWith(".md"), `${f}: ${f.endsWith(".md") ? "should stay behind" : "would be dropped from the deploy"}`);
    }
    for (const f of ["README.md", "package.json", ".gitignore", "tools/stage.mjs",
        "tests/repo-gates.test.js", ".github/workflows/pages.yml", "tools/library-build.mjs"]) {
        assert.ok(isDevOnly(f), `${f} would ship to the public site`);
    }
    assert.deepStrictEqual(PRECACHE_EXCLUDE, ["LICENSE"], "the exclusion list is meant to stay minimal");
});

// ---------------------------------------------------------------------------
// the Library's pictures
// ---------------------------------------------------------------------------

test("every picture the Library ships is accounted for in library/SOURCES.md", () => {
    // The licensing rule for samples (issue #4): a picture ships only with
    // its origin, author and licence written down beside it.
    const sources = fs.readFileSync(path.join(ROOT, "library/SOURCES.md"), "utf8");
    const pictures = tracked.filter((f) => /^library\/.*\.(png|jpe?g|webp|gif|svg)$/i.test(f));
    assert.ok(pictures.length > 0, "the Library ships no pictures at all");
    for (const f of pictures) {
        assert.ok(sources.includes(f.slice("library/".length)), `${f} is not listed in library/SOURCES.md`);
        assert.ok(fs.statSync(path.join(ROOT, f)).size <= 100 * 1024, `${f} is over 100 KB`);
    }
});

/* The two vendored fleet files (GAME_INTEGRATION.md §13a): never edit the
 * copy — change the canonical file in the launcher repo and re-copy. A local
 * edit forks this game's deploy verification in silence, so the drift is
 * worth failing a build over. The digest cannot prove the copy matches the
 * canonical original — nothing in this repo can — but it catches an
 * accidental in-place edit on every machine including CI.
 *
 * To update after a legitimate re-copy:
 *   shasum -a 256 tools/verify-artifact.mjs tools/inject-precache.mjs
 */
const VENDORED = {
    "tools/verify-artifact.mjs":
        "f89e40d579a1f85dd5402279bda444ad71861b9db794e3f45ba4ebbe536aa412",
    "tools/inject-precache.mjs":
        "7a8371071220cbfe8c281a67ff44b5685c7b2e8afb8c829137c70884fb9808e3",
};

test("the vendored fleet files have not been edited in place", () => {
    for (const [local, want] of Object.entries(VENDORED)) {
        const full = path.join(ROOT, local);
        assert.ok(fs.existsSync(full), `${local} is missing`);
        const got = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
        assert.strictEqual(got, want,
            `${local} has been edited. It is fleet property: change the canonical ` +
            "file in the launcher repo, re-copy it here, and update the digest in " +
            "tests/repo-gates.test.js.");
    }
});

test("the vendored fleet files match the canonical copies, when those are reachable", () => {
    // Opt-in through ARCADE_FLEET_ROOT (a launcher checkout). Absent — CI, a
    // fresh clone — the digest gate above is the floor, and this says so
    // instead of passing while checking nothing.
    const root = process.env.ARCADE_FLEET_ROOT;
    if (!root || !fs.existsSync(root)) {
        assert.ok(true, "no ARCADE_FLEET_ROOT: digest gate is the floor here");
        return;
    }
    for (const local of Object.keys(VENDORED)) {
        const src = path.join(root, local);
        if (!fs.existsSync(src)) continue;
        assert.strictEqual(fs.readFileSync(path.join(ROOT, local), "utf8"),
            fs.readFileSync(src, "utf8"), `${local} has drifted from ${src}`);
    }
});
