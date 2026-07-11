The Liquid Glass material — a blurred, translucent floating slab with a specular edge and sheen. Wrap any floating control, popover, or sheet in it.

```jsx
<GlassSurface variant="sheet" weight="heavy" style={{padding:20}}>…</GlassSurface>
<GlassSurface variant="pill" style={{padding:'10px 16px'}}>隊長</GlassSurface>
```

variant: `pane | pill | sheet | capsule`. weight: `thin | regular | heavy`. tint: `accent | sky | success`. NOTE: CSS can't refract like true Liquid Glass — this simulates depth with blur + edge sheen.
