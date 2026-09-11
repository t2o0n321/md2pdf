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

function sizeOf(file) {
  return fs.existsSync(file) ? fs.statSync(file).size : 0;
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
