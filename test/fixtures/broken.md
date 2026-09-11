# Broken diagram

The diagram below is intentionally malformed. Rendering it must fail
verification rather than quietly producing a PDF with a "Syntax error" box
where the diagram should be.

```mermaid
flowchart LR
    A[ --> B{{{ not valid mermaid
```
