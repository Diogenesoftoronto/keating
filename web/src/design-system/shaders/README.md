# Shader surfaces

Import `ShaderSurface` from `@/design-system/shaders`. Give the host a size and
`position: relative`. The surface fills that host and inherits its corner radius.
Put foreground content in a positioned sibling above the canvas.

```tsx
<div style={{ position: "relative" }}>
  <ShaderSurface effect="field" />
  <div style={{ position: "relative" }}>Choose a lesson to begin.</div>
</div>
```

Use `field` for empty states. The pointer reveals the study-object pattern.
Use `ink` for busy surfaces. Use `variant="progress"` inside the **filled**
portion of a progress bar. Its parent controls the fill width.

- `strength` sets opacity from 0 to 1. Omit it for the tuned theme values.
- `tint` takes a normalized RGB triple, e.g. `[0.08, 0.45, 0.24]`.
  It sets field ink color or multiplies marble color.
- `className` styles the surface wrapper.

Give text over animated ink a solid backing. Always convey state through
visible text or an accessible progress control. The shader is decorative and
may be disabled, still, or unavailable. The app shell owns the paper/glass overlay.
