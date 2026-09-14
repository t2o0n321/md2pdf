#!/usr/bin/env node
"use strict";

/**
 * Prints the computed style of matched elements in a built HTML file.
 *
 * The DOM alone cannot answer the questions that matter about hand-written
 * HTML. `<td align="center">` carries that attribute either way; whether the
 * cell is actually centred depends on whether the page's own stylesheet
 * outranks the attribute, and only the computed value knows. Asserting on the
 * markup would pass for a document that prints entirely left-aligned.
 *
 * Usage: node test/computed.js <built.html> <selector> <prop>[,<prop>...] [--print]
 *        -> one line of JSON: an array of { text, props } in document order
 *
 * --print emulates print media. Several of the rules that matter only exist
 * there -- on screen a wide code block scrolls, and only on paper does the
 * overflow turn into characters that were never printed.
 */

const { pathToFileURL } = require("url");
const puppeteer = require("puppeteer-core");
const { resolveChrome } = require("../lib/renderPdf");

(async () => {
  const args = process.argv.slice(2);
  const print = args.includes("--print");
  const [file, selector, props] = args.filter((a) => a !== "--print");
  if (!file || !selector || !props) {
    throw new Error("usage: node test/computed.js <built.html> <selector> <prop,prop> [--print]");
  }

  const browser = await puppeteer.launch({
    executablePath: resolveChrome(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(file).href, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => document.body.dataset.renderDone === "1", {
      timeout: 60000,
    });
    // After the render, so the page script sees the media it was written for.
    if (print) await page.emulateMediaType("print");
    const result = await page.evaluate(
      (sel, list) =>
        Array.prototype.map.call(document.querySelectorAll(sel), (el) => {
          const computed = getComputedStyle(el);
          const props = {};
          list.split(",").forEach((p) => {
            props[p] = computed.getPropertyValue(p);
          });
          return {
            text: (el.textContent || "").trim().slice(0, 40),
            // Rendered size, for the rules that are about layout rather than
            // paint -- an image clamped to zero width is "visible" otherwise.
            width: Math.round(el.getBoundingClientRect().width),
            height: Math.round(el.getBoundingClientRect().height),
            // The gap between these two IS the clipping: whatever lies past
            // clientWidth has nowhere to go on paper.
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            props,
          };
        }),
      selector,
      props
    );
    process.stdout.write(JSON.stringify(result));
  } finally {
    await browser.close().catch(() => undefined);
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
