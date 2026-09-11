"use strict";

/**
 * HTML -> PDF via a real Chrome, driven by Puppeteer.
 *
 * Puppeteer rather than `chrome --headless --print-to-pdf`: that flag prints
 * when Chrome thinks the page is done, which for a page whose diagrams are
 * built by async JS means it can print before mermaid has drawn anything, and
 * it reports success either way. Driving it lets us wait for a signal the page
 * sets itself, and then check what actually rendered.
 */

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { cli } = require("./commandRunner");

/**
 * Where a Chromium-family browser lives, per platform.
 *
 * Built at call time from environment variables rather than hardcoded, because
 * the single most common Windows install is per-user under %LOCALAPPDATA% (no
 * admin rights needed) and would be missed entirely by a "C:\Program Files"
 * literal. Same reason the Linux list covers distro packages, /opt, snap and
 * flatpak: "chromium is at /usr/bin/chromium" is a Debian fact, not a Linux one.
 */
function chromeCandidates(platform = process.platform, env = process.env) {
  const home = env.HOME || env.USERPROFILE || "";
  // Join with the TARGET platform's rules, not the host's. path.join on macOS
  // would otherwise emit "C:\Program Files/Google\Chrome\..." for a Windows
  // path -- harmless in production (where host == target) but it makes this
  // function impossible to test from anywhere else, which is how a wrong path
  // list survives unnoticed.
  const join = platform === "win32" ? path.win32.join : path.posix.join;

  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      home && join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ].filter(Boolean);
  }

  if (platform === "win32") {
    const roots = [
      env.PROGRAMFILES,
      env["PROGRAMFILES(X86)"],
      env.LOCALAPPDATA, // per-user installs; the common case without admin
    ].filter(Boolean);
    const rel = [
      "Google\\Chrome\\Application\\chrome.exe",
      "Chromium\\Application\\chrome.exe",
      "Microsoft\\Edge\\Application\\msedge.exe",
      "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    ];
    return roots.flatMap((root) => rel.map((r) => join(root, r)));
  }

  // Linux and other unixes.
  const flatpak = [
    "/var/lib/flatpak/exports/bin",
    home && join(home, ".local/share/flatpak/exports/bin"),
  ].filter(Boolean);

  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/opt/google/chrome/chrome",
    "/opt/google/chrome/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/lib/chromium/chromium",
    "/usr/lib/chromium-browser/chromium-browser",
    "/snap/bin/chromium",
    "/snap/bin/google-chrome",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/brave-browser",
    ...flatpak.flatMap((d) => [
      join(d, "com.google.Chrome"),
      join(d, "org.chromium.Chromium"),
    ]),
  ];
}

/** PATH lookups, as a fallback when no known install location matched. */
function chromeCommands(platform = process.platform) {
  if (platform === "win32") return ["chrome", "msedge", "brave", "chromium"];
  return [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "brave-browser",
    "chrome",
  ];
}

function resolveChrome() {
  return cli.resolveBinary({
    envVar: "MD2PDF_CHROME",
    candidates: chromeCandidates(),
    commands: chromeCommands(),
    label: "Chrome/Chromium",
  });
}

/**
 * Launch flags.
 *
 * --disable-dev-shm-usage matters on Linux containers specifically: Docker
 * gives /dev/shm 64 MB by default and Chrome will crash mid-render on a large
 * document rather than fail cleanly. --no-sandbox is needed wherever this runs
 * as root (containers, CI), which is also Linux in practice.
 */
function launchArgs(platform = process.platform) {
  const args = ["--disable-gpu", "--font-render-hinting=none"];
  if (platform !== "win32") args.push("--no-sandbox");
  if (platform === "linux") args.push("--disable-dev-shm-usage");
  return args;
}

const FOOTER = `
<div style="width:100%;font-size:8px;color:#888;padding:0 15mm;
            font-family:-apple-system,Helvetica,Arial,sans-serif;">
  <span style="float:right;"><span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;

async function renderPdf({
  html,
  output,
  format = "A4",
  landscape = false,
  timeoutMs = 90000,
  pageNumbers = false,
  expects = null,
  strict = true,
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

    await page.goto(pathToFileURL(html).href, {
      waitUntil: "networkidle0",
      timeout: timeoutMs,
    });

    // The page raises this itself once markdown, mermaid and MathJax have all
    // settled. Waiting on a load event instead would race the diagrams.
    await page.waitForFunction(() => document.body.dataset.renderDone === "1", {
      timeout: timeoutMs,
    });

    const renderError = await page.evaluate(() => document.body.dataset.renderError || "");
    const stats = JSON.parse(
      (await page.evaluate(() => document.body.dataset.stats || "{}")) || "{}"
    );

    if (renderError) {
      throw new Error(`Page failed while rendering: ${renderError}`);
    }

    // The check that matters. Chrome exiting 0 only says it printed something;
    // it says nothing about whether the diagrams are on the page. A PDF whose
    // mermaid blocks silently came out blank looks like success everywhere
    // except in the file the reader opens.
    const problems = [];
    if (stats.mermaidTotal > 0 && stats.mermaidOk !== stats.mermaidTotal) {
      problems.push(
        `only ${stats.mermaidOk}/${stats.mermaidTotal} mermaid diagrams rendered` +
          (stats.mermaidFailed
            ? ` -- ${stats.mermaidFailed} failed to parse and would print as a ` +
              `"Syntax error" box`
            : "")
      );
    }
    if (stats.cjkNeeded && stats.cjkOk === false) {
      const install =
        process.platform === "linux"
          ? ` Install one -- Debian/Ubuntu: apt install fonts-noto-cjk | ` +
            `Fedora/RHEL: dnf install google-noto-sans-cjk-fonts | Alpine: apk add font-noto-cjk`
          : "";
      problems.push(
        `the document contains CJK text but no installed font can render it -- ` +
          `every Chinese/Japanese/Korean character will print as an empty box.${install}`
      );
    }
    if (expects) {
      if (expects.mermaid > 0 && stats.mermaidTotal === 0) {
        problems.push(
          `source declares ${expects.mermaid} mermaid block(s) but the page found none`
        );
      }
      if (expects.displayMath > 0 && stats.math === 0) {
        problems.push(
          `source declares ${expects.displayMath} display formula(s) but MathJax rendered none`
        );
      }
    }
    if (problems.length && strict) {
      throw new Error(
        `Render verification failed:\n  - ${problems.join("\n  - ")}\n` +
          `Re-run with --no-verify to produce the PDF anyway.`
      );
    }

    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    await page.pdf({
      path: output,
      format,
      landscape,
      printBackground: true,
      // Honours the @page size/margin declared in the template rather than
      // silently applying Chrome's own defaults on top of it.
      preferCSSPageSize: true,
      displayHeaderFooter: pageNumbers,
      ...(pageNumbers ? { headerTemplate: "<div></div>", footerTemplate: FOOTER } : {}),
    });

    const size = fs.existsSync(output) ? fs.statSync(output).size : 0;
    if (size <= 0) {
      throw new Error(`Chrome reported success but ${output} is empty.`);
    }

    return { output, size, stats, problems, pageErrors };
  } finally {
    // Always close the browser we opened, by its own handle. Never pkill by
    // pattern: one wide enough to match Chrome also matches the process that
    // launched it.
    await browser.close().catch(() => undefined);
  }
}

module.exports = { renderPdf, resolveChrome, chromeCandidates, chromeCommands, launchArgs };
