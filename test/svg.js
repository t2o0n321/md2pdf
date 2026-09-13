#!/usr/bin/env node
"use strict";

/**
 * Opens a written .svg file the way anything else would, and reports what the
 * browser made of it.
 *
 * Asserting on the file's TEXT is not enough and quietly passes: a string
 * match for `<svg` and `width=` is satisfied by a file that is malformed XML,
 * declares its size as "100%", or draws nothing at all. An .svg is parsed as
 * XML by every consumer that is not a browser being lenient, so the only
 * assertion worth making is that it parses, and that something is actually on
 * the canvas afterwards.
 *
 * Usage: node test/svg.js <file.svg>   ->   one line of JSON on stdout
 */

const { pathToFileURL } = require("url");
const puppeteer = require("puppeteer-core");
const { resolveChrome } = require("../lib/renderPdf");

(async () => {
  const file = process.argv[2];
  if (!file) throw new Error("usage: node test/svg.js <file.svg>");

  const browser = await puppeteer.launch({
    executablePath: resolveChrome(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(file).href, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });

    const report = await page.evaluate(() => {
      const root = document.documentElement;
      // Malformed XML does not throw; Chrome renders an error document
      // instead, which is why this is checked rather than assumed.
      const failed = document.querySelector("parsererror");
      let bbox = null;
      try {
        const b = root.getBBox();
        bbox = { width: b.width, height: b.height };
      } catch {
        /* not an SVG root, or nothing drawable -- reported via rootTag/bbox */
      }
      // The visible label text, gathered from the drawing elements rather than
      // from root.textContent: mermaid ships a ~50-rule stylesheet inside every
      // SVG, and that CSS *is* a text node, so root.textContent is mostly
      // stylesheet and the labels fall off the end of any reasonable slice.
      const from = (tag) =>
        Array.from(document.getElementsByTagName(tag))
          .map((el) => el.textContent.replace(/\s+/g, " ").trim())
          .filter(Boolean);
      const labels = [...from("text"), ...from("foreignObject")];

      return {
        rootTag: root.tagName,
        parserError: failed ? failed.textContent.trim().slice(0, 300) : null,
        width: root.getAttribute("width"),
        height: root.getAttribute("height"),
        viewBox: root.getAttribute("viewBox"),
        bbox,
        texts: document.getElementsByTagName("text").length,
        foreignObjects: document.getElementsByTagName("foreignObject").length,
        labels: labels.join(" | "),
      };
    });

    process.stdout.write(JSON.stringify(report));
  } finally {
    await browser.close().catch(() => undefined);
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
