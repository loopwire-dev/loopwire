# brand-assets

Generated from `apps/web/src/assets/images/logo.svg`.

## Included

- `source/`: original source logo copy.
- `vector/`: black and white SVG variants.
- `png/`: transparent PNG exports from `16x16` through `4096x4096`.
- `favicon/`: `favicon.svg`, PNG favicon sizes, and multi-size `favicon.ico`.
- `app-icons/`: PWA/app icon files (`apple-touch-icon`, Android Chrome, maskable, and MS tile).
- `social/`: Open Graph and Twitter/X card images in light and dark variants.
- `site.webmanifest`: example manifest wired to generated app icons.

## Regenerate

```bash
./brand-assets/generate.sh
```

Or pass a different SVG:

```bash
./brand-assets/generate.sh path/to/logo.svg
```

Social title defaults:

- Uses brand wordmark styling (bold weight, tight tracking).
- Uses Figtree (bold weight + tight tracking) for social title text.
- Uses the local `@fontsource/figtree` bold file when available.
- Centers the combined logo + wordmark block in every social image.
- Keeps light/dark card layouts symmetric by sharing the same geometry values.
- Uses a soft-black dark background (`#171717`) for dark variants.
- Adds green variants with `#0f8577` (accent) and `#0d7367` (accent hover).

Force a specific social title font:

```bash
TITLE_FONT="Figtree-Bold" ./brand-assets/generate.sh
```

Use Figtree for social titles:

```bash
mkdir -p brand-assets/fonts
# place Figtree-VariableFont_wght.ttf at brand-assets/fonts/Figtree-VariableFont_wght.ttf
./brand-assets/generate.sh
```
