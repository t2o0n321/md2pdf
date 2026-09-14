#!/usr/bin/env node
"use strict";

/**
 * Cross-platform test suite.
 *
 * Written in Node rather than shell so the same commands run identically on
 * macOS, Linux and Windows -- a bash script would need a PowerShell twin, and
 * the two would drift.
 *
 * Run with:  npm test
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "bin", "md2pdf.js");
const FIXTURES = path.join(__dirname, "fixtures");
/**
 * Output directory.
 *
 * Defaults to a throwaway temp directory. Set MD2PDF_TEST_OUT to keep the
 * rendered PDFs at a known path -- CI points it inside the workspace so a
 * failing run can upload them for inspection.
 */
const KEEP_OUTPUT = Boolean(process.env.MD2PDF_TEST_OUT);
const OUT = KEEP_OUTPUT
  ? path.resolve(process.env.MD2PDF_TEST_OUT)
  : fs.mkdtempSync(path.join(os.tmpdir(), "md2pdf-test-"));
fs.mkdirSync(OUT, { recursive: true });

let passed = 0;
const failures = [];

/**
 * Always invokes the CLI through process.execPath.
 *
 * That is the node binary currently running, so the test never depends on
 * `node` being on PATH and never goes near npm's .cmd shim on Windows.
 */
function md2pdf(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { code: r.status, output: `${r.stdout || ""}${r.stderr || ""}` };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ok    ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failures.push(name);
  }
}

/** Reads the page box straight out of the PDF, in points. */
function pageSize(file) {
  const bytes = fs.readFileSync(file).toString("latin1");
  const m = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(bytes);
  assert(m, `no /MediaBox found in ${file}`);
  return { width: +m[3] - +m[1], height: +m[4] - +m[2] };
}

function pageCount(file) {
  const bytes = fs.readFileSync(file).toString("latin1");
  return (bytes.match(/\/Type\s*\/Page[^s]/g) || []).length;
}

function sizeOf(file) {
  return fs.existsSync(file) ? fs.statSync(file).size : 0;
}

/**
 * Renders a built HTML file and returns the DOM as the page leaves it.
 *
 * Anything the page builds at runtime -- callouts, wikilinks, highlights --
 * is absent from the file --keep-html writes, and asserting against that file
 * silently passes: strings like `data-callout="note"` live in the template's
 * own CSS and JS whether or not the transform ever ran.
 */
function renderedDom(htmlPath) {
  const r = spawnSync(process.execPath, [path.join(__dirname, "dom.js"), htmlPath], {
    encoding: "utf8",
  });
  assert(r.status === 0, `dom.js failed: ${(r.stderr || "").trim()}`);
  return r.stdout;
}

/**
 * Computed styles of matched elements, for the rules that only exist in CSS.
 *
 * `<td align="center">` keeps that attribute whatever the stylesheet does, so
 * asserting on the markup proves nothing about where the text ends up.
 */
function computed(htmlPath, selector, props, ...flags) {
  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, "computed.js"), htmlPath, selector, props, ...flags],
    { encoding: "utf8" }
  );
  assert(r.status === 0, `computed.js failed: ${(r.stderr || "").trim()}`);
  return JSON.parse(r.stdout);
}

/**
 * Opens a written .svg in a browser and reports what parsed.
 *
 * Asserting on the file's text would pass for a file that is malformed XML or
 * draws nothing, which are exactly the two ways an exported diagram goes
 * wrong without looking wrong.
 */
const svgCache = new Map();
function inspectSvg(file) {
  // Memoised: each call is a browser launch, and the same file is asserted
  // against from several tests.
  if (!svgCache.has(file)) {
    const r = spawnSync(process.execPath, [path.join(__dirname, "svg.js"), file], {
      encoding: "utf8",
    });
    assert(r.status === 0, `svg.js failed for ${file}: ${(r.stderr || "").trim()}`);
    svgCache.set(file, JSON.parse(r.stdout));
  }
  return svgCache.get(file);
}

/**
 * Reads a PNG's IHDR: dimensions and colour type, straight from the bytes.
 *
 * Colour type 6 is RGBA and 2 is RGB, which is how "--background transparent
 * actually produced an alpha channel" is checked without an image library.
 */
function pngInfo(file) {
  const b = fs.readFileSync(file);
  assert(
    b.length > 33 && b.readUInt32BE(0) === 0x89504e47,
    `${file} is not a PNG (${b.length} bytes)`
  );
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] };
}

/**
 * The top-left pixel of a PNG, as {r,g,b,a}.
 *
 * Reading the colour TYPE is not enough to prove a background: Chrome is free
 * to write an RGBA image whose alpha is 255 everywhere, so "has an alpha
 * channel" and "is transparent" are different claims. This reads the pixel.
 *
 * Only the first pixel of the first scanline is decoded, which is why the
 * filter byte can be ignored: with no pixel to the left and no row above, all
 * five PNG filters reduce to the raw value there.
 */
function pngCornerPixel(file) {
  const b = fs.readFileSync(file);
  const chunks = [];
  let depth, colorType, interlace;
  for (let i = 8; i + 8 <= b.length; ) {
    const len = b.readUInt32BE(i);
    const type = b.toString("ascii", i + 4, i + 8);
    if (type === "IHDR") {
      depth = b[i + 16];
      colorType = b[i + 17];
      interlace = b[i + 20];
    }
    if (type === "IDAT") chunks.push(b.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  assert(depth === 8, `${file}: expected 8-bit samples, got ${depth}`);
  assert(interlace === 0, `${file}: expected a non-interlaced PNG`);
  assert(colorType === 2 || colorType === 6, `${file}: unexpected colour type ${colorType}`);
  const raw = require("zlib").inflateSync(Buffer.concat(chunks));
  return {
    r: raw[1],
    g: raw[2],
    b: raw[3],
    a: colorType === 6 ? raw[4] : 255,
  };
}

/** The image files one export run produced, in name order. */
function exported(dir) {
  return fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /\.(svg|png)$/.test(f)).sort()
    : [];
}

console.log(`md2pdf test suite  (${process.platform}, node ${process.versions.node})\n`);

test("renders a document with diagrams, formulas, tables and CJK", () => {
  const out = path.join(OUT, "sample.pdf");
  const r = md2pdf(path.join(FIXTURES, "sample.md"), "-o", out);
  assert(
    r.code === 0,
    `expected success, got exit ${r.code}.\n        ${r.output.trim().split("\n").join("\n        ")}`
  );
  assert(sizeOf(out) > 10000, `PDF is suspiciously small (${sizeOf(out)} bytes)`);
  assert(/2\/2 diagrams/.test(r.output), `expected 2/2 diagrams, got: ${r.output.trim()}`);
  assert(/1 formulas/.test(r.output), `expected 1 formula, got: ${r.output.trim()}`);
});

test("rejects a malformed diagram instead of shipping a broken PDF", () => {
  const r = md2pdf(path.join(FIXTURES, "broken.md"), "-o", path.join(OUT, "broken.pdf"));
  assert(r.code !== 0, "expected a non-zero exit for an unparseable diagram");
  assert(
    /0\/1 mermaid diagrams rendered/.test(r.output),
    `expected the failure to name the diagram count, got: ${r.output.trim()}`
  );
});

test("--no-verify overrides the rejection", () => {
  const out = path.join(OUT, "broken-forced.pdf");
  const r = md2pdf(path.join(FIXTURES, "broken.md"), "--no-verify", "-o", out);
  assert(r.code === 0, `expected success with --no-verify, got exit ${r.code}`);
  assert(sizeOf(out) > 0, "expected a PDF to be produced anyway");
});

test("--format is validated and reports the valid values", () => {
  const r = md2pdf(path.join(FIXTURES, "sample.md"), "--format", "B7");
  assert(r.code !== 0, "expected a non-zero exit for an unknown paper size");
  assert(/Valid formats:/.test(r.output), `expected the valid list, got: ${r.output.trim()}`);
});

test("--format Letter produces US Letter", () => {
  const out = path.join(OUT, "letter.pdf");
  const r = md2pdf(path.join(FIXTURES, "sample.md"), "--format", "letter", "-o", out);
  assert(r.code === 0, `expected success, got exit ${r.code}`);
  const { width, height } = pageSize(out);
  // 8.5 x 11 in at 72 pt/in, allowing for rounding.
  assert(Math.abs(width - 612) < 2, `expected width 612pt, got ${width}`);
  assert(Math.abs(height - 792) < 2, `expected height 792pt, got ${height}`);
});

test("--landscape swaps the page orientation", () => {
  const out = path.join(OUT, "landscape.pdf");
  const r = md2pdf(path.join(FIXTURES, "sample.md"), "--format", "A5", "--landscape", "-o", out);
  assert(r.code === 0, `expected success, got exit ${r.code}`);
  const { width, height } = pageSize(out);
  assert(width > height, `expected landscape, got ${width} x ${height}`);
});

test("--page-numbers and --title are accepted", () => {
  const out = path.join(OUT, "numbered.pdf");
  const r = md2pdf(
    path.join(FIXTURES, "sample.md"), "--page-numbers", "--title", "CI", "-o", out
  );
  assert(r.code === 0, `expected success, got exit ${r.code}`);
  assert(sizeOf(out) > 0, "expected a PDF");
});

test("--keep-html writes the intermediate HTML", () => {
  const html = path.join(OUT, "kept.html");
  const r = md2pdf(
    path.join(FIXTURES, "sample.md"), "--keep-html", html, "-o", path.join(OUT, "kept.pdf")
  );
  assert(r.code === 0, `expected success, got exit ${r.code}`);
  assert(sizeOf(html) > 0, "expected the HTML to be kept");
});

test("output directories are created as needed", () => {
  const out = path.join(OUT, "nested", "deeper", "out.pdf");
  const r = md2pdf(path.join(FIXTURES, "sample.md"), "-o", out);
  assert(r.code === 0, `expected success, got exit ${r.code}`);
  assert(sizeOf(out) > 0, "expected a PDF in the created directory");
});

test("a missing input file fails cleanly", () => {
  const r = md2pdf(path.join(FIXTURES, "does-not-exist.md"));
  assert(r.code !== 0, "expected a non-zero exit for a missing input");
});

test("PATH probing never resolves a bare command to an extensionless file on Windows", () => {
  const { executableCandidates } = require("../lib/commandRunner");

  // npm ships `npm` (a shell script) next to `npm.cmd`. Probing the bare name
  // finds the script, which CreateProcess cannot launch -> spawn ENOENT.
  const npm = executableCandidates("npm", "win32", ".COM;.EXE;.CMD;.BAT");
  assert(!npm.includes("npm"), `bare "npm" must not be probed on Windows, got ${npm.join(", ")}`);
  assert(npm.includes("npm.CMD"), `expected npm.CMD among candidates, got ${npm.join(", ")}`);

  // An explicit extension is used verbatim, never suffixed again.
  const chrome = executableCandidates("chrome.exe", "win32", ".COM;.EXE;.CMD;.BAT");
  assert(
    chrome.length === 1 && chrome[0] === "chrome.exe",
    `expected ["chrome.exe"], got ${chrome.join(", ")}`
  );

  // POSIX probes the name as given.
  const posix = executableCandidates("npm", "linux");
  assert(
    posix.length === 1 && posix[0] === "npm",
    `expected ["npm"] on linux, got ${posix.join(", ")}`
  );
});

test("font family quoting follows CSS rules", () => {
  const { fontPrefix, cssLength } = require("../lib/buildHtml");

  const eq = (actual, expected, what) =>
    assert(actual === expected, `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

  eq(fontPrefix("Times New Roman"), '"Times New Roman", ', "a name with spaces must be quoted");
  eq(fontPrefix("Georgia"), "Georgia, ", "a bare identifier needs no quotes");

  // Quoting a generic family turns it into a request for a font literally
  // named "serif", which does not exist -- the fallback silently stops working.
  eq(fontPrefix("serif"), "serif, ", "generic families must stay unquoted");
  eq(fontPrefix("monospace"), "monospace, ", "generic families must stay unquoted");

  eq(fontPrefix("Noto Serif CJK TC, serif"), '"Noto Serif CJK TC", serif, ', "comma-separated list");
  eq(fontPrefix(null), "", "no value yields no prefix");

  eq(cssLength(14, "12.5px"), "14px", "a bare number is px");
  eq(cssLength("11pt", "12.5px"), "11pt", "an explicit unit is kept");
  eq(cssLength(null, "12.5px"), "12.5px", "falls back to the default");
});

test("--font, --mono-font and --font-size reach the page, keeping the fallbacks", () => {
  const html = path.join(OUT, "fonts.html");
  const r = md2pdf(
    path.join(FIXTURES, "sample.md"),
    "--font", "Times New Roman",
    "--mono-font", "Courier New",
    "--font-size", "18",
    "--keep-html", html,
    "-o", path.join(OUT, "fonts.pdf")
  );
  assert(r.code === 0, `expected success, got exit ${r.code}`);

  const css = fs.readFileSync(html, "utf8");
  assert(/font-size:\s*18px/.test(css), "--font-size did not reach the stylesheet");
  assert(/"Courier New",\s*ui-monospace/.test(css), "--mono-font did not reach the stylesheet");

  // Prepended, not substituted: a face that cannot draw CJK must still fall
  // through to the bundled CJK stack rather than rendering empty boxes.
  assert(
    /"Times New Roman",\s*"PingFang TC"/.test(css),
    "--font replaced the fallback chain instead of prepending to it"
  );
  assert(!/__[A-Z_]+__/.test(css), "an unsubstituted placeholder was left in the output");
});

test("--scale changes how much content fits on a page", () => {
  const small = path.join(OUT, "scale-small.pdf");
  const large = path.join(OUT, "scale-large.pdf");
  const a = md2pdf(path.join(FIXTURES, "sample.md"), "--scale", "0.5", "-o", small);
  const b = md2pdf(path.join(FIXTURES, "sample.md"), "--scale", "2", "-o", large);
  assert(a.code === 0 && b.code === 0, "expected both renders to succeed");
  assert(
    pageCount(large) > pageCount(small),
    `expected scale 2 to need more pages than scale 0.5, got ${pageCount(large)} vs ${pageCount(small)}`
  );
});

test("--scale and --font-size reject out-of-range values", () => {
  const cases = [["--scale", "5"], ["--scale", "abc"], ["--font-size", "0"], ["--font-size", "-3"]];
  for (const args of cases) {
    const r = md2pdf(path.join(FIXTURES, "sample.md"), ...args, "-o", path.join(OUT, "rejected.pdf"));
    assert(r.code !== 0, `expected "${args.join(" ")}" to be rejected`);
    assert(
      /Invalid --/.test(r.output),
      `expected a validation message for "${args.join(" ")}", got: ${r.output.trim()}`
    );
  }
});

test("a diagram taller than the page is scaled to fit instead of being sliced", () => {
  // break-inside:avoid cannot save an element taller than the page -- the
  // browser has to split it, and a node gets cut in half across the break.
  // The fixture is a single tall flowchart and nothing else, so "one page"
  // is exactly the assertion that it was not split.
  //
  // A6 landscape is the worst case in the whole format matrix: its content
  // box is only ~268px tall, which is where a percentage-only height limit
  // stops working.
  for (const args of [[], ["--format", "A6", "--landscape"]]) {
    const out = path.join(OUT, `tall-${args.length ? "a6l" : "a4"}.pdf`);
    const r = md2pdf(path.join(FIXTURES, "tall-diagram.md"), ...args, "-o", out);
    assert(r.code === 0, `expected success for ${args.join(" ") || "A4"}, got exit ${r.code}`);
    assert(
      pageCount(out) === 1,
      `tall diagram was split across ${pageCount(out)} pages at ${args.join(" ") || "A4"}`
    );
  }
});

test("Obsidian embeds, callouts, wikilinks and highlights are rendered", () => {
  const html = path.join(OUT, "obsidian.html");
  const r = md2pdf(
    path.join(FIXTURES, "obsidian", "note.md"),
    "--keep-html", html,
    "-o", path.join(OUT, "obsidian.pdf")
  );
  assert(r.code === 0, `expected success, got exit ${r.code}.\n        ${r.output.trim()}`);

  // Embeds are resolved in node, so they are already in the built file.
  const built = fs.readFileSync(html, "utf8");
  // ![[sample.png]] resolved from the sibling images/ folder to an absolute
  // file: URL -- a relative one would break, the HTML lives in a temp dir.
  assert(/<img[^>]+src="file:\/\/[^"]*sample\.png"/.test(built), "embed was not resolved to a file: URL");
  // ![[sample.png|120]] -- Obsidian's width suffix.
  assert(/<img[^>]+width="120"/.test(built), "the |120 size suffix was not applied");
  // Both images must actually decode, not merely be referenced.
  assert(/2\/2 images/.test(r.output), `expected 2/2 images, got: ${r.output.trim()}`);

  // Everything below is built by the page at runtime, so it has to be read
  // back from the rendered DOM.
  const dom = renderedDom(html);

  assert(/data-callout="note"/.test(dom), "[!NOTE] did not become a callout");
  assert(/data-callout="warning"/.test(dom), "lower-case [!warning] did not become a callout");
  assert(/data-callout="tip"/.test(dom), "[!TIP]- did not become a callout");
  assert(/>Custom title</.test(dom), "a callout's custom title was not used");
  assert(!/\[!NOTE\]/.test(dom), "the literal [!NOTE] marker was left in the output");

  assert(/class="wikilink">Linked Note</.test(dom), "[[wikilink]] was not rendered");
  assert(/class="wikilink">alias for it</.test(dom), "[[target|alias]] did not use the alias");
  assert(/<mark>highlighted text<\/mark>/.test(dom), "==highlight== was not rendered");
});

test("Obsidian markup inside code blocks is left alone", () => {
  // The whole point: these notes are full of shell snippets. Rewriting the
  // markdown with a regex would turn `==` or `[[` inside a code sample into
  // markup and silently corrupt the command being documented.
  const html = path.join(OUT, "obsidian-code.html");
  const r = md2pdf(
    path.join(FIXTURES, "obsidian", "note.md"),
    "--keep-html", html,
    "-o", path.join(OUT, "obsidian-code.pdf")
  );
  assert(r.code === 0, `expected success, got exit ${r.code}`);

  // Read the rendered DOM, not the built file: the built file still carries
  // the raw markdown in a <script> block, so every literal below would be
  // trivially "present" there and the assertions would prove nothing.
  const dom = renderedDom(html);

  for (const literal of [
    "![[should-stay-literal.png]]",
    "[[not-a-wikilink]]",
    "==not-a-highlight==",
    "![[also-literal.png]]",
    "[[also-not-a-link]]",
    "==also-plain==",
  ]) {
    assert(dom.includes(literal), `code content was rewritten: ${literal} is missing`);
  }
  assert(!/src="[^"]*should-stay-literal/.test(dom), "an embed inside a fence became an image");
  assert(!/wikilink">not-a-wikilink/.test(dom), "a wikilink inside code was linkified");
  assert(!/<mark>not-a-highlight/.test(dom), "a highlight inside code was marked up");
});

test("an embed that cannot be found is reported, not silently blank", () => {
  const r = md2pdf(
    path.join(FIXTURES, "obsidian", "missing-embed.md"),
    "-o", path.join(OUT, "missing-embed.pdf")
  );
  assert(r.code !== 0, "expected a non-zero exit when an embedded file is missing");
  assert(
    /could not be found/.test(r.output) && /definitely-not-here/.test(r.output),
    `expected the missing filename to be named, got: ${r.output.trim()}`
  );
});

// ---------------------------------------------------------------------------
// Raw HTML, which Markdown allows anywhere and which documents actually use
// ---------------------------------------------------------------------------

const HTML_PAGE = path.join(FIXTURES, "html", "page.md");
const HTML_BUILT = path.join(OUT, "html-page.html");

// One render, several tests: each browser launch costs a second or two, and
// every assertion below is about the same document.
let htmlRun = null;
function htmlPage() {
  if (!htmlRun) {
    const r = md2pdf(HTML_PAGE, "-o", path.join(OUT, "html-page.pdf"), "--keep-html", HTML_BUILT);
    htmlRun = r;
  }
  return htmlRun;
}

test("relative images resolve against the markdown, not the temp HTML", () => {
  // The built page lives in a temp directory, so `images/left.png` -- written
  // by hand in an <img>, or as a markdown image -- resolves next to the temp
  // file and is missing. This is the bug that made hand-written HTML tables of
  // screenshots print blank.
  const r = htmlPage();
  assert(r.code === 0, `expected success, got exit ${r.code}.\n        ${r.output.trim()}`);
  assert(/5\/5 images/.test(r.output), `expected all 5 images to load, got: ${r.output.trim()}`);

  // ...and the fenced <img> sample is not counted as an image to find.
  const dom = renderedDom(HTML_BUILT);
  assert(
    dom.includes("&lt;img src=\"images/does-not-exist.png\"&gt;"),
    "the fenced <img> sample was not left alone"
  );
});

test("markup that is quoted is not counted as markup that is present", () => {
  // The counts in inspect() decide whether the render is accepted, so anything
  // they misread is a document that cannot be converted at all. Every form
  // below appears in an ordinary README -- this project's own included -- and
  // each one used to be read as a claim: a ```mermaid fence nested inside a
  // ````markdown example, $$ inside that example, an <img> in a code span, and
  // an <img> inside an HTML comment.
  // Exit 0 IS the assertion: a miscount makes the source claim a diagram or a
  // formula the page then cannot produce, and verification refuses the whole
  // document -- "source declares 1 mermaid block(s) but the page found none".
  const r = htmlPage();
  assert(r.code === 0, `expected success, got exit ${r.code}.\n        ${r.output.trim()}`);
  assert(/0\/0 diagrams/.test(r.output), `the nested fence was miscounted: ${r.output.trim()}`);
  assert(/0 formulas/.test(r.output), `quoted $$ was counted as a formula: ${r.output.trim()}`);
  // The comment survives as a comment node, which is the point -- what must
  // not happen is it being counted as an image the render has to produce.
  const commented = computed(HTML_BUILT, 'img[src*="in-a-comment"]', "display");
  assert(commented.length === 0, "an <img> inside an HTML comment was rendered");
});

test("what only breaks on paper: wrapping, lazy images, explicit heights", () => {
  htmlPage();
  // overflow-x:auto is a screen affordance. In print there is no scrollbar, so
  // anything past the column edge is simply not in the file -- and a truncated
  // command still looks like a command.
  // Every block, not the first one: the short ones fit whatever the rule says,
  // so checking only those passes with the clipping fully in place.
  const pres = computed(HTML_BUILT, "pre", "white-space", "--print");
  assert(pres.length >= 3, `expected several code blocks, found ${pres.length}`);
  for (const pre of pres) {
    assert(
      pre.scrollWidth <= pre.clientWidth + 1,
      `a code line is clipped in print: ${pre.scrollWidth}px of content in ` +
        `${pre.clientWidth}px (${pre.text.slice(0, 30)})`
    );
  }

  // loading="lazy" below the fold means "never" in a headless window: the wait
  // for images never finishes and the run dies on the 90s timeout.
  const lazy = computed(HTML_BUILT, 'img[alt="lazy"]', "display");
  assert(lazy.length === 1 && lazy[0].width > 0, "the lazy image never loaded");

  // height="" is how every badge row is written.
  const [badge] = computed(HTML_BUILT, 'img[height="14"]', "height");
  assert(badge && badge.props.height === "14px", `badge height ignored: ${JSON.stringify(badge)}`);
});

test("== in prose is an operator, not a highlight", () => {
  htmlPage();
  // The highlight rule used to match from the first `==` to the second, which
  // swallowed the operators and everything between them into a yellow block.
  const dom = renderedDom(HTML_BUILT);
  assert(dom.includes("(a == b) and (c == d)"), `the comparison was eaten: ${dom.slice(0, 300)}`);
  assert(/<mark>this really is one<\/mark>/.test(dom), "a real highlight stopped working");
});

test("align and valign survive on hand-written and pipe tables alike", () => {
  htmlPage();
  // Presentational attributes lose to any author rule, so `th, td { text-align:
  // left }` silently flattened every centred cell -- in raw HTML and in pipe
  // tables both, since marked emits the same attribute for |:---:|.
  const cells = computed(HTML_BUILT, "td[align], th[align]", "text-align");
  assert(cells.length >= 5, `expected aligned cells, found ${cells.length}`);
  for (const cell of cells) {
    assert(
      cell.props["text-align"] !== "left" || /Left|^a$/.test(cell.text),
      `a cell aligned in the source rendered left: ${JSON.stringify(cell)}`
    );
  }
  const centred = cells.filter((c) => c.props["text-align"] === "center");
  const right = cells.filter((c) => c.props["text-align"] === "right");
  assert(centred.length >= 3, `expected centred cells, got ${centred.length}`);
  assert(right.length >= 2, `expected right-aligned cells, got ${right.length}`);

  const vertical = computed(HTML_BUILT, "td[valign]", "vertical-align").map(
    (c) => c.props["vertical-align"]
  );
  assert(
    vertical.includes("middle") && vertical.includes("bottom"),
    `valign was overridden by the stylesheet: ${vertical.join(", ")}`
  );
});

test("a <details> block is opened, so its content is in the PDF", () => {
  htmlPage();
  // Nothing in a PDF can expand a disclosure widget. Left collapsed, the body
  // is simply not in the file, and nothing else here would notice.
  //
  // Measured as "the block is taller than its own summary", not as the body's
  // own height: a closed <details> hides its subtree with content-visibility,
  // and Chrome still reports a box for elements inside it, so asking the
  // paragraph how tall it is answers yes either way.
  const [box] = computed(HTML_BUILT, "details", "display");
  const [summary] = computed(HTML_BUILT, "details > summary", "display");
  assert(box && summary, "no <details> in the rendered document");
  assert(
    box.height > summary.height + 8,
    `the details block printed collapsed: ${box.height}px for a ${summary.height}px summary`
  );
});

test("headings get ids, so a table of contents still jumps in the PDF", () => {
  const r = htmlPage();
  assert(r.code === 0, `expected success, got exit ${r.code}`);
  const dom = renderedDom(HTML_BUILT);
  assert(/<h2 id="side-by-side"/.test(dom), `no GitHub-style heading id: ${dom.slice(0, 200)}`);
  assert(/<h2 id="collapsed-detail"/.test(dom), "heading id was not slugged as GitHub does");

  // Chrome prints a bare href="#x" as a real internal destination, but only if
  // something has that id -- and marked stopped emitting them in v12. Checked
  // in the PDF itself, because that is where it either works or does not.
  const pdf = fs.readFileSync(path.join(OUT, "html-page.pdf"), "latin1");
  assert(pdf.includes("/Dest"), "the PDF has no internal link destinations");
});

test("footnotes are rendered instead of being swallowed", () => {
  htmlPage();
  // To CommonMark `[^why]: text` is a link reference definition, so without
  // handling the note is consumed as a URL and vanishes, while `[^why]` in the
  // prose prints as a link reading "^why".
  const dom = renderedDom(HTML_BUILT);
  assert(/<sup class="fnref" id="fnref-1"/.test(dom), "the footnote marker was not rendered");
  assert(
    dom.includes("link reference definition"),
    "the footnote's own text is missing from the document"
  );
  assert(
    dom.includes("A second paragraph, indented"),
    "the indented continuation of a footnote was dropped"
  );
  // Referenced twice, numbered once.
  assert(
    (dom.match(/href="#fn-1"/g) || []).length === 2,
    "the second reference to the same note did not reuse its number"
  );
  // A character class in prose is not a footnote: there is no definition for it.
  assert(dom.includes("[^a-z]"), "a regex character class was mistaken for a footnote");
  // A definition nothing refers to is dropped, as on GitHub.
  assert(!dom.includes("Nothing refers to this one"), "an unreferenced definition was printed");
});

test("a CRLF checkout is read the same as an LF one", () => {
  // git checks a document out with CRLF on Windows by default, and every
  // line-oriented pass here anchors with `$` -- which in JavaScript matches the
  // end of the STRING, while `.` refuses to match "\r". A line ending in "\r"
  // therefore fails to match a pattern that works everywhere else, silently,
  // and only on the one platform nobody develops on.
  //
  // Both variants are written here rather than trusting the fixture's own
  // endings, which are whatever git happened to check out.
  const { buildHtml } = require("../lib/buildHtml");
  const { transformFootnotes } = require("../lib/footnotes");

  const source = [
    "# Doc",
    "",
    "A marker[^why] here.",
    "",
    "```mermaid",
    "flowchart LR",
    "    A --> B",
    "```",
    "",
    "An example fence, quoted inside a wider one:",
    "",
    "````",
    "```mermaid",
    "QuotedNotADiagram",
    "```",
    "````",
    "",
    "[^why]: the note body",
    "",
  ].join("\n");

  const built = {};
  for (const [ending, text] of [["lf", source], ["crlf", source.replace(/\n/g, "\r\n")]]) {
    const input = path.join(OUT, `line-endings-${ending}.md`);
    const output = path.join(OUT, `line-endings-${ending}.html`);
    fs.writeFileSync(input, text, "utf8");
    const result = buildHtml({ input, output });
    built[ending] = { html: fs.readFileSync(output, "utf8"), expects: result.expects };
  }

  // The footnote definition stops being recognised when the line ends in "\r",
  // and marked then eats it as a link reference definition: the note vanishes
  // from the document and the marker prints as a link reading "^why".
  for (const ending of ["lf", "crlf"]) {
    assert(
      /<sup class="fnref"/.test(built[ending].html),
      `the footnote was swallowed in the ${ending.toUpperCase()} document`
    );
  }

  // The fence scanner goes blind for the same reason, which both zeroes the
  // declared diagram count -- disarming the "declares N diagrams, page found
  // none" check -- and stops quoted example fences being excluded from the
  // prose, so their contents get read as claims about the document.
  assert(
    built.lf.expects.mermaid === 1 && built.crlf.expects.mermaid === 1,
    `the quoted fence was miscounted: LF saw ${built.lf.expects.mermaid}, ` +
      `CRLF saw ${built.crlf.expects.mermaid}, both should see 1`
  );

  // Nothing else may differ either.
  assert(
    built.lf.html === built.crlf.html,
    "the two checkouts produced different documents"
  );

  // And the footnote module is an exported entry point, so it has to be right
  // on its own rather than relying on its caller to normalise first.
  assert(
    transformFootnotes(source.replace(/\n/g, "\r\n")).used.length === 1,
    "transformFootnotes did not recognise a definition in a CRLF document"
  );
});

// ---------------------------------------------------------------------------
// md2pdf mermaid -- one image file per diagram, and nothing else
// ---------------------------------------------------------------------------

const DIAGRAMS = path.join(FIXTURES, "diagrams.md");
const MIXED = path.join(FIXTURES, "mixed-diagrams.md");
const NO_DIAGRAMS = path.join(FIXTURES, "obsidian", "note.md");
const SVG_OUT = path.join(OUT, "mermaid-svg");

test("exports one SVG per diagram and skips everything else", () => {
  const r = md2pdf("mermaid", DIAGRAMS, "-o", SVG_OUT);
  assert(
    r.code === 0,
    `expected success, got exit ${r.code}.\n        ${r.output.trim().split("\n").join("\n        ")}`
  );
  assert(
    exported(SVG_OUT).join(",") === "diagrams-01.svg,diagrams-02.svg,diagrams-03.svg",
    `expected three numbered SVGs, got: ${exported(SVG_OUT).join(", ") || "(nothing)"}`
  );
  // The fixture also holds prose, a table, a checklist and a $$formula$$. None
  // of it is a diagram, so none of it may produce a file -- and no PDF either.
  const everything = fs.readdirSync(SVG_OUT).sort();
  assert(
    everything.length === 3,
    `only the diagrams should have been written, got: ${everything.join(", ")}`
  );
});

test("extraction follows the markdown parser, not a regex over the source", () => {
  const one = inspectSvg(path.join(SVG_OUT, "diagrams-01.svg"));
  const two = inspectSvg(path.join(SVG_OUT, "diagrams-02.svg"));
  const three = inspectSvg(path.join(SVG_OUT, "diagrams-03.svg"));

  // A ~~~tilde fence and a fence indented inside a list item are both
  // invisible to /^```mermaid$/m, and both must still be exported, in
  // document order. Counting three files is not enough on its own: two
  // opposite mistakes would still total three.
  assert(
    /使用者/.test(two.labels),
    `the tilde-fenced sequence diagram was not exported (got: ${two.labels.slice(0, 80)})`
  );
  assert(
    /Working/.test(three.labels),
    `the list-indented state diagram was not exported (got: ${three.labels.slice(0, 80)})`
  );
  // ...and a mermaid fence QUOTED inside a wider fence is documentation about
  // mermaid, not a diagram. A regex counts it; a parser does not.
  for (const [name, svg] of [["01", one], ["02", two], ["03", three]]) {
    assert(
      !/ThisMustNotBeExported/.test(svg.labels),
      `diagrams-${name}.svg exported a fence that was quoted inside a wider fence`
    );
  }
});

test("each exported SVG is a valid standalone file that actually draws", () => {
  const file = path.join(SVG_OUT, "diagrams-01.svg");
  const text = fs.readFileSync(file, "utf8");
  assert(text.startsWith("<?xml "), "the file has no XML declaration");
  assert(!/__[A-Z_]+__/.test(text), "an unsubstituted placeholder was left in the output");

  const svg = inspectSvg(file);
  assert(!svg.parserError, `the SVG is not well-formed XML: ${svg.parserError}`);
  assert(svg.rootTag === "svg", `expected an <svg> root element, got <${svg.rootTag}>`);

  // mermaid's default is width="100%", which resolves against nothing in a
  // standalone file: the diagram opens at whatever size the viewer guesses.
  assert(/^[\d.]+$/.test(svg.width || ""), `width must be an explicit length, got "${svg.width}"`);
  assert(/^[\d.]+$/.test(svg.height || ""), `height must be an explicit length, got "${svg.height}"`);
  assert(svg.viewBox, "the SVG has no viewBox, so it cannot be scaled");
  assert(
    svg.bbox && svg.bbox.width > 10 && svg.bbox.height > 10,
    `the SVG parses but draws nothing: bbox ${JSON.stringify(svg.bbox)}`
  );

  // Labels have to be <text>, not <foreignObject>: foreignObject renders in a
  // browser and disappears in Illustrator, Inkscape, Figma and librsvg, which
  // is a blank diagram that looks fine everywhere it was tested.
  assert(svg.texts > 0, "the diagram has no <text> elements");
  assert(svg.foreignObjects === 0, `expected no <foreignObject>, found ${svg.foreignObjects}`);
  assert(
    /開始/.test(svg.labels),
    `CJK labels did not survive into the SVG: ${svg.labels.slice(0, 120)}`
  );
});

test("--scale resizes the SVG without moving the drawing", () => {
  const dir = path.join(OUT, "mermaid-scale");
  const r = md2pdf("mermaid", DIAGRAMS, "--scale", "2", "-o", dir);
  assert(r.code === 0, `expected success, got exit ${r.code}`);

  const plain = inspectSvg(path.join(SVG_OUT, "diagrams-01.svg"));
  const scaled = inspectSvg(path.join(dir, "diagrams-01.svg"));
  const near = (a, b) => Math.abs(a - b) < 0.5;
  assert(
    near(parseFloat(scaled.width), parseFloat(plain.width) * 2),
    `expected width ${parseFloat(plain.width) * 2}, got ${scaled.width}`
  );
  assert(
    near(parseFloat(scaled.height), parseFloat(plain.height) * 2),
    `expected height ${parseFloat(plain.height) * 2}, got ${scaled.height}`
  );
  // Scaling by rewriting the viewBox would change WHAT is on the canvas rather
  // than how large the canvas is, and would crop or inset the diagram.
  assert(
    scaled.viewBox === plain.viewBox,
    `--scale rewrote the viewBox: "${plain.viewBox}" -> "${scaled.viewBox}"`
  );
});

test("--type png multiplies the pixel dimensions by --scale", () => {
  const one = path.join(OUT, "mermaid-png1");
  const three = path.join(OUT, "mermaid-png3");
  const a = md2pdf("mermaid", DIAGRAMS, "--type", "png", "--scale", "1", "-o", one);
  const b = md2pdf("mermaid", DIAGRAMS, "--type", "png", "--scale", "3", "-o", three);
  assert(a.code === 0 && b.code === 0, `expected both exports to succeed (${a.code}, ${b.code})`);
  assert(
    exported(one).join(",") === "diagrams-01.png,diagrams-02.png,diagrams-03.png",
    `expected three PNGs, got: ${exported(one).join(", ")}`
  );

  const small = pngInfo(path.join(one, "diagrams-01.png"));
  const big = pngInfo(path.join(three, "diagrams-01.png"));
  assert(
    big.width === small.width * 3 && big.height === small.height * 3,
    `expected 3x the pixels, got ${big.width}x${big.height} from ${small.width}x${small.height}`
  );

  // The capture has to cover the WHOLE diagram, not a viewport-sized window of
  // it: the element is routinely taller than the viewport, and a clip that
  // tracked the viewport instead would silently cut the bottom off. Checked
  // against the diagram's own viewBox, so it is an absolute claim rather than
  // the two PNGs merely agreeing with each other. One pixel of slack, because
  // mermaid emits fractional sizes and the device-pixel clip is rounded.
  const svg = inspectSvg(path.join(SVG_OUT, "diagrams-01.svg"));
  const [, , vbW, vbH] = svg.viewBox.trim().split(/[\s,]+/).map(Number);
  assert(
    Math.abs(small.width - vbW) <= 1 && Math.abs(small.height - vbH) <= 1,
    `the PNG should cover the whole diagram: got ${small.width}x${small.height} for a ${vbW}x${vbH} viewBox`
  );
  assert(
    Math.abs(big.width - vbW * 3) <= 1 && Math.abs(big.height - vbH * 3) <= 1,
    `the 3x PNG should cover the whole diagram: got ${big.width}x${big.height} for a ${vbW}x${vbH} viewBox`
  );
});

test("PNG defaults to a high-resolution render, not a 1x one", () => {
  // A diagram captured at 1x is only as wide as its CSS layout, which is soft
  // on a retina display and rough in print. The source is vector, so a 3x
  // capture is a genuine re-render rather than an upscale -- the only cost is
  // file size, and a blurry default would be the worse trade.
  const dir = path.join(OUT, "mermaid-png-default");
  const r = md2pdf("mermaid", DIAGRAMS, "--type", "png", "-o", dir);
  assert(r.code === 0, `expected success, got exit ${r.code}.\n        ${r.output.trim()}`);

  const base = pngInfo(path.join(OUT, "mermaid-png1", "diagrams-01.png"));
  const dflt = pngInfo(path.join(dir, "diagrams-01.png"));
  assert(
    dflt.width === base.width * 3 && dflt.height === base.height * 3,
    `expected the default PNG to be 3x, got ${dflt.width}x${dflt.height} against ${base.width}x${base.height} at --scale 1`
  );
  assert(/scale 3x/.test(r.output), `the scale used should be reported, got: ${r.output.trim()}`);

  // SVG has no such dial -- it is vector, and its scale only sets the size the
  // file asks to be drawn at -- so its default stays life-size: the declared
  // width equals the viewBox width.
  const svg = inspectSvg(path.join(SVG_OUT, "diagrams-01.svg"));
  const viewBoxWidth = parseFloat(svg.viewBox.trim().split(/[\s,]+/)[2]);
  assert(
    Math.abs(parseFloat(svg.width) - viewBoxWidth) < 0.5,
    `the default SVG should be life-size: width ${svg.width} against viewBox width ${viewBoxWidth}`
  );
});

test("--background transparent is genuinely transparent, and the default is not", () => {
  const dir = path.join(OUT, "mermaid-transparent");
  const html = path.join(OUT, "mermaid-kept.html");
  const r = md2pdf(
    "mermaid", DIAGRAMS, "--type", "png", "--background", "transparent",
    "--keep-html", html, "-o", dir
  );
  assert(r.code === 0, `expected success, got exit ${r.code}.\n        ${r.output.trim()}`);
  assert(sizeOf(html) > 0, "--keep-html did not keep the intermediate HTML");

  // The headless default page colour is #121212, not white, so a PNG that
  // relied on the page background rather than painting its own would come out
  // near-black -- which is why the background lives inside the SVG.
  const clear = pngCornerPixel(path.join(dir, "diagrams-01.png"));
  assert(clear.a === 0, `expected a transparent corner, got alpha ${clear.a}`);

  const opaque = pngCornerPixel(path.join(OUT, "mermaid-png1", "diagrams-01.png"));
  assert(
    opaque.a === 255 && opaque.r === 255 && opaque.g === 255 && opaque.b === 255,
    `expected an opaque white corner by default, got ${JSON.stringify(opaque)}`
  );
});

test("a malformed diagram is refused, and --no-verify exports the rest", () => {
  const strict = path.join(OUT, "mermaid-mixed-strict");
  const a = md2pdf("mermaid", MIXED, "-o", strict);
  assert(a.code !== 0, "expected a non-zero exit for an unparseable diagram");
  assert(
    /could not be rendered/.test(a.output),
    `expected the failure to be named, got: ${a.output.trim()}`
  );
  // Nothing is written when verification fails. A directory that is half this
  // document and half the previous one is worse than no directory at all.
  assert(
    exported(strict).length === 0,
    `a failed run must write nothing, got: ${exported(strict).join(", ")}`
  );

  const forced = path.join(OUT, "mermaid-mixed-forced");
  const b = md2pdf("mermaid", MIXED, "--no-verify", "-o", forced);
  assert(b.code === 0, `expected success with --no-verify, got exit ${b.code}`);
  // The number is the diagram's position in the DOCUMENT, not a running count
  // of what rendered. The fixture puts the BROKEN diagram first precisely so
  // this can fail: the survivor is the document's second diagram, so it must
  // come out as -02, leaving the gap that tells a reader which one is missing.
  // Renumbering it to -01 would silently relabel every later diagram too.
  assert(
    exported(forced).join(",") === "mixed-diagrams-02.svg",
    `the survivor must keep its document position, got: ${exported(forced).join(", ") || "(nothing)"}`
  );
  assert(/failed to render/.test(b.output), "the skipped diagram was not reported");
});

test("a document with no diagrams is an error, unless --no-verify", () => {
  const dir = path.join(OUT, "mermaid-none");
  const a = md2pdf("mermaid", NO_DIAGRAMS, "-o", dir);
  assert(a.code !== 0, "expected a non-zero exit when there is nothing to export");
  assert(
    /no mermaid diagrams/.test(a.output),
    `expected an explanation, got: ${a.output.trim()}`
  );

  const b = md2pdf("mermaid", NO_DIAGRAMS, "--no-verify", "-o", dir);
  assert(b.code === 0, `expected --no-verify to exit quietly, got exit ${b.code}`);
  assert(exported(dir).length === 0, "nothing should have been written");
});

test("mermaid options are validated, including the --format A4 slip", () => {
  const out = ["-o", path.join(OUT, "mermaid-rejected")];

  // --format is a PAPER SIZE on the PDF path. Typing it here is the obvious
  // slip, and "Unknown image type A4" would not explain why it is wrong.
  const paper = md2pdf("mermaid", DIAGRAMS, "--format", "A4", ...out);
  assert(paper.code !== 0, "expected a paper size to be rejected");
  assert(
    /paper size/.test(paper.output) && /--type/.test(paper.output),
    `expected the slip to be explained, got: ${paper.output.trim()}`
  );

  const type = md2pdf("mermaid", DIAGRAMS, "--type", "gif", ...out);
  assert(
    type.code !== 0 && /Valid types:/.test(type.output),
    `expected the valid types to be listed, got: ${type.output.trim()}`
  );

  const theme = md2pdf("mermaid", DIAGRAMS, "--theme", "nope", ...out);
  assert(
    theme.code !== 0 && /Valid themes:/.test(theme.output),
    `expected the valid themes to be listed, got: ${theme.output.trim()}`
  );

  // The PDF path caps --scale at 2 because Chrome's print API does. An image
  // has no such ceiling, so 3 must be accepted here -- and it is, above.
  for (const bad of ["0", "11", "abc"]) {
    const r = md2pdf("mermaid", DIAGRAMS, "--scale", bad, ...out);
    assert(r.code !== 0, `expected --scale ${bad} to be rejected`);
    assert(/Invalid --scale/.test(r.output), `expected a validation message for --scale ${bad}`);
  }

  const colour = md2pdf("mermaid", DIAGRAMS, "--background", "not-a-colour", ...out);
  assert(
    colour.code !== 0 && /background/.test(colour.output),
    `expected an unrecognised colour to be rejected, got: ${colour.output.trim()}`
  );

  const file = path.join(OUT, "not-a-directory.txt");
  fs.writeFileSync(file, "x");
  const notDir = md2pdf("mermaid", DIAGRAMS, "-o", file);
  assert(
    notDir.code !== 0 && /must be a directory/.test(notDir.output),
    `expected --out to refuse a file, got: ${notDir.output.trim()}`
  );
});

test("--prefix names the files, and leftovers from an earlier run are reported", () => {
  const dir = path.join(OUT, "mermaid-prefix");
  const r = md2pdf("mermaid", DIAGRAMS, "--prefix", "arch", "-o", dir);
  assert(r.code === 0, `expected success, got exit ${r.code}`);
  assert(
    exported(dir).join(",") === "arch-01.svg,arch-02.svg,arch-03.svg",
    `expected the prefix to be used, got: ${exported(dir).join(", ")}`
  );

  // A document that loses a diagram leaves the old file behind. Deleting it
  // would be overstepping -- it is the user's file -- but saying nothing is
  // how a deleted diagram lives on in whatever imports the folder.
  fs.writeFileSync(path.join(dir, "arch-09.svg"), "<svg/>");
  const again = md2pdf("mermaid", DIAGRAMS, "--prefix", "arch", "-o", dir);
  assert(again.code === 0, `expected success, got exit ${again.code}`);
  assert(
    /earlier run/.test(again.output) && /arch-09\.svg/.test(again.output),
    `expected the stale file to be named, got: ${again.output.trim()}`
  );
});

test("two runs of the same document produce byte-identical files", () => {
  // mermaid ids its SVGs from a global counter unless told otherwise, and that
  // id is woven through the internal stylesheet ~50 times. Left alone, every
  // run rewrites every byte, and committing an exported diagram to git shows a
  // whole-file diff each time nothing changed.
  const dir = path.join(OUT, "mermaid-repeat");
  const r = md2pdf("mermaid", DIAGRAMS, "-o", dir);
  assert(r.code === 0, `expected success, got exit ${r.code}`);
  for (const name of ["diagrams-01.svg", "diagrams-02.svg", "diagrams-03.svg"]) {
    assert(
      fs.readFileSync(path.join(SVG_OUT, name)).equals(fs.readFileSync(path.join(dir, name))),
      `${name} differs between two runs of the same input`
    );
  }
});

test("labels containing < & > survive, and a raw div.mermaid is exported too", () => {
  const dir = path.join(OUT, "mermaid-parity");
  const source = path.join(FIXTURES, "diagram-parity.md");
  const r = md2pdf("mermaid", source, "-o", dir);
  assert(r.code === 0, `expected success, got exit ${r.code}.\n        ${r.output.trim()}`);

  // The PDF path renders every .mermaid element, not only fenced blocks. If
  // the two commands disagree about what a document contains, one of them is
  // lying to the user -- so this asserts they agree, rather than asserting a
  // number the export path picked for itself.
  const pdf = md2pdf(source, "-o", path.join(OUT, "parity.pdf"));
  assert(pdf.code === 0, `the PDF path failed on the same fixture: ${pdf.output.trim()}`);
  const claimed = /(\d+)\/(\d+) diagrams/.exec(pdf.output);
  assert(claimed, `could not read the PDF diagram count from: ${pdf.output.trim()}`);
  assert(
    exported(dir).length === Number(claimed[2]),
    `the PDF renders ${claimed[2]} diagrams but the export wrote ${exported(dir).length}`
  );

  // mermaid escapes a label for HTML and then inserts it as SVG text, so
  // "5 < 6" reaches the file as the literal characters "5 &lt; 6" and the
  // reader sees the entity. The PDF path does not have this, because
  // htmlLabels:true decodes it again on the way in.
  const labels = inspectSvg(path.join(dir, "diagram-parity-01.svg")).labels;
  assert(
    /5 < 6 && 7 > 2/.test(labels),
    `entities were left double-escaped in the label: ${labels}`
  );
  assert(!/&lt;|&amp;|&gt;/.test(labels), `an entity is still visible in the label: ${labels}`);
  // ...and exactly one layer. Decoding twice would turn the source's literal
  // "AT&amp;T" into something else again; mermaid's own semantics display it
  // as "AT&T", and the PDF path agrees, so the image has to as well.
  assert(/AT&T/.test(labels), `"AT&amp;T" should display as "AT&T", got: ${labels}`);

  // The opposite mistake, and the more damaging one. sequenceDiagram writes
  // its label into the SVG verbatim, so "undoing the escape" there is a
  // second, unwanted decode -- and because the decoder resolves the legacy
  // semicolon-less references, a URL's &reg= and &copy= parameters turn into
  // (R)= and (C)=. Wrong text, silently, in a picture nobody re-reads.
  const url = inspectSvg(path.join(dir, "diagram-parity-02.svg")).labels;
  assert(
    /id=5&reg=US&copy=1/.test(url),
    `a URL in a verbatim diagram type was mangled by entity decoding: ${url}`
  );

  const raw = inspectSvg(path.join(dir, "diagram-parity-03.svg")).labels;
  assert(/RawDiv/.test(raw), `the raw <div class="mermaid"> was not exported: ${raw}`);
});

test("a document containing a literal </script> still exports", () => {
  // Both commands embed the markdown in a script block, so both have to deal
  // with a document whose prose discusses HTML -- which is most documents that
  // discuss HTML. Here the markdown is base64-encoded; the PDF path escapes
  // the tags instead, to keep --keep-html readable. Either way, without it the
  // block closes early, the page script never runs, and the export hangs until
  // it times out.
  const dir = path.join(OUT, "mermaid-script-tag");
  const source = path.join(FIXTURES, "script-tag.md");
  const r = md2pdf("mermaid", source, "-o", dir);
  assert(r.code === 0, `expected success, got exit ${r.code}.\n        ${r.output.trim()}`);
  assert(
    exported(dir).join(",") === "script-tag-01.svg",
    `expected the one diagram, got: ${exported(dir).join(", ") || "(nothing)"}`
  );
  // The html fence is a code block, not a diagram, so it must not be exported.
  const labels = inspectSvg(path.join(dir, "script-tag-01.svg")).labels;
  assert(/Parse/.test(labels) && /Render/.test(labels), `wrong diagram exported: ${labels}`);

  // The PDF path renders the same file rather than refusing it, and the tags
  // survive as text. Asserting on the rendered DOM, not the built file: the
  // built file holds them escaped, which would prove nothing about what the
  // reader ends up looking at.
  const html = path.join(OUT, "script-tag.html");
  const pdf = md2pdf(source, "-o", path.join(OUT, "script-tag.pdf"), "--keep-html", html);
  assert(pdf.code === 0, `expected the PDF path to render it, got exit ${pdf.code}.\n        ${pdf.output.trim()}`);
  const dom = renderedDom(html);
  assert(
    dom.includes('&lt;script src="app.js"&gt;&lt;/script&gt;'),
    "the literal script tags did not survive into the rendered document"
  );
  assert(/1\/1 diagrams/.test(pdf.output), `the diagram was lost: ${pdf.output.trim()}`);
});

test("--theme, --font and --html-labels each reach the diagram", () => {
  // Each of these could silently become a no-op without any other test
  // noticing: the export still succeeds and still writes a valid SVG.
  const base = path.join(OUT, "mermaid-opts-base");
  const themed = path.join(OUT, "mermaid-opts-theme");
  const fonted = path.join(OUT, "mermaid-opts-font");
  const htmlLabels = path.join(OUT, "mermaid-opts-htmllabels");
  const src = path.join(FIXTURES, "diagrams.md");

  assert(md2pdf("mermaid", src, "-o", base).code === 0, "the plain export failed");
  assert(
    md2pdf("mermaid", src, "--theme", "dark", "-o", themed).code === 0,
    "--theme dark failed"
  );
  assert(
    md2pdf("mermaid", src, "--font", "Courier New", "-o", fonted).code === 0,
    "--font failed"
  );
  assert(
    md2pdf("mermaid", src, "--html-labels", "-o", htmlLabels).code === 0,
    "--html-labels failed"
  );

  const read = (dir) => fs.readFileSync(path.join(dir, "diagrams-01.svg"), "utf8");
  const plain = read(base);

  // A theme is a different palette baked into the SVG's own stylesheet.
  assert(read(themed) !== plain, "--theme produced a byte-identical file");

  // --font must reach the stylesheet AND keep the CJK fallbacks behind it,
  // or Chinese labels in a diagram become empty boxes.
  const withFont = read(fonted);
  assert(/"Courier New"/.test(withFont), "--font did not reach the diagram's stylesheet");
  assert(
    /"Courier New",\s*"PingFang TC"/.test(withFont),
    "--font replaced the CJK fallback chain instead of prepending to it"
  );

  // --html-labels swaps <text> for <foreignObject>: richer labels, but the
  // text vanishes outside a browser, which is why it is opt-in.
  const rich = inspectSvg(path.join(htmlLabels, "diagrams-01.svg"));
  const flat = inspectSvg(path.join(base, "diagrams-01.svg"));
  assert(
    rich.foreignObjects > 0 && rich.texts === 0,
    `--html-labels should draw labels as foreignObject, got ${rich.foreignObjects} fo / ${rich.texts} text`
  );
  assert(
    flat.foreignObjects === 0 && flat.texts > 0,
    `the default should draw labels as <text>, got ${flat.foreignObjects} fo / ${flat.texts} text`
  );
});

test("stale-file reporting is scoped to the same format", () => {
  // Exporting the PNGs of a document into the directory that already holds its
  // SVGs is an ordinary thing to do. Reporting those SVGs as leftovers every
  // time is how a user learns to ignore the one warning that matters.
  const { staleFiles } = require("../lib/exportMermaid");
  const dir = path.join(OUT, "stale-unit");
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ["u-01.svg", "u-02.svg", "u-03.svg", "u-01.png", "u-09.png", "other-01.svg"]) {
    fs.writeFileSync(path.join(dir, name), "x");
  }

  const svgRun = staleFiles(dir, "u", "svg", [path.join(dir, "u-01.svg")]);
  assert(
    svgRun.join(",") === "u-02.svg,u-03.svg",
    `an svg run should report only unrewritten svgs, got: ${svgRun.join(",") || "(none)"}`
  );

  const pngRun = staleFiles(dir, "u", "png", [path.join(dir, "u-01.png")]);
  assert(
    pngRun.join(",") === "u-09.png",
    `a png run must ignore the svgs entirely, got: ${pngRun.join(",") || "(none)"}`
  );

  // A different document's files are not this run's business either.
  assert(
    !svgRun.includes("other-01.svg") && !pngRun.includes("other-01.svg"),
    "another prefix's files were reported as stale"
  );
});

test("a fence that renders blank is refused rather than exported empty", () => {
  // "flowchart TD" with no nodes renders happily as a 16x16 canvas, and
  // mermaid.render() does not throw for it -- so try/catch alone would report
  // success and hand the user an empty file for a typo.
  const dir = path.join(OUT, "mermaid-empty");
  const r = md2pdf("mermaid", path.join(FIXTURES, "empty-fence.md"), "-o", dir);
  assert(r.code !== 0, "expected a non-zero exit for a diagram that rendered blank");
  assert(
    /rendered empty/.test(r.output),
    `expected the blank diagram to be named, got: ${r.output.trim()}`
  );
  assert(exported(dir).length === 0, "an empty diagram must not be written");
});

test("the id inside each SVG is scoped to its own source", () => {
  // Every rule in the stylesheet mermaid embeds is scoped as `#<id> .foo`, and
  // that scoping is the only thing keeping two diagrams' themes apart. An id
  // of just the position would make diagram 1 of every document "md2pdf-01",
  // so inlining two documents' diagrams into one page cross-styles them.
  const a = fs.readFileSync(path.join(SVG_OUT, "diagrams-01.svg"), "utf8");
  const b = fs.readFileSync(path.join(OUT, "mermaid-parity", "diagram-parity-01.svg"), "utf8");
  const idOf = (svg) => (/<svg[^>]*\bid="([^"]+)"/.exec(svg) || [])[1];

  assert(
    /^md2pdf-01-[0-9a-f]{8}$/.test(idOf(a)),
    `expected a position-and-hash id, got "${idOf(a)}"`
  );
  assert(
    idOf(a) !== idOf(b),
    `two different documents produced the same SVG id "${idOf(a)}"`
  );
});

test("diagram types that emit width=100% are given a real size", () => {
  // quadrantChart and xychart-beta ignore useMaxWidth:false and ship
  // width="100%" with a max-width style and no height. A standalone file like
  // that has no intrinsic size: it reports 150x150 through an <img> tag, and
  // as a PNG its resolution follows the ambient viewport rather than --scale.
  // The size is therefore restated from the viewBox for EVERY diagram type,
  // which is what this pins down.
  const dir = path.join(OUT, "mermaid-sized");
  const r = md2pdf("mermaid", path.join(FIXTURES, "sized-diagrams.md"), "-o", dir);
  assert(r.code === 0, `expected success, got exit ${r.code}.\n        ${r.output.trim()}`);

  for (const name of ["sized-diagrams-01.svg", "sized-diagrams-02.svg"]) {
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    assert(!/max-width/.test(text), `${name} still carries a max-width style`);
    assert(!/width="100%"/.test(text), `${name} still declares width="100%"`);

    const svg = inspectSvg(path.join(dir, name));
    assert(
      /^[\d.]+$/.test(svg.width || "") && /^[\d.]+$/.test(svg.height || ""),
      `${name} has no explicit numeric size: width="${svg.width}" height="${svg.height}"`
    );
    // The declared size must match the viewBox, not some other number: that is
    // what makes the file render at the size it claims.
    const [, , vbW, vbH] = svg.viewBox.trim().split(/[\s,]+/).map(Number);
    assert(
      Math.abs(parseFloat(svg.width) - vbW) < 0.5 &&
        Math.abs(parseFloat(svg.height) - vbH) < 0.5,
      `${name} declares ${svg.width}x${svg.height} against viewBox ${vbW}x${vbH}`
    );
  }
});

test("the output does not depend on the input's filename", () => {
  // mermaid feeds the render id straight into querySelector('#' + id), so an
  // id derived from the filename throws from deep inside mermaid for exactly
  // the names the OUTPUT files are allowed to have: a dot, a space or a
  // bracket makes an invalid selector. The id is built from a fixed prefix
  // instead, and only the FILENAME is sanitised.
  const dir = path.join(OUT, "mermaid-awkward");
  const awkward = path.join(OUT, "my.report (v2).md");
  fs.copyFileSync(DIAGRAMS, awkward);

  const r = md2pdf("mermaid", awkward, "-o", dir);
  assert(r.code === 0, `expected success, got exit ${r.code}.\n        ${r.output.trim()}`);
  assert(
    exported(dir).length === 3,
    `expected three diagrams, got: ${exported(dir).join(", ") || "(nothing)"}`
  );
  // The dot and the brackets are legal in a filename; the space is not worth
  // keeping, and a leading dash would make the file look like a command line
  // option to whatever is pointed at it next.
  for (const name of exported(dir)) {
    assert(!/\s/.test(name), `the exported filename kept a space: ${name}`);
    assert(!name.startsWith("-"), `the exported filename starts with a dash: ${name}`);
  }
  // Same diagrams, different filename -> byte-identical files. The id depends
  // on the diagram source, never on what the document is called.
  const plain = fs.readFileSync(path.join(SVG_OUT, "diagrams-01.svg"));
  const renamed = fs.readFileSync(path.join(dir, exported(dir)[0]));
  assert(plain.equals(renamed), "renaming the input changed the exported bytes");
});

test("the CJK font check follows the diagrams, not the prose around them", () => {
  // A missing CJK font is fatal here, because a PNG bakes the empty boxes into
  // the pixels for good. That makes the SCOPE of the check load-bearing: this
  // command draws nothing but the diagrams, so Chinese prose wrapped around a
  // set of English flowcharts says nothing about whether the output is
  // readable. Scoping it to the whole document would refuse those documents on
  // any machine without a CJK font -- a bare container, most CI images -- for
  // no reason at all.
  //
  // The flag is read from the page rather than inferred from the CLI's output,
  // because on a machine that HAS the fonts both scopings succeed: this
  // assertion would pass either way if it were made against the exit code.
  const report = (fixture, name) => {
    const html = path.join(OUT, name);
    const r = md2pdf(
      "mermaid", path.join(FIXTURES, fixture),
      "--keep-html", html, "-o", path.join(OUT, `${name}-out`)
    );
    assert(r.code === 0, `expected ${fixture} to export, got exit ${r.code}: ${r.output.trim()}`);
    const out = spawnSync(process.execPath, [path.join(__dirname, "harness.js"), html], {
      encoding: "utf8",
    });
    assert(out.status === 0, `harness.js failed: ${(out.stderr || "").trim()}`);
    return JSON.parse(out.stdout);
  };

  const prose = report("cjk-prose-only.md", "cjk-prose.html");
  assert(prose.total === 1, `expected one diagram, got ${prose.total}`);
  assert(
    prose.cjkNeeded === false,
    "CJK prose around an ASCII-only diagram must not arm the font check"
  );

  // ...and a diagram whose own labels are CJK must still arm it.
  const labels = report("diagrams.md", "cjk-labels.html");
  assert(
    labels.cjkNeeded === true,
    "a diagram with CJK labels must arm the font check"
  );
});

test("CRLF and LF checkouts export identical diagrams", () => {
  // git's autocrlf is on by default on Windows, so the .md a Windows user
  // feeds this tool almost always has CRLF line endings while the same file on
  // macOS and Linux has LF. Anything downstream that is sensitive to that --
  // fence parsing, the diagram source that gets hashed into the SVG id, the
  // base64 round-trip -- would fail on exactly one platform in CI and nowhere
  // a developer could reproduce it.
  //
  // Both variants are written here rather than relying on the fixture's own
  // endings, which are whatever git checked out.
  const lfDir = path.join(OUT, "mermaid-lf");
  const crlfDir = path.join(OUT, "mermaid-crlf");
  const body = fs.readFileSync(DIAGRAMS, "utf8").replace(/\r\n/g, "\n");
  const lfFile = path.join(OUT, "endings-lf.md");
  const crlfFile = path.join(OUT, "endings-crlf.md");
  fs.writeFileSync(lfFile, body, "utf8");
  fs.writeFileSync(crlfFile, body.replace(/\n/g, "\r\n"), "utf8");

  const a = md2pdf("mermaid", lfFile, "-o", lfDir);
  const b = md2pdf("mermaid", crlfFile, "-o", crlfDir);
  assert(a.code === 0 && b.code === 0, `expected both exports to succeed (${a.code}, ${b.code})`);
  assert(
    exported(lfDir).length === 3 && exported(crlfDir).length === 3,
    `expected three diagrams from each, got ${exported(lfDir).length} and ${exported(crlfDir).length}`
  );
  for (let i = 1; i <= 3; i++) {
    const n = String(i).padStart(2, "0");
    assert(
      fs
        .readFileSync(path.join(lfDir, `endings-lf-${n}.svg`))
        .equals(fs.readFileSync(path.join(crlfDir, `endings-crlf-${n}.svg`))),
      `diagram ${n} differs between a CRLF and an LF checkout`
    );
  }
});

test("diagram filenames are padded, sortable and safe on every platform", () => {
  const { diagramFileName, sanitisePrefix } = require("../lib/exportMermaid");
  const eq = (actual, expected, what) =>
    assert(
      actual === expected,
      `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );

  eq(diagramFileName("report", 1, "svg"), "report-01.svg", "single digits are padded so files sort");
  eq(diagramFileName("report", 12, "png"), "report-12.png", "two digits are unchanged");
  // Padded to a FIXED width, never to the width of the total: padding to the
  // total renames the first nine files the moment a tenth diagram is added,
  // breaking every document that already links to them.
  eq(diagramFileName("report", 100, "svg"), "report-100.svg", "past 99 the number just grows");

  eq(sanitisePrefix('a:b*c?"d<e>f|g'), "a-b-c--d-e-f-g", "characters Windows forbids are replaced");
  eq(sanitisePrefix("my report"), "my-report", "whitespace is replaced");
  // A file called "-01.svg" reads as an option to every tool pointed at it.
  eq(sanitisePrefix("-leading"), "leading", "a leading dash is dropped");
  eq(sanitisePrefix("...."), "diagram", "a name with nothing usable falls back");
  // CJK filenames are legal on all three platforms and must survive intact.
  eq(sanitisePrefix("架構圖"), "架構圖", "non-ASCII names are left alone");
});

test("doctor reports the environment", () => {
  const r = md2pdf("doctor");
  assert(r.code === 0, `expected success, got exit ${r.code}`);
  assert(/chrome/i.test(r.output), "expected doctor to report the browser");
});

if (KEEP_OUTPUT) {
  console.log(`\noutput kept in ${OUT}`);
} else {
  fs.rmSync(OUT, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(`failed: ${failures.join(", ")}`);
  process.exit(1);
}
