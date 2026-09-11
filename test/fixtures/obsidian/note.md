# Obsidian syntax

## Embeds

A plain embed, resolved from the sibling `images/` folder:

![[sample.png]]

The same file with Obsidian's width suffix:

![[sample.png|120]]

## Callouts

> [!NOTE]
> A note callout.

> [!warning] Custom title
> Lower-case type with a title of its own.

> [!TIP]-
> A folded callout. A PDF cannot fold, so the marker is dropped.

## Inline

A [[Linked Note]] and an aliased [[Linked Note|alias for it]].

Some ==highlighted text== in a sentence.

## Code must survive untouched

These notes are full of shell snippets. None of the markup below may be
rewritten, because it is inside code.

```bash
# an embed inside a fence stays literal
echo "![[should-stay-literal.png]]"
grep '[[not-a-wikilink]]' file.txt
test "$a" == "$b" && echo "==not-a-highlight=="
```

And inline code: `![[also-literal.png]]`, `[[also-not-a-link]]`, `==also-plain==`.
