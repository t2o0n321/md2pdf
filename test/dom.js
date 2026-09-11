#!/usr/bin/env node
"use strict";

/**
 * Prints the post-render DOM of a built HTML file.
 *
 * Callouts, wikilinks and highlights are produced by script inside the page,
 * so they do not exist in the file --keep-html writes. Asserting against that
 * file is worse than useless: strings like `data-callout="note"` appear in the
 * template's own CSS and JS, so those assertions pass whether or not the
 * transform ever ran.
 *
 * Usage: node test/dom.js <built.html>
 */

const { pathToFileURL } = require("url");
const puppeteer = require("puppeteer-core");
const { resolveChrome } = require("../lib/renderPdf");

(async () => {
  const file = process.argv[2];
  if (!file) throw new Error("usage: node test/dom.js <built.html>");

  const browser = await puppeteer.launch({
    executablePath: resolveChrome(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(file).href, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => document.body.dataset.renderDone === "1", { timeout: 60000 });
    process.stdout.write(
      await page.evaluate(() => document.getElementById("content").innerHTML)
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
