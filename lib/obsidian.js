"use strict";

/**
 * Obsidian-flavoured Markdown that standard parsers do not understand.
 *
 * Only the part that needs the filesystem lives here: resolving `![[file]]`
 * embeds to real paths. Callouts, wikilinks and highlights are handled in the
 * page itself, where the DOM makes it easy to leave code blocks alone.
 */

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

/** Folders Obsidian vaults conventionally keep attachments in. */
const ATTACHMENT_DIRS = ["", "images", "image", "attachments", "assets", "media", "_attachments"];

/** Extensions worth indexing when scanning for an attachment by bare filename. */
const EMBEDDABLE = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif",
]);

const MAX_DEPTH = 5;

/**
 * Splits markdown into code and non-code runs.
 *
 * Every rewrite below must skip code: these notes are full of shell snippets,
 * and a sample containing `[[` or `==` would otherwise be silently mangled
 * into an image or a highlight.
 */
function splitCode(md) {
  return md.split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/);
}

/**
 * Indexes files under `dir` by basename, so a bare `![[foo.png]]` can be found
 * wherever it actually lives -- Obsidian resolves embeds by filename across the
 * vault, not by path relative to the note.
 */
function indexAttachments(dir, depth = 0, index = new Map()) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return index;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      if (depth < MAX_DEPTH) indexAttachments(full, depth + 1, index);
    } else if (EMBEDDABLE.has(path.extname(entry.name).toLowerCase())) {
      // First match wins, so shallower files beat deeper duplicates.
      if (!index.has(entry.name)) index.set(entry.name, full);
    }
  }
  return index;
}

/**
 * Finds the file an embed target refers to.
 *
 * Tries the literal path first (an embed may carry one), then the usual
 * attachment folders, and only then falls back to a filename lookup across the
 * note's directory tree.
 */
function resolveTarget(target, baseDir, index) {
  const direct = [];
  for (const sub of ATTACHMENT_DIRS) {
    direct.push(path.resolve(baseDir, sub, target));
  }
  for (const candidate of direct) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return index().get(path.basename(target)) || null;
}

/**
 * Rewrites `![[target|size]]` into standard Markdown images pointing at
 * absolute file: URLs.
 *
 * Absolute rather than relative because the generated HTML lives in a temp
 * directory, so anything relative would resolve against the wrong place and
 * every image would silently fail to load.
 *
 * Obsidian's size suffix is `|width` or `|widthxheight` in pixels; a non-numeric
 * suffix is an alias and is used as alt text instead.
 */
function transformEmbeds(md, baseDir) {
  let cached = null;
  const index = () => (cached ??= indexAttachments(baseDir));

  const resolved = [];
  const missing = [];

  const out = splitCode(md)
    .map((chunk, i) => {
      if (i % 2 === 1) return chunk; // code run, leave alone
      return chunk.replace(/!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, (whole, rawTarget, suffix) => {
        const target = rawTarget.trim();
        const file = resolveTarget(target, baseDir, index);
        if (!file) {
          missing.push(target);
          return whole;
        }
        resolved.push(target);

        const url = pathToFileURL(file).href;
        const size = (suffix || "").trim();
        const dims = /^(\d+)(?:x(\d+))?$/i.exec(size);
        if (dims) {
          const attrs = `width="${dims[1]}"${dims[2] ? ` height="${dims[2]}"` : ""}`;
          return `<img src="${url}" ${attrs} alt="${escapeAttr(target)}">`;
        }
        return `![${escapeAlt(size || target)}](${url})`;
      });
    })
    .join("");

  return { markdown: out, resolved, missing };
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeAlt(s) {
  return String(s).replace(/[[\]]/g, "");
}

module.exports = { transformEmbeds, splitCode, indexAttachments, ATTACHMENT_DIRS };
