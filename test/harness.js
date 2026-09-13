#!/usr/bin/env node
"use strict";

/**
 * Prints the export harness's own report for a built HTML file.
 *
 * Some of what the exporter decides is not visible in the files it writes. The
 * CJK font check is the clearest case: on a machine that HAS the fonts, a run
 * succeeds whether the check was armed correctly or not, so asserting on the
 * CLI's output would pass even if the check were scoped wrongly -- and the
 * scoping only bites on a machine with no CJK font, which is not the machine
 * anyone develops on. Reading the flag directly is the only assertion that
 * actually holds the rule.
 *
 * Usage: node test/harness.js <built.html>   ->   one line of JSON on stdout
 */

const { pathToFileURL } = require("url");
const puppeteer = require("puppeteer-core");
const { resolveChrome } = require("../lib/renderPdf");

(async () => {
  const file = process.argv[2];
  if (!file) throw new Error("usage: node test/harness.js <built.html>");

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
    const result = await page.evaluate(() => window.__md2pdfResult);
    process.stdout.write(JSON.stringify(result));
  } finally {
    await browser.close().catch(() => undefined);
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
