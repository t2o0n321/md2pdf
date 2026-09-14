"use strict";

/**
 * GitHub-flavoured footnotes: `text[^1]` plus a `[^1]: note` definition line.
 *
 * marked does not implement them, and doing nothing is not neutral: to a
 * CommonMark parser `[^1]: this is the note` is a *link reference definition*
 * labelled `^1`, so the note itself is consumed as a URL and disappears from
 * the document, while `[^1]` in the prose prints as a link reading "^1". The
 * reader sees a marker pointing at nothing and never learns the note existed.
 *
 * So the two forms are resolved here, in the source, before marked can eat
 * them -- the same reason Obsidian embeds are handled in lib/obsidian.js.
 */

const { splitCode } = require("./obsidian");

/** `[^label]: text`, at the start of a line. */
const DEFINITION = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/;

/**
 * A reference is only recognised when something defines it.
 *
 * Without that rule a character class written in prose -- `grep [^a-z]`,
 * outside backticks -- would be rewritten into a footnote marker. Requiring a
 * definition is also exactly what GitHub does, so a document renders the same
 * in both places.
 */
function referencePattern(labels) {
  const alternatives = [...labels]
    .sort((a, b) => b.length - a.length) // longest first: [^10] must beat [^1]
    .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(`\\[\\^(${alternatives})\\]`, "g");
}

/** Opens or closes a fenced code block. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Pulls the definitions out of the document.
 *
 * Deliberately line-oriented over the WHOLE source rather than over the code
 * runs splitCode() returns: those runs break at inline `code`, which can sit
 * in the middle of a definition, and a definition chopped at the backtick
 * leaves its own tail behind in the prose. Fenced blocks still have to be
 * skipped, so they are tracked here instead.
 *
 * A definition runs to the first line that is neither blank nor indented, so
 * the multi-paragraph form GFM allows survives intact.
 */
function extractDefinitions(source, defs) {
  const lines = source.split("\n");
  const kept = [];
  let fence = null;

  for (let i = 0; i < lines.length; i++) {
    const opener = FENCE.exec(lines[i]);
    if (fence) {
      if (opener && opener[1][0] === fence[0] && opener[1].length >= fence.length) fence = null;
      kept.push(lines[i]);
      continue;
    }
    if (opener) {
      fence = opener[1];
      kept.push(lines[i]);
      continue;
    }

    const m = DEFINITION.exec(lines[i]);
    if (!m) {
      kept.push(lines[i]);
      continue;
    }

    const body = [m[2]];
    let j = i + 1;
    let pending = [];
    while (j < lines.length) {
      const line = lines[j];
      if (!line.trim()) {
        pending.push("");
        j++;
        continue;
      }
      if (!/^(?: {2,}|\t)/.test(line)) break;
      body.push(...pending, line.replace(/^(?: {4}|\t)/, ""));
      pending = [];
      j++;
    }
    // Blank lines trailing the definition belong to the document, not the note.
    kept.push(...pending);
    defs.set(m[1], body.join("\n").trim());
    i = j - 1;
  }

  return kept.join("\n");
}

/**
 * Rewrites footnotes into plain markdown plus a little HTML.
 *
 * Markers become `<sup>` links; the notes become an ordered list at the end of
 * the document, so their own markdown (links, code, emphasis) is still parsed.
 * Every item is written with a `1.` marker on purpose: an ordered list numbers
 * itself from the first marker, which keeps the continuation indent at a
 * constant three columns no matter how many notes there are.
 *
 * Numbering follows first *reference*, not definition order, which is what
 * GitHub does and what a reader expects.
 */
function transformFootnotes(md) {
  const defs = new Map();
  const stripped = extractDefinitions(md, defs);

  if (!defs.size) return { markdown: md, used: [], unused: [] };

  const pattern = referencePattern(defs.keys());
  const order = [];
  const numberOf = new Map();

  // References are inline, so here the code runs are the right unit: a
  // `[^1]` shown inside backticks is a sample, not a marker.
  const withRefs = splitCode(stripped)
    .map((chunk, i) => {
      if (i % 2 === 1) return chunk; // code run, leave alone
      pattern.lastIndex = 0;
      return chunk.replace(pattern, (whole, label) => {
        if (!numberOf.has(label)) {
          numberOf.set(label, order.push(label));
        }
        const n = numberOf.get(label);
        return (
          `<sup class="fnref" id="fnref-${n}">` +
          `<a href="#fn-${n}">${n}</a></sup>`
        );
      });
    })
    .join("");

  // A definition nothing refers to is dropped, as on GitHub. It is reported so
  // the caller can say so rather than leave the author wondering.
  const unused = [...defs.keys()].filter((l) => !numberOf.has(l));
  if (!order.length) return { markdown: md, used: [], unused };

  const items = order.map((label, idx) => {
    const n = idx + 1;
    const body = defs
      .get(label)
      .split("\n")
      .map((line, k) => (k === 0 || !line ? line : `   ${line}`))
      .join("\n");
    return `1. <span id="fn-${n}"></span>${body} [↩](#fnref-${n})`;
  });

  const section = [
    "",
    '<hr class="footnotes-sep">',
    "",
    '<div class="footnotes">',
    "",
    ...items,
    "",
    "</div>",
    "",
  ].join("\n");

  return { markdown: `${withRefs.replace(/\s*$/, "")}\n${section}`, used: order, unused };
}

module.exports = { transformFootnotes, extractDefinitions };
