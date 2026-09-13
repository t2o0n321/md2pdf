# Diagram types that lie about their size

Both of these ignore `useMaxWidth:false` and emit `width="100%"` with a
`max-width` style and no height at all. In a standalone file "100%" resolves
against nothing: the image reports 150x150 through an `<img>` tag, and as a PNG
its resolution follows whatever the viewport happened to be.

```mermaid
quadrantChart
    title Reach and engagement
    x-axis Low Reach --> High Reach
    y-axis Low Engagement --> High Engagement
    Campaign A: [0.3, 0.6]
    Campaign B: [0.7, 0.2]
```

```mermaid
xychart-beta
    title "Revenue"
    x-axis [jan, feb, mar]
    y-axis "Amount" 0 --> 100
    bar [50, 60, 70]
```
