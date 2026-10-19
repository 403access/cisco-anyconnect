# Website

The project's static site: a hand-written landing page plus documentation rendered from the
repository's Markdown. Everything is served as plain files — **no framework and nothing to build at
request time**.

Two kinds of page:

| | |
| --- | --- |
| `index.html` | Hand-written HTML/CSS/JS. |
| `docs/*.html` | **Generated** from the Markdown in this repository by `build-docs.mjs`. The output is committed. |

```
website/
├── index.html                 landing page
├── styles.css                 design system + layout (shared by both page kinds)
├── docs.css                   prose typography and the docs shell
├── main.js                    tabs, copy buttons, mobile nav, reveal
├── favicon.svg
├── build-docs.mjs             Markdown → docs/*.html
├── check.py                   validates every page
├── package.json               one dev dependency: markdown-it
├── assets/                    generated images (committed)
│   ├── android-connected.{png,webp}
│   ├── ios-callback-error.{png,webp}
│   └── og-card.{png,webp}
├── docs/                      generated documentation pages (committed)
│   ├── index.html             documentation home
│   ├── readme.html
│   ├── api.html
│   ├── architecture.html
│   ├── android.html
│   ├── ios.html
│   ├── config-plugin.html
│   ├── troubleshooting.html
│   ├── example.html
│   ├── development.html
│   ├── contributing.html
│   └── changelog.html
└── mockups/                   sources for the images in assets/
    ├── device.css
    ├── android-connected.html
    ├── ios-callback-error.html
    ├── og-card.html
    └── render.sh
```

## Preview

Any static file server works:

```sh
python3 -m http.server 8000
# → http://localhost:8000
```

Opening `index.html` directly with `file://` works too — no modules, no `fetch`, no absolute root
paths. (The docs pages are pre-rendered rather than loaded client-side for exactly this reason.)

## Documentation pipeline

The Markdown files in the repository are the single source of truth. `build-docs.mjs` renders them
into `website/docs/`:

```sh
cd website
npm install          # once
npm run build        # renders all pages
```

> **After editing any Markdown file in this repository, run `npm run build` in `website/` and commit
> the regenerated HTML.** The generated pages are committed, so editing a source without re-rendering
> leaves the repository — and the deployment — inconsistent. `npm run check:docs` detects exactly this
> and names the stale files; it is what CI runs first.

### Link rewriting

Markdown links are rewritten per target, which is what makes the published docs navigable:

| Link in Markdown | Becomes |
| --- | --- |
| `./api.md`, `../README.md#state-semantics` | `api.html`, `readme.html#state-semantics` (anchor preserved) |
| `src/uri.ts`, `../LICENSE`, `website/` | a GitHub `blob` / `tree` URL — a static page cannot serve a `.ts` file or a directory |
| `https://www.cisco.com/…` | unchanged, with `target="_blank" rel="noreferrer noopener"` |
| `#state-semantics` | unchanged (same page) |

Heading anchors are generated with GitHub's slug rules, so links written against GitHub keep working.

Anything that cannot be resolved is reported as a warning during the build rather than silently left
broken.

### Adding a document

1. Write the Markdown in the repository (`docs/*.md` is the convention).
2. Add an entry to `PAGES` in `build-docs.mjs` — `source`, `id`, `title`, `blurb`, `group`. The order
   of that array drives the sidebar and the prev/next pager.
3. `npm run build`, then `npm run check`.

### Rendering notes

- GFM tables are wrapped in a scroll container, matching the hand-written pages.
- Task lists (`- [ ]`) become real checkboxes.
- Mermaid blocks cannot be drawn without shipping a JS library, so they are rendered as captioned
  source rather than as a broken code sample.
- Code is not syntax highlighted; `markdown-it` alone has no highlighter and the site avoids adding
  one.

## Checking your change

```sh
cd website
npm run verify         # the gate CI runs: docs current + every page valid
node --check main.js   # JavaScript syntax
```

`npm run verify` runs two checks:

- **`npm run check:docs`** — re-renders every page in memory and compares it with what is on disk. It
  fails, naming the files, when a Markdown source was edited without re-rendering, or when a page in
  `docs/` is orphaned because it is no longer listed in `PAGES`. It writes nothing.
- **`npm run check`** — `check.py` walks every HTML file, hand-written and generated, and verifies
  balanced tags, unique ids, that every local `href`/`src` exists, and that every `#fragment` resolves
  to an id in the target page. It also guards the hand-highlighted samples on the landing page.

Both run in CI before the deploy, so a stale render or a broken link fails the build instead of
reaching the site.

Beyond that: load the page, resize to phone width, click through the tabs, open the mobile nav, and
confirm the console is clean.

## Deploying

`.github/workflows/pages.yml` installs the site's dependencies, renders the docs, verifies the
committed output is current, runs `check.py`, and publishes `website/` to GitHub Pages on any change
to `website/**`, the Markdown sources, or the workflow itself.

One-time setup, in the repository on GitHub:

1. **Settings → Pages**
2. **Source** → *GitHub Actions*

### This setting is required, and the failure is silent

A project site can be pointed at a branch folder instead of a workflow
(**Deploy from a branch → `main` → `/docs`**). That is an easy mistake here, because this repository
has a top-level `docs/` folder full of Markdown — but it is not the site.

In that configuration GitHub runs its own Jekyll build and ignores the uploaded artifact, so:

- `https://<owner>.github.io/<repo>/` returns **404** — there is no `index.html` inside `docs/`
- `https://<owner>.github.io/<repo>/api.html` returns 200, rendering `docs/api.md` raw and unstyled
- the run still looks green: `Configure Pages`, `Upload static site` and `Deploy` all report success

If you see a 404 at the root while a deploy run succeeded, that is what happened. The workflow checks
`build_type` before doing anything and fails with the instruction, rather than leaving you to guess.

The site then appears at `https://<owner>.github.io/<repo>/` — for this repo,
`https://403access.github.io/cisco-anyconnect/`, with the docs at `/docs/`.

Any other static host works too: render the docs, publish `website/`, done. Netlify, Cloudflare Pages
and friends do not need a build command beyond `cd website && npm ci && npm run build` with
`website` as the publish directory.

### If the URL changes

`index.html` and `build-docs.mjs` hardcode absolute URLs. Update:

- the canonical link, `og:url`, `og:image` and `twitter:image` in `index.html`
- `GITHUB` in `build-docs.mjs` (used for source links and the "edit this page" links), then re-render
- the `GITHUB` constant in `mockups/og-card.html` if the social card mentions a repo

## Regenerating the images

The screenshots and social card are rendered from HTML/CSS. Requirements: Google Chrome and
ImageMagick (`magick`).

```sh
cd mockups
./render.sh
# or: CHROME=/path/to/chrome ./render.sh
```

The script writes `assets/*.png`, optimises them and emits WebP siblings. Both formats are committed;
`index.html` uses `<picture>` with the PNG as the fallback.

### About these images

**They are not device screenshots.** `android-connected.html` and `ios-callback-error.html` are
faithful re-creations of the bundled example app (`example/App.tsx`): the styling in `device.css` is
transcribed from that component's `StyleSheet`, and the status bars, device chrome and displayed
values are mock data.

The site labels them as rendered mockups in the screenshots section, and they should keep that label
if reused. Do not present them as captures of a real device or a live VPN session.

The iOS mockup intentionally shows `VPN transport up: null` — that is the documented iOS behaviour,
not a rendering mistake.

## Editing content

- **Landing page copy, sections, links:** `index.html`, in page order.
- **Documentation:** the Markdown files in the repository, never `website/docs/*.html` (they are
  overwritten).
- **Code samples on the landing page:** search for `id="code-` — each is hand-highlighted with `tk-*`
  spans, and only `<span>` elements may appear inside one. `check.py` enforces this.
- **Design tokens:** `:root` in `styles.css` — palette, spacing scale, font stacks. `docs.css` layers
  prose typography on top and duplicates no colours.

## Constraints worth preserving

- **No external requests.** No CDN, no web fonts, no analytics, no tracker. System fonts only.
- **Progressive enhancement.** With JavaScript disabled, all content is visible and readable; the
  reveal animation and tab switching are additive. `main.js` never hides anything it cannot show
  again.
- **Reduced motion** is respected: `prefers-reduced-motion: reduce` disables the reveal animation.
- **Accessibility.** Skip link, semantic landmarks, real `role="tablist"` semantics with arrow-key
  navigation, visible focus rings, labelled images, and a docs sidebar marked with
  `aria-current="page"`.
- **Honesty.** Everything on the page mirrors the README: this is a controller, not a tunnel, and it is
  not affiliated with Cisco.
