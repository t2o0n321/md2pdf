"use strict";

/**
 * Markdown -> a self-contained HTML page that renders mermaid diagrams and
 * MathJax formulas. Nothing here is project-specific: any .md works.
 */

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { transformEmbeds } = require("./obsidian");

const LIB = __dirname;
const VENDOR = path.join(LIB, "vendor");

/**
 * Pinned asset versions.
 *
 * Pinned on purpose, and vendored by `md2pdf setup`: an unpinned CDN asset that
 * silently ships a new major is exactly how a renderer that works today breaks
 * months from now, in a document nobody is watching. mermaid in particular has
 * changed its init API across majors.
 */
const ASSETS = {
  marked: {
    file: "marked.min.js",
    url: "https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js",
  },
  mermaid: {
    file: "mermaid.min.js",
    url: "https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js",
  },
  mathjax: {
    file: "tex-svg.js",
    url: "https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-svg.js",
  },
};

/**
 * Inline `$...$` math is OFF by default.
 *
 * Any document that mentions money ("$5 / month", "$99") would otherwise have
 * everything between two dollar signs swallowed as a formula. Display math
 * ($$...$$) is unambiguous and stays on.
 */
const INLINE_MATH_OFF = "[]";
const INLINE_MATH_ON = "[['$','$'],['\\\\(','\\\\)']]";

function assetRef(name, forceCdn) {
  const { file, url } = ASSETS[name];
  const local = path.join(VENDOR, file);
  if (!forceCdn) {
    try {
      if (fs.statSync(local).size > 0) return pathToFileURL(local).href;
    } catch {
      /* fall through to CDN */
    }
  }
  return url;
}

function vendoredCount() {
  return Object.values(ASSETS).filter((a) => {
    try {
      return fs.statSync(path.join(VENDOR, a.file)).size > 0;
    } catch {
      return false;
    }
  }).length;
}

/**
 * Turns a user-supplied family list into a CSS prefix for the built-in stack.
 *
 * Returns "" for no value, otherwise a comma-terminated fragment such as
 * `"Times New Roman", ` so the bundled fallbacks (including the CJK ones)
 * still apply to anything the chosen face cannot draw.
 */
function fontPrefix(value) {
  if (!value) return "";
  const families = String(value)
    .split(",")
    .map((f) => f.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
    .map((f) =>
      // A bare CSS identifier is passed through; anything else -- spaces,
      // dots, punctuation -- has to be quoted. This also covers the generic
      // families (serif, sans-serif, ui-monospace): they are all valid
      // identifiers, and quoting one turns it into a request for a font
      // literally named "serif", which no system has, so the fallback
      // silently stops working.
      /^[A-Za-z][A-Za-z0-9-]*$/.test(f) ? f : `"${f.replace(/"/g, "")}"`
    );
  return families.length ? `${families.join(", ")}, ` : "";
}

/** Accepts 13, "13", "13px", "1.1em"... and yields a CSS length. */
function cssLength(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const s = String(value).trim();
  return /^[\d.]+$/.test(s) ? `${s}px` : s;
}

function deriveTitle(md, fallback) {
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith("# ")) return line.slice(2).trim();
  }
  return fallback;
}

/** Counts what the document *claims* to contain, so rendering can be checked against it. */
function inspect(md) {
  const mermaid = (md.match(/^```mermaid\s*$/gm) || []).length;
  const displayMath = (md.match(/\$\$[\s\S]+?\$\$/g) || []).length;
  const tables = (md.match(/^\|.+\|\s*$/gm) || []).length > 0;
  const images = (md.match(/<img\s|!\[[^\]]*\]\(/g) || []).length;
  return { mermaid, displayMath, hasTables: tables, images };
}

function buildHtml({
  input,
  output,
  title = null,
  inlineMath = false,
  pageSize = "A4",
  pageMargin = "16mm 15mm 18mm",
  font = null,
  monoFont = null,
  fontSize = null,
  cdn = false,
}) {
  if (!fs.existsSync(input)) {
    throw new Error(`Input markdown not found: ${input}`);
  }
  const raw = fs.readFileSync(input, "utf8");

  // Obsidian embeds have to be resolved here rather than in the page: only
  // this side can touch the filesystem, and the generated HTML lives in a
  // temp directory, so the result has to be an absolute file: URL.
  const embeds = transformEmbeds(raw, path.dirname(path.resolve(input)));
  const md = embeds.markdown;

  // The markdown is embedded in <script type="text/markdown">. A literal
  // </script> would close that block early and silently truncate the document.
  if (md.toLowerCase().includes("</script>")) {
    throw new Error(
      `${input} contains a literal "</script>", which would break the embedded ` +
        `source block. Remove or escape it and retry.`
    );
  }

  const docTitle = title || deriveTitle(md, path.basename(input, path.extname(input)));
  const tpl = fs.readFileSync(path.join(LIB, "template.html"), "utf8");

  // Every substitution uses a REPLACER FUNCTION, never a replacement string.
  //
  // In a replacement string `$$` means "one literal $", so passing markdown
  // through String.replace() rewrites every `$$formula$$` into `$formula$` --
  // silently, and every LaTeX block in the document stops rendering. ($& and
  // $` are the same class of trap.) A function's return value is inserted
  // verbatim, which is the only safe way to inject arbitrary text.
  //
  // Order also matters: every other placeholder is substituted BEFORE the
  // markdown is injected, so text inside the document can never be mistaken
  // for a placeholder and rewritten.
  const shell = tpl
    .replace("__TITLE__", () => docTitle)
    .replace("__INLINE_MATH__", () => (inlineMath ? INLINE_MATH_ON : INLINE_MATH_OFF))
    .replace("__VENDOR_MARKED__", () => assetRef("marked", cdn))
    .replace("__VENDOR_MERMAID__", () => assetRef("mermaid", cdn))
    .replace("__VENDOR_MATHJAX__", () => assetRef("mathjax", cdn))
    .replace("__PAGE_SIZE__", () => pageSize)
    .replace("__PAGE_MARGIN__", () => pageMargin)
    .replace("__FONT_PREPEND__", () => fontPrefix(font))
    .replace("__MONO_PREPEND__", () => fontPrefix(monoFont))
    .replace("__FONT_SIZE__", () => cssLength(fontSize, "12.5px"));

  const html = shell.replace("__MD__", () => md);

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, html, "utf8");

  return {
    output,
    title: docTitle,
    bytes: Buffer.byteLength(html),
    offline: !cdn && vendoredCount() === Object.keys(ASSETS).length,
    expects: inspect(md),
    embeds,
  };
}

module.exports = { buildHtml, ASSETS, VENDOR, fontPrefix, cssLength };
