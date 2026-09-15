# Library pictures — origin, author and licence

Every picture the Library ships is listed here; `tests/repo-gates.test.js`
fails the build on one that is not. Each file is under 100 KB.

All six pictures are Sand Art's own: renders of the sample jars in
`library/jars/`, which were made in the app — the real tools on the real
kernel, replayed from the recipes in `tools/library-recipes.mjs` by
`tools/library-build.mjs`. Nothing was copied from a photograph or from
any artist's work; each is a new picture in the style the entry describes.
The air in each is transparent, so the sheet draws it over the theme's
ground.

| File | What it shows | Origin | Author | Licence |
|------|---------------|--------|--------|---------|
| `clemens.png` | Bands, after Clemens: flat layers with diamonds, rings and zigzags laid into them | rendered from `jars/clemens.json` | Sand Art (Paul Gibeault) | MIT, as the repository |
| `petra.png` | Camel at Petra: poured, sloping layers, dunes, a camel, a palm, hills and the sun | rendered from `jars/petra.json` | Sand Art (Paul Gibeault) | MIT, as the repository |
| `mandala.png` | Rings, after a mandala: concentric rings and spokes on a dark ground | rendered from `jars/mandala.json` | Sand Art (Paul Gibeault) | MIT, as the repository |
| `alum-bay.png` | Alum Bay stripes: leaning layers in the earth-tone palette | rendered from `jars/alum-bay.json` | Sand Art (Paul Gibeault) | MIT, as the repository |
| `navajo.png` | Sprinkled bands: a stylised geometric pattern on tan sand, not a ceremonial design | rendered from `jars/navajo.json` | Sand Art (Paul Gibeault) | MIT, as the repository |
| `bonseki.png` | Moon over the sea: a monochrome landscape in light sand on a dark ground | rendered from `jars/bonseki.json` | Sand Art (Paul Gibeault) | MIT, as the repository |

To remake them all: `node tools/library-build.mjs` (needs a launcher checkout
beside this one, or `ARCADE_FLEET_ROOT`, with Playwright installed there).
