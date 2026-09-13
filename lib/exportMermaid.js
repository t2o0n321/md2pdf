"use strict";

/**
 * Markdown -> one image file per mermaid diagram.
 *
 * Everything that is not a diagram is ignored: no prose, no tables, no
 * formulas, no page. A document with N diagrams produces N files.
 *
 * The diagrams are found by repeating the PDF template's own steps inside the
 * page -- parse with marked, turn the mermaid fences into .mermaid elements,
 * take the .mermaid elements in document order -- so the two commands cannot
 * disagree about which diagrams a document contains. This is also a re-render
 * from the markdown, not an extraction of the PDF's pixels: no PDF is produced
 * or read, and the paper size, margins and page scale have no bearing on it.
 */

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { assetRef, fontPrefix, ASSETS, VENDOR } = require("./buildHtml");
const { resolveChrome, launchArgs } = require("./renderPdf");

const LIB = __dirname;

/** Image formats this command can write. */
const IMAGE_TYPES = ["svg", "png"];

/** Themes mermaid 10 ships. */
const THEMES = ["default", "neutral", "dark", "forest", "base"];

/**
 * Characters no filename may carry on Windows, plus the path separators and
 * whitespace.
 *
 * Non-ASCII is deliberately left alone: a note called "架構圖.md" should
 * produce "架構圖-01.svg" on every platform, not a row of underscores.
 */
const UNSAFE_IN_FILENAME = /[<>:"/\\|?*\s]/g;

/**
 * Turns an input filename into a usable output prefix.
 *
 * The leading dash is the one that matters beyond tidiness: a file called
 * "-01.svg" reads as an option to nearly every command line tool the user
 * points at it afterwards.
 */
function sanitisePrefix(name) {
  const cleaned = String(name)
    .replace(UNSAFE_IN_FILENAME, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || "diagram";
}

/**
 * `<prefix>-01.svg`, in document order.
 *
 * Padded to two digits so the files sort correctly in every file browser, and
 * padded to a FIXED width rather than to the width of the total: padding to
 * the total means adding a tenth diagram silently renames the first nine, and
 * anyone who linked to <name>-1.svg from their own document now has nine
 * broken images. Past 99 the number simply grows, which renames nothing.
 */
function diagramFileName(prefix, index, type) {
  return `${prefix}-${String(index).padStart(2, "0")}.${type}`;
}

/**
 * The harness page.
 *
 * The markdown is base64-encoded into it. The PDF path embeds it raw and has
 * to reject any document containing a literal "</script>"; that trade is wrong
 * here, where the prose is not being rendered at all and a document that
 * merely *discusses* HTML would lose its diagrams for no reason.
 */
function buildMermaidHtml({
  input,
  output,
  theme = "default",
  background = "white",
  font = null,
  htmlLabels = false,
  cdn = false,
}) {
  if (!fs.existsSync(input)) {
    throw new Error(`Input markdown not found: ${input}`);
  }
  const markdown = fs.readFileSync(input, "utf8");

  const config = {
    theme,
    background,
    htmlLabels,
    // Reuses the PDF path's font handling, so a named face still falls through
    // to the bundled CJK stack rather than drawing Chinese as empty boxes --
    // a failure that is silent in a diagram, because the shapes still render.
    fontFamily: font
      ? `${fontPrefix(font)}"PingFang TC","Microsoft JhengHei","Noto Sans CJK TC",` +
        `"Source Han Sans TC","WenQuanYi Micro Hei",sans-serif`
      : null,
  };

  const tpl = fs.readFileSync(path.join(LIB, "mermaid-template.html"), "utf8");

  // Replacer FUNCTIONS, never replacement strings: in a replacement string
  // "$$" means one literal "$" and "$&" means the whole match, so any user
  // value containing them would be silently rewritten. Same trap, and same
  // fix, as lib/buildHtml.js.
  const html = tpl
    .replace("__TITLE__", () => `${path.basename(input)} -- diagrams`)
    .replace("__VENDOR_MARKED__", () => assetRef("marked", cdn))
    .replace("__VENDOR_MERMAID__", () => assetRef("mermaid", cdn))
    // "<" is escaped so a "</script>" arriving through --font or --background
    // cannot close the block early. JSON.stringify does not do this itself.
    .replace("__CONFIG__", () => JSON.stringify(config).replace(/</g, "\\u003c"))
    .replace("__MARKDOWN__", () => Buffer.from(markdown, "utf8").toString("base64"));

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, html, "utf8");

  // MathJax is never loaded here, so only these two decide whether the run
  // needed the network.
  const offline =
    !cdn &&
    ["marked", "mermaid"].every((name) => {
      try {
        return fs.statSync(path.join(VENDOR, ASSETS[name].file)).size > 0;
      } catch {
        return false;
      }
    });

  return { output, offline };
}

function indent(text) {
  return String(text || "unknown error").split("\n").join("\n    ");
}

/**
 * Serialises one diagram as a standalone SVG.
 *
 * The scale multiplies the declared width/height and never the viewBox, so the
 * drawing is untouched and only its natural size changes.
 */
async function serialiseSvg(page, diagram, scale) {
  const svg = await page.evaluate(
    (id, mult) => window.__md2pdfSerialize(id, mult),
    diagram.id,
    scale
  );
  if (!svg) throw new Error(`diagram ${diagram.index} vanished before it could be written`);
  return svg;
}

async function capturePng(page, diagram, scale) {
  const handle = await page.$(`#${diagram.id}`);
  if (!handle) throw new Error(`diagram ${diagram.index} vanished before it could be captured`);
  try {
    // PNG explicitly, never inferred: it is lossless, which a diagram needs --
    // JPEG artefacts cluster exactly on the hard edges that a diagram is made
    // of, and text is the worst case for them.
    //
    // omitBackground, always: the diagram paints its own background inside the
    // SVG, so this is what lets `--background transparent` be transparent
    // rather than the headless default (measured: #121212, not white).
    return await handle.screenshot({ type: "png", omitBackground: true });
  } catch (err) {
    // Chrome refuses a capture it cannot allocate, and says only "Unable to
    // capture screenshot". The ceiling is memory, not a fixed number -- 20000
    // x 20000 succeeded here and 32000 x 32000 did not -- so the message names
    // the size that was actually asked for and the two ways out, rather than
    // inventing a threshold that would be wrong on the next machine.
    const w = Math.round(diagram.width * scale);
    const h = Math.round(diagram.height * scale);
    throw new Error(
      `diagram ${diagram.index} is too large for Chrome to rasterise at ` +
        `${w} x ${h} pixels (${err.message}). Lower --scale, or use --type svg, ` +
        `which has no such limit.`
    );
  } finally {
    await handle.dispose().catch(() => undefined);
  }
}

/**
 * Renders every diagram and returns the finished bytes, in document order.
 *
 * Nothing reaches the disk until every diagram has rendered and been captured.
 * A run that half-fails would otherwise leave a directory that is partly this
 * document and partly the last one -- output that looks complete right up
 * until someone ships it.
 */
async function exportMermaid({
  html,
  outDir,
  prefix,
  type = "svg",
  scale = 1,
  strict = true,
  timeoutMs = 120000,
}) {
  if (!fs.existsSync(html)) throw new Error(`HTML not found: ${html}`);

  const executablePath = resolveChrome();
  let puppeteer;
  try {
    puppeteer = require("puppeteer-core");
  } catch {
    throw new Error(
      "puppeteer-core is not installed. Run `md2pdf setup` (or `npm install` in the md2pdf directory)."
    );
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: launchArgs(),
  });

  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") pageErrors.push(m.text());
    });

    // Every diagram is LAID OUT at deviceScaleFactor 1, whatever --scale says.
    // The scale is raised afterwards, for the capture only (see below).
    //
    // This matters because mermaid measures its own text to decide how wide a
    // node is, and on some systems that measurement depends on the device
    // scale factor: measured on Linux with Noto Sans CJK installed, the same
    // diagram lays out 136.0001 x 334.0001 CSS px at dsf 1 and 137.0001 x
    // 337.0001 at dsf 2 and above. Laying out at the requested scale would
    // therefore make `--scale 3` mean "three times as many pixels, of a
    // slightly different drawing", and the same document would export a
    // different SVG than PNG. Laying out once at 1 makes the geometry the
    // scale-independent thing it ought to be.
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

    await page.goto(pathToFileURL(html).href, {
      waitUntil: "networkidle0",
      timeout: timeoutMs,
    });
    // The page raises this once every diagram has been attempted. Waiting on
    // load instead would race mermaid, which renders asynchronously.
    try {
      await page.waitForFunction(() => document.body.dataset.renderDone === "1", {
        timeout: timeoutMs,
      });
    } catch (err) {
      // A page that never finishes says nothing about why on its own, and the
      // bare "Waiting failed: 120000ms exceeded" sends you looking at mermaid
      // when the real cause is usually that the page script never ran at all.
      const loaded = await page
        .evaluate(() => ({ marked: typeof window.marked, mermaid: typeof window.mermaid }))
        .catch(() => ({ marked: "unknown", mermaid: "unknown" }));
      const missing = ["marked", "mermaid"].filter((n) => loaded[n] === "undefined");
      throw new Error(
        `the page never finished rendering (${err.message}).` +
          (missing.length
            ? ` ${missing.join(" and ")} did not load -- with --cdn this needs network access, ` +
              `without it run \`md2pdf setup\` to vendor the assets.`
            : "") +
          (pageErrors.length ? `\n  page error: ${pageErrors[0]}` : "")
      );
    }

    const result = await page.evaluate(() => window.__md2pdfResult);
    if (!result) {
      throw new Error(
        "the page finished without reporting a result" +
          (pageErrors.length ? `: ${pageErrors[0]}` : "")
      );
    }
    if (result.error) {
      throw new Error(`Page failed while rendering: ${result.error}`);
    }

    const failures = result.diagrams.filter((d) => !d.ok);

    // Checked here rather than left to the reader, because this is the one
    // failure that produces a structurally perfect file nobody can read: every
    // shape, arrow and colour renders, the run reports success, and every CJK
    // label is an empty box. It matters more than it does for a PDF -- a PNG
    // has the boxes baked into the pixels, with no re-render to rescue it.
    const problems = [];
    if (result.cjkNeeded && result.cjkOk === false) {
      const install =
        process.platform === "linux"
          ? ` Install one -- Debian/Ubuntu: apt install fonts-noto-cjk | ` +
            `Fedora/RHEL: dnf install google-noto-sans-cjk-fonts | Alpine: apk add font-noto-cjk`
          : "";
      problems.push(
        `the diagrams contain CJK text but no installed font can render it -- ` +
          `every Chinese/Japanese/Korean label will be exported as empty boxes.${install}`
      );
    }

    if (strict && (failures.length || problems.length)) {
      const rendered = result.total - failures.length;
      const detail = [
        ...(failures.length
          ? [
              `${failures.length} of ${result.total} mermaid diagram(s) could not be rendered:\n` +
                failures.map((f) => `    - diagram ${f.index}: ${indent(f.error)}`).join("\n"),
            ]
          : []),
        ...problems,
      ];
      throw new Error(
        `Export verification failed:\n  - ${detail.join("\n  - ")}\n` +
          (rendered
            ? `Re-run with --no-verify to export the ${rendered} diagram(s) that did render.`
            : `Re-run with --no-verify to export anyway.`)
      );
    }

    // Raised only now that every diagram has been laid out and its size fixed
    // in width/height attributes, so this re-rasterises the finished drawing
    // rather than re-measuring it. That is what makes a PNG a true re-render
    // -- vector geometry redrawn at N times the resolution, not an upscale --
    // while keeping its pixel size exactly N times the SVG's size.
    if (type === "png" && scale !== 1) {
      await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: scale });
    }

    const pending = [];
    for (const diagram of result.diagrams.filter((d) => d.ok)) {
      pending.push({
        file: path.join(outDir, diagramFileName(prefix, diagram.index, type)),
        index: diagram.index,
        width: diagram.width,
        height: diagram.height,
        data:
          type === "svg"
            ? Buffer.from(await serialiseSvg(page, diagram, scale), "utf8")
            : await capturePng(page, diagram, scale),
      });
    }

    return { total: result.total, failures, problems, pending, pageErrors };
  } finally {
    // Closed by its own handle, always. Never pkill by pattern: one wide
    // enough to match this Chrome also matches the one the user is reading in.
    await browser.close().catch(() => undefined);
  }
}

/**
 * Names files a previous run of THIS prefix and THIS format left behind.
 *
 * Scoped to the format on purpose: exporting PNGs into a directory that
 * already holds the SVGs of the same document is a normal thing to do, and
 * calling those SVGs stale every time would train the user to ignore the
 * warning that matters.
 *
 * Deleting anything would be tidier and wrong: they are the user's files, in a
 * directory the user chose, and removing a diagram from a document is not
 * permission to delete. Saying which ones went unrewritten is enough.
 *
 * Names are compared case-insensitively where the filesystem is (Windows and
 * macOS): there, a file this run wrote as "Report-01.svg" IS the file already
 * on disk as "report-01.svg", and reporting it as stale would be wrong.
 */
const CASE_INSENSITIVE_FS = process.platform === "win32" || process.platform === "darwin";

function staleFiles(outDir, prefix, type, written) {
  const fold = (name) => (CASE_INSENSITIVE_FS ? name.toLowerCase() : name);
  const kept = new Set(written.map((file) => fold(path.basename(file))));
  const pattern = new RegExp(
    `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+\\.${type}$`,
    CASE_INSENSITIVE_FS ? "i" : ""
  );
  try {
    return fs
      .readdirSync(outDir)
      .filter((name) => pattern.test(name) && !kept.has(fold(name)))
      .sort();
  } catch {
    return [];
  }
}

module.exports = {
  buildMermaidHtml,
  exportMermaid,
  diagramFileName,
  sanitisePrefix,
  staleFiles,
  IMAGE_TYPES,
  THEMES,
};
