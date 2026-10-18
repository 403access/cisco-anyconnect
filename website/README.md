# Website

The project's static marketing site. **No build step, no dependencies, no framework** — plain HTML,
CSS and a small amount of vanilla JavaScript, served as-is.

```
website/
├── index.html              the whole page
├── styles.css              design system + layout
├── main.js                 tabs, copy buttons, mobile nav, reveal (progressive enhancement)
├── favicon.svg
├── assets/                 generated images (committed)
│   ├── android-connected.{png,webp}
│   ├── ios-callback-error.{png,webp}
│   └── og-card.{png,webp}
└── mockups/                sources for the images above
    ├── device.css
    ├── android-connected.html
    ├── ios-callback-error.html
    ├── og-card.html
    └── render.sh
```

## Preview

Any static file server works. From this directory:

```sh
python3 -m http.server 8000
# → http://localhost:8000
```

Opening `index.html` directly with `file://` also works — the page uses no modules, fetch calls or
absolute root paths.

## Deploying

The repository ships `.github/workflows/pages.yml`, which publishes this directory to GitHub Pages on
every push to `main` that touches `website/**`.

One-time setup, in the repository on GitHub:

1. **Settings → Pages**
2. **Source** → *GitHub Actions*

After that, pushes deploy automatically and the site appears at
`https://<owner>.github.io/<repo>/` — for this repo, `https://403access.github.io/cisco-anyconnect/`.

Any other static host (Netlify, Cloudflare Pages, S3, nginx) works too: publish the `website/`
directory and nothing else.

### If the URL changes

`index.html` hardcodes absolute URLs for the canonical link and social card. Update these three places
if you deploy elsewhere or add a custom domain:

- `<link rel="canonical">`
- `og:url` / `og:image`
- `twitter:image`

The outbound links to GitHub and the docs use absolute repository URLs
(`https://github.com/403access/cisco-anyconnect/…`). If the repository moves, update them in
`index.html` (nav, docs grid, footer).

## Regenerating the images

The screenshots and the social card are rendered from HTML/CSS by a script. Requirements: Google
Chrome and ImageMagick (`magick`).

```sh
cd mockups
./render.sh
```

Override the browser path if needed:

```sh
CHROME=/path/to/chrome ./render.sh
```

The script writes `assets/*.png`, then optimises them and emits WebP siblings. Both formats are
committed; `index.html` uses `<picture>` with the PNG as the fallback.

### About these images

**They are not device screenshots.** `android-connected.html` and `ios-callback-error.html` are
faithful re-creations of the bundled example app (`example/App.tsx`): the styling in `device.css` is
transcribed from that component's `StyleSheet`, and the status bars, device chrome and displayed
values are mock data.

The site labels them as rendered mockups in the screenshots section, and the images should keep that
label if they are reused. Do not present them as captures of a real device or a live VPN session.

The iOS mockup intentionally shows `VPN transport up: null` — that is the documented iOS behaviour,
not a rendering mistake.

## Editing content

- **Copy, sections, links:** `index.html`, one file, top to bottom in page order.
- **Code samples:** search for `id="code-` — each sample is hand-highlighted with `tk-*` spans. Only
  `<span>` elements belong inside a highlighted `<code>` block; the site checker enforces this.
- **Docs links:** they point at the repository's `docs/` and `README.md` rather than duplicating the
  text, so documentation has a single source of truth.
- **Design tokens:** `:root` in `styles.css` holds the palette, spacing scale and font stacks.

## Constraints worth preserving

- **No external requests.** No CDN, no web fonts, no analytics, no tracker. System fonts only.
- **Progressive enhancement.** With JavaScript disabled, all content is visible and readable; the
  reveal animation and tabs are additive. `main.js` never hides anything it cannot show again.
- **Reduced motion** is respected: `prefers-reduced-motion: reduce` disables the reveal animation
  entirely.
- **Accessibility.** Skip link, semantic landmarks, real `role="tablist"` semantics with arrow-key
  navigation, visible focus rings, and captions/labels on images.
- **Honesty.** Claims on the page mirror the README: this is a controller, not a tunnel, and it is not
  affiliated with Cisco.

## Checking your change

No test runner is needed for a static page, but two checks catch most mistakes:

```sh
python3 check.py     # tag balance, local asset references, duplicate/dangling ids
node --check main.js # JavaScript syntax
```

`check.py` walks `index.html` and verifies that every local `href`/`src` resolves to a file, that
every `aria-controls` and `data-copy` points at a real `id`, that `id`s are unique, and that
highlighted code blocks contain nothing but `tk-*` spans.

Beyond that: load the page, resize to phone width, click through the tabs, open the mobile nav, and
confirm the console is clean. With no framework between your markup and the browser, anything broken
is visible immediately.
