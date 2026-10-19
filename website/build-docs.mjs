#!/usr/bin/env node
/**
 * Pre-renders the repository's Markdown documentation into static HTML under `docs/`.
 *
 * The output is committed, so the site works from `file://`, on any static host, and on GitHub
 * Pages without a build step at request time. Run this after editing any Markdown file:
 *
 *   cd website && npm install && npm run build
 *
 * Link handling is the interesting part:
 *   - links between rendered documents become relative .html links (anchors preserved)
 *   - links to anything else in the repo (source files, LICENSE, directories) go to GitHub, since a
 *     static page cannot serve a TypeScript file or a directory listing
 *   - external links are left alone and get target/rel
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import MarkdownIt from 'markdown-it';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'docs');
const GITHUB = 'https://github.com/403access/cisco-anyconnect';

/** Every document that gets rendered, in sidebar/pager order. */
const PAGES = [
  {
    id: 'readme',
    source: 'README.md',
    title: 'Overview',
    blurb: 'What the module does, requirements, installation and a quick start.',
    group: 'Guide',
  },
  {
    id: 'api',
    source: 'docs/api.md',
    title: 'API reference',
    blurb: 'Every function, option, event payload, type and error code.',
    group: 'Guide',
  },
  {
    id: 'architecture',
    source: 'docs/architecture.md',
    title: 'Architecture',
    blurb: 'Layers, the connect and callback flows, and the state machine.',
    group: 'Guide',
  },
  {
    id: 'android',
    source: 'docs/android.md',
    title: 'Android guide',
    blurb: 'URI External Control, MDM managed config and package visibility.',
    group: 'Platforms',
  },
  {
    id: 'ios',
    source: 'docs/ios.md',
    title: 'iOS guide',
    blurb: 'Query schemes, Connect On-Demand, and why state is limited.',
    group: 'Platforms',
  },
  {
    id: 'config-plugin',
    source: 'docs/config-plugin.md',
    title: 'Config plugin',
    blurb: 'Plugin options and exactly what they write.',
    group: 'Platforms',
  },
  {
    id: 'troubleshooting',
    source: 'docs/troubleshooting.md',
    title: 'Troubleshooting',
    blurb: 'Symptom, cause, fix — plus a diagnostics dump.',
    group: 'Platforms',
  },
  {
    id: 'example',
    source: 'example/README.md',
    title: 'Example app',
    blurb: 'Run the bundled demo against a real gateway.',
    group: 'Guide',
  },
  {
    id: 'development',
    source: 'DEVELOPMENT.md',
    title: 'Development',
    blurb: 'Build, test, native iteration and releasing.',
    group: 'Project',
  },
  {
    id: 'contributing',
    source: 'CONTRIBUTING.md',
    title: 'Contributing',
    blurb: 'Conventions, scope and PR expectations.',
    group: 'Project',
  },
  {
    id: 'changelog',
    source: 'CHANGELOG.md',
    title: 'Changelog',
    blurb: 'Release history.',
    group: 'Project',
  },
].map((page) => ({ ...page, output: `${page.id}.html` }));

const BY_SOURCE = new Map(PAGES.map((page) => [page.source, page]));
const BY_ID = new Map(PAGES.map((page) => [page.id, page]));
const GROUPS = ['Guide', 'Platforms', 'Project'];

// ---------------------------------------------------------------------------- helpers

const esc = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** GitHub-compatible heading slug: lowercase, punctuation stripped, spaces to hyphens. */
function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

/** Repo-relative POSIX path for an absolute path. */
function relativeToRepo(absolute) {
  return path.relative(REPO, absolute).split(path.sep).join('/');
}

/**
 * Rewrites one href found in `sourceAbs`.
 */
function rewriteHref(href, sourceAbs) {
  if (!href) return href;
  if (/^(https?:|mailto:|tel:|data:|#)/i.test(href)) return href;

  const [rawPath, ...hashParts] = href.split('#');
  const hash = hashParts.length > 0 ? `#${hashParts.join('#')}` : '';
  if (!rawPath) return href;

  let decoded;
  try {
    decoded = decodeURI(rawPath);
  } catch {
    decoded = rawPath;
  }

  const resolved = path.resolve(path.dirname(sourceAbs), decoded);
  const relative = relativeToRepo(resolved);

  const page = BY_SOURCE.get(relative);
  if (page) return `${page.output}${hash}`;

  if (fs.existsSync(resolved)) {
    const kind = fs.statSync(resolved).isDirectory() ? 'tree' : 'blob';
    return `${GITHUB}/${kind}/main/${relative}${hash}`;
  }

  console.warn(`  ! unresolved link "${href}" in ${relativeToRepo(sourceAbs)}`);
  return href;
}

// ---------------------------------------------------------------------------- markdown

const md = new MarkdownIt({ html: true, linkify: true });

md.core.ruler.push('heading_ids', (state) => {
  const used = new Set();

  for (let index = 0; index < state.tokens.length; index += 1) {
    const token = state.tokens[index];
    if (token.type !== 'heading_open') continue;

    const inline = state.tokens[index + 1];
    const text = (inline?.children ?? [])
      .filter((child) => child.type === 'text' || child.type === 'code_inline')
      .map((child) => child.content)
      .join('')
      .trim();

    const base = slugify(text) || 'section';
    let slug = base;
    let counter = 1;
    while (used.has(slug)) {
      slug = `${base}-${counter}`;
      counter += 1;
    }
    used.add(slug);

    token.attrSet('id', slug);
    state.env.headings ??= [];
    state.env.headings.push({
      level: Number(token.tag.slice(1)),
      text: text || slug,
      id: slug,
    });
  }
});

const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));

md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const target = tokens[index].attrGet('href');
  const rewritten = env.rewrite ? env.rewrite(target) : target;

  if (rewritten && rewritten !== target) {
    tokens[index].attrSet('href', rewritten);
  }

  if (/^https?:/i.test(rewritten ?? '')) {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noreferrer noopener');
  }

  return defaultLinkOpen(tokens, index, options, env, self);
};

function renderMarkdown(source, sourceAbs) {
  const raw = fs.readFileSync(sourceAbs, 'utf8');
  const env = { rewrite: (href) => rewriteHref(href, sourceAbs), headings: [] };
  let html = md.render(raw, env);

  // Tables need a scroll container, exactly like the hand-written pages.
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>');
  html = html.replace(/<\/table>/g, '</table></div>');

  // GFM task lists.
  html = html.replace(
    /<li>\[ \]\s*/g,
    '<li class="task"><span class="task-box" aria-hidden="true"></span>'
  );
  html = html.replace(
    /<li>\[[xX]\]\s*/g,
    '<li class="task"><span class="task-box task-box--done" aria-hidden="true"></span>'
  );

  // Mermaid blocks cannot be drawn without a JS library; label them so the source is not mistaken
  // for a broken code sample.
  html = html.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    '<figure class="diagram"><figcaption>Diagram — Mermaid source</figcaption>' +
      '<pre class="diagram__body"><code>$1</code></pre></figure>'
  );

  return { html, headings: env.headings };
}

// ---------------------------------------------------------------------------- chrome

const markSvg = `<svg class="brand__mark" viewBox="0 0 32 32" aria-hidden="true">
  <defs><linearGradient id="brandGrad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#a78bfa"/>
  </linearGradient></defs>
  <rect width="32" height="32" rx="9" fill="url(#brandGrad)"/>
  <path d="M16 7.4l6.4 2.9v5.4c0 3.9-2.6 7-6.4 8-3.8-1-6.4-4.1-6.4-8v-5.4L16 7.4z"
        fill="none" stroke="#04121a" stroke-width="1.9" stroke-linejoin="round"/>
  <path d="M13.3 15.9l2.1 2.1 3.5-4" fill="none" stroke="#04121a" stroke-width="1.9"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const menuSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>`;

const githubSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.1-1.47-1.1-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/>
</svg>`;

function sidebar(activeId) {
  return GROUPS.map((group) => {
    const items = PAGES.filter((page) => page.group === group)
      .map(
        (page) =>
          `<li><a href="${page.output}"${
            page.id === activeId ? ' aria-current="page" class="is-active"' : ''
          }>${esc(page.title)}</a></li>`
      )
      .join('\n          ');

    return `<p class="docs-sidebar__group">${esc(group)}</p>
        <ul>
          ${items}
        </ul>`;
  }).join('\n        ');
}

function toc(headings) {
  const entries = headings.filter((heading) => heading.level === 2 || heading.level === 3);
  if (entries.length === 0) return '';

  return `<p class="docs-toc__title">On this page</p>
      <ul>
        ${entries
          .map(
            (heading) =>
              `<li class="docs-toc__level-${heading.level}"><a href="#${heading.id}" title="${esc(
                heading.text
              )}">${esc(tocLabel(heading.text))}</a></li>`
          )
          .join('\n        ')}
      </ul>`;
}

/**
 * Trims a heading down to something scannable in a 190px column.
 *
 * The API reference uses headings like `getAppInfo(): Promise<AnyConnectAppInfo | null>`, which is
 * precise in the body and unusable as a table-of-contents label.
 */
function tocLabel(text) {
  const signature = /^([A-Za-z_$][\w$]*(?:\([^)]*\))?)\s*:\s+\S/.exec(text);
  return signature ? signature[1] : text;
}

function pager(page) {
  const index = PAGES.indexOf(page);
  const previous = PAGES[index - 1];
  const next = PAGES[index + 1];

  const link = (target, direction) =>
    target
      ? `<a class="docs-pager__link docs-pager__link--${direction}" href="${target.output}">
          <span class="docs-pager__label">${direction === 'prev' ? 'Previous' : 'Next'}</span>
          <span class="docs-pager__title">${esc(target.title)}</span>
        </a>`
      : '<span></span>';

  return `${link(previous, 'prev')}${link(next, 'next')}`;
}

function layout({ id, title, description, body, headings = [], withPager = true }) {
  const page = BY_ID.get(id);
  const tocHtml = toc(headings);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)} · expo-cisco-anyconnect</title>
    <meta name="description" content="${esc(description)}" />
    <meta name="theme-color" content="#07090c" />
    <meta name="color-scheme" content="dark" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="../styles.css" />
    <link rel="stylesheet" href="../docs.css" />
    <script defer src="../main.js"></script>
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>

    <header class="site-header" data-header>
      <div class="container site-header__inner">
        <a class="brand" href="../index.html" aria-label="expo-cisco-anyconnect home">
          ${markSvg}
          <span class="brand__text">expo-cisco-anyconnect</span>
        </a>

        <button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false"
          aria-controls="site-nav" aria-label="Toggle navigation">${menuSvg}</button>

        <nav class="nav" id="site-nav" data-nav aria-label="Primary">
          <a href="../index.html#capabilities">Capabilities</a>
          <a href="../index.html#screenshots">Screenshots</a>
          <a href="../index.html#usage">Usage</a>
          <a href="index.html">Docs</a>
          <a class="nav__cta" href="${GITHUB}" target="_blank" rel="noreferrer noopener">
            ${githubSvg}
            GitHub
          </a>
        </nav>
      </div>
    </header>

    <main id="main">
      <div class="container docs-shell">
        <aside class="docs-sidebar">
          <nav aria-label="Documentation">
            ${sidebar(id)}
          </nav>
          <p class="docs-sidebar__back"><a href="../index.html">← Back to the project</a></p>
        </aside>

        <article class="prose" id="content">
          <p class="docs-eyebrow">Documentation</p>
          ${body}
          ${withPager ? `<nav class="docs-pager" aria-label="Pagination">${pager(page)}</nav>` : ''}
          ${
            page
              ? `<p class="docs-edit"><a href="${GITHUB}/blob/main/${page.source}" target="_blank" rel="noreferrer noopener">Edit this page on GitHub</a></p>`
              : ''
          }
        </article>

        ${
          tocHtml
            ? `<aside class="docs-toc" aria-label="On this page">
          ${tocHtml}
        </aside>`
            : '<aside class="docs-toc" aria-hidden="true"></aside>'
        }
      </div>
    </main>

    <footer class="site-footer">
      <div class="container">
        <div class="footer__legal">
          <span>
            Not affiliated with, endorsed by, or sponsored by Cisco Systems, Inc. AnyConnect and Cisco
            Secure Client are trademarks of Cisco Systems, Inc.
          </span>
          <span>MIT © <span data-year>2026</span></span>
        </div>
      </div>
    </footer>
  </body>
</html>
`;
}

function docsIndex() {
  const cards = GROUPS.map((group) => {
    const items = PAGES.filter((page) => page.group === group)
      .map(
        (page) => `<a class="docs-card" href="${page.output}">
            <span class="docs-card__title">${esc(page.title)}</span>
            <span class="docs-card__blurb">${esc(page.blurb)}</span>
          </a>`
      )
      .join('\n          ');

    return `<section class="docs-group">
          <h2>${esc(group)}</h2>
          <div class="docs-cards">
          ${items}
          </div>
        </section>`;
  }).join('\n        ');

  const body = `<h1>Documentation</h1>
        <p class="docs-lede">
          Everything about <code>expo-cisco-anyconnect</code>, rendered from the repository's Markdown
          so the site and the source cannot drift apart.
        </p>
        ${cards}
        <p class="docs-note">
          Looking for installation and a first connection? Start with the
          <a href="readme.html">overview</a>. Hitting a wall? The
          <a href="troubleshooting.html">troubleshooting guide</a> opens with the three failures that
          account for most reports.
        </p>`;

  return layout({
    id: 'index',
    title: 'Documentation',
    description:
      'Documentation for expo-cisco-anyconnect: API reference, architecture, platform guides, and troubleshooting.',
    body,
    withPager: false,
  });
}

// ---------------------------------------------------------------------------- main

fs.mkdirSync(OUT, { recursive: true });

for (const page of PAGES) {
  const sourceAbs = path.join(REPO, page.source);
  if (!fs.existsSync(sourceAbs)) {
    throw new Error(`missing source document: ${page.source}`);
  }

  const { html, headings } = renderMarkdown(page.source, sourceAbs);
  const output = path.join(OUT, page.output);

  fs.writeFileSync(
    output,
    layout({
      id: page.id,
      title: page.title,
      // The document's own first paragraph is a better description than nothing; the blurb is a
      // predictable alternative.
      description: page.blurb,
      body: html,
      headings,
    })
  );

  console.log(`  ${page.source} → website/docs/${page.output}`);
}

fs.writeFileSync(path.join(OUT, 'index.html'), docsIndex());
console.log('  (index) → website/docs/index.html');
console.log(`\nrendered ${PAGES.length + 1} pages`);
