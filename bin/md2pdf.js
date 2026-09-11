#!/usr/bin/env node
"use strict";

/**
 * md2pdf -- render any Markdown file (mermaid diagrams + LaTeX included) to PDF.
 *
 * Deliberately project-agnostic: it takes a path, it writes a PDF, and it holds
 * no knowledge of any particular repository.
 */

const fs = require("fs");
const path = require("path");
const { cli } = require("../lib/commandRunner");
const { buildHtml, ASSETS, VENDOR } = require("../lib/buildHtml");
const { renderPdf, resolveChrome } = require("../lib/renderPdf");

const ROOT = path.resolve(__dirname, "..");
const DEPS_PROBE = path.join(ROOT, "node_modules", "puppeteer-core", "package.json");

// Floor for puppeteer-core 23.x. Overridable, but the capability check below is
// the one that actually decides -- a version number is only a proxy for it.
const MIN_NODE = process.env.MD2PDF_MIN_NODE || "18.0.0";

/**
 * Paper sizes accepted by --format.
 *
 * Validated against this list rather than passed straight through: the size
 * reaches both the CSS @page rule and Chrome's PDF API, and an unknown value
 * fails deep inside the render with a much worse message than "here are the
 * eleven sizes you can use".
 */
const PAPER_FORMATS = [
  "A0", "A1", "A2", "A3", "A4", "A5", "A6",
  "Letter", "Legal", "Tabloid", "Ledger",
];

/**
 * Chrome refuses a render scale outside 0.1-2.0, and rejects it only once the
 * page is already rendered. Validating up front turns that into an immediate,
 * readable error.
 */
function normaliseScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0.1 || n > 2) {
    throw new Error(`Invalid --scale "${value}". Must be a number between 0.1 and 2.`);
  }
  return n;
}

function normaliseFontSize(value) {
  const s = String(value).trim();
  if (!/^[\d.]+(px|pt|em|rem)?$/.test(s) || parseFloat(s) <= 0) {
    throw new Error(
      `Invalid --font-size "${value}". Use a positive number, optionally with a unit (e.g. 14, 14px, 11pt).`
    );
  }
  return s;
}

function normaliseFormat(value) {
  const match = PAPER_FORMATS.find(
    (f) => f.toLowerCase() === String(value).trim().toLowerCase()
  );
  if (!match) {
    throw new Error(
      `Unknown paper format "${value}". Valid formats: ${PAPER_FORMATS.join(", ")}`
    );
  }
  return match;
}

const USAGE = `
md2pdf -- Markdown -> PDF with mermaid diagrams and LaTeX, rendered by real Chrome.

Usage:
  md2pdf <input.md> [options]
  md2pdf setup [--force]     Vendor pinned JS assets + install node deps (offline-capable)
  md2pdf doctor              Report what is installed and what is missing

Options:
  -o, --output <file>   Output PDF (default: alongside the input, same name)
  --format <size>       Paper size (case-insensitive). Default: A4
                        A0 A1 A2 A3 A4 A5 A6 Letter Legal Tabloid Ledger
  --landscape           Landscape orientation (default: portrait)
  --scale <n>           Zoom the whole page: text, diagrams and margins.
                        0.1 to 2.0. Default: 1
  --font <family>       Font for body text. Comma-separated families are
                        allowed; the bundled fallbacks (including CJK) are
                        kept behind whatever you name.
  --mono-font <family>  Font for inline code and code blocks
  --font-size <size>    Base text size. Bare numbers are px. Default: 12.5px
  --page-numbers        Print "n / total" in the footer
  --inline-math         Enable $...$ inline math. UNSAFE for documents containing
                        currency like "$5" -- off by default for that reason.
  --title <text>        Document title (default: first H1, else the filename)
  --keep-html [path]    Keep the intermediate HTML (useful for debugging styles)
  --cdn                 Load JS assets from CDN instead of the vendored copies
  --no-verify           Produce the PDF even if diagrams failed to render
  -h, --help            This message

Environment:
  MD2PDF_CHROME         Absolute path to a Chrome/Chromium binary
  MD2PDF_MIN_NODE       Override the minimum node version

Examples:
  md2pdf report.md
  md2pdf notes.md -o ~/Desktop/notes.pdf --page-numbers
  md2pdf paper.md --inline-math --format Letter
`.trim();

/**
 * Output glyphs, with an ASCII fallback on Windows.
 *
 * A legacy cmd.exe code page (cp950 on a zh-TW install, cp437 elsewhere) turns
 * these into mojibake, so the status line becomes harder to read than plain
 * ASCII would have been. Windows Terminal handles UTF-8 fine, but the console
 * this runs in is not ours to choose.
 */
const G =
  process.platform === "win32"
    ? { ok: "OK", get: ">", sep: "|" }
    : { ok: "✓", get: "↓", sep: "·" };

function cmpVersion(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/**
 * Two checks, not one.
 *
 * The version comparison produces something a person can act on ("you have
 * 16.x, this needs 18"); the capability check is what really matters, since a
 * missing global fetch is the specific thing that breaks and the version is
 * only a proxy for it.
 */
function checkNode() {
  const current = process.versions.node;
  if (cmpVersion(current, MIN_NODE) < 0) {
    const how =
      process.platform === "win32"
        ? "winget install OpenJS.NodeJS.LTS   (or download from nodejs.org)"
        : "nvm install 22   (or your distro's package manager)";
    throw new Error(
      `md2pdf needs node ${MIN_NODE} or newer; this is ${current}.\n` +
        `Install it with:  ${how}`
    );
  }
  if (typeof fetch !== "function") {
    throw new Error(
      `node ${current} has no global fetch(), which \`md2pdf setup\` needs to ` +
        `vendor its assets. Use node 18 or newer.`
    );
  }
}

async function vendorAssets(force) {
  fs.mkdirSync(VENDOR, { recursive: true });
  let fetched = 0;
  for (const [name, { file, url }] of Object.entries(ASSETS)) {
    const dest = path.join(VENDOR, file);
    if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log(`  = ${file} (already vendored)`);
      continue;
    }
    process.stdout.write(`  ${G.get} ${file} ... `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to download ${name}: HTTP ${res.status} ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error(`downloaded ${name} but it is empty: ${url}`);
    fs.writeFileSync(dest, buf);
    console.log(`${(buf.length / 1024).toFixed(0)} KB`);
    fetched++;
  }
  return fetched;
}

async function cmdSetup(argv) {
  checkNode();
  const force = argv.includes("--force");

  console.log("Installing node dependencies...");
  const installed = await cli.ensureNodeDeps(ROOT, DEPS_PROBE);
  console.log(installed ? "  puppeteer-core installed." : "  already installed.");

  console.log("Vendoring pinned JS assets...");
  await vendorAssets(force);

  console.log("\nSetup complete. md2pdf can now run without network access.");
  return 0;
}

function cmdDoctor() {
  const row = (label, value) => console.log(`  ${label.padEnd(18)} ${value}`);
  console.log("md2pdf doctor\n");
  row("node", process.versions.node);
  row("platform", `${process.platform} ${process.arch}`);

  let chrome;
  try {
    chrome = resolveChrome();
  } catch (e) {
    chrome = `NOT FOUND (${e.message})`;
  }
  row("chrome", chrome);
  row("puppeteer-core", fs.existsSync(DEPS_PROBE) ? "installed" : "MISSING -- run: md2pdf setup");

  const missing = Object.entries(ASSETS)
    .filter(([, a]) => !fs.existsSync(path.join(VENDOR, a.file)))
    .map(([n]) => n);
  row("vendored assets", missing.length ? `missing: ${missing.join(", ")} (CDN fallback)` : "all present (offline OK)");
  return 0;
}

function parseArgs(argv) {
  const opts = {
    input: null, output: null, format: "A4", landscape: false, pageNumbers: false,
    inlineMath: false, title: null, keepHtml: null, cdn: false, verify: true,
    font: null, monoFont: null, fontSize: null, scale: 1,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} requires a value`);
      return v;
    };
    switch (a) {
      case "-o": case "--output": opts.output = next(); break;
      case "--format": opts.format = normaliseFormat(next()); break;
      case "--title": opts.title = next(); break;
      case "--font": opts.font = next(); break;
      case "--mono-font": opts.monoFont = next(); break;
      case "--font-size": opts.fontSize = normaliseFontSize(next()); break;
      case "--scale": opts.scale = normaliseScale(next()); break;
      case "--landscape": opts.landscape = true; break;
      case "--page-numbers": opts.pageNumbers = true; break;
      case "--inline-math": opts.inlineMath = true; break;
      case "--cdn": opts.cdn = true; break;
      case "--no-verify": opts.verify = false; break;
      case "--keep-html":
        opts.keepHtml = argv[i + 1] && !argv[i + 1].startsWith("-") ? next() : true;
        break;
      default:
        if (a.startsWith("-")) throw new Error(`Unknown option: ${a}`);
        if (opts.input) throw new Error(`Unexpected extra argument: ${a}`);
        opts.input = a;
    }
  }
  if (!opts.input) throw new Error("No input markdown file given.");
  return opts;
}

async function cmdConvert(argv) {
  checkNode();
  const opts = parseArgs(argv);

  const input = path.resolve(opts.input);
  const output = path.resolve(
    opts.output || path.join(path.dirname(input), `${path.basename(input, path.extname(input))}.pdf`)
  );

  if (!fs.existsSync(DEPS_PROBE)) {
    console.log("Dependencies missing; installing once...");
    await cli.ensureNodeDeps(ROOT, DEPS_PROBE);
  }

  const htmlPath =
    typeof opts.keepHtml === "string"
      ? path.resolve(opts.keepHtml)
      : path.join(
          fs.mkdtempSync(path.join(require("os").tmpdir(), "md2pdf-")),
          `${path.basename(input, path.extname(input))}.html`
        );

  const built = buildHtml({
    input, output: htmlPath, title: opts.title, inlineMath: opts.inlineMath,
    // The CSS @page rule is what actually decides the size (renderPdf asks
    // Chrome to prefer it), so the orientation has to be expressed here too --
    // passing landscape only to Chrome would be silently ignored.
    pageSize: opts.landscape ? `${opts.format} landscape` : opts.format,
    font: opts.font, monoFont: opts.monoFont, fontSize: opts.fontSize,
    cdn: opts.cdn,
  });

  const result = await renderPdf({
    html: htmlPath, output, format: opts.format, landscape: opts.landscape,
    scale: opts.scale, pageNumbers: opts.pageNumbers,
    expects: built.expects, embeds: built.embeds, strict: opts.verify,
  });

  const s = result.stats;
  console.log(`${G.ok} ${path.relative(process.cwd(), output)}`);
  console.log(
    `  ${(result.size / 1024).toFixed(0)} KB ${G.sep} ` +
      `${s.mermaidOk || 0}/${s.mermaidTotal || 0} diagrams ${G.sep} ` +
      `${s.math || 0} formulas ${G.sep} ${s.tables || 0} tables ${G.sep} ` +
      (s.images ? `${s.images - (s.imagesFailed || 0)}/${s.images} images ${G.sep} ` : "") +
      `assets: ${built.offline ? "vendored" : "CDN"}`
  );
  if (result.problems.length) {
    console.log(`  ! ${result.problems.join("\n  ! ")}`);
  }
  if (opts.keepHtml) {
    console.log(`  html: ${htmlPath}`);
  } else {
    fs.rmSync(path.dirname(htmlPath), { recursive: true, force: true });
  }
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    console.log(USAGE);
    return argv.length === 0 ? 1 : 0;
  }
  if (argv[0] === "setup") return cmdSetup(argv.slice(1));
  if (argv[0] === "doctor") return cmdDoctor();
  return cmdConvert(argv);
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(`\nmd2pdf: ${err.message}\n`);
    process.exit(1);
  });
