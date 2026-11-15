# Neon Ace

A production-ready, single-page blackjack game built with plain HTML, CSS and JavaScript. No frameworks, no build tooling, no remote fonts, no analytics and no real-money wagering. The critical path is roughly **29 KB gzipped**.

**Live production site:** <https://neon-ace.pages.dev/> — deployed on Cloudflare Pages (Direct Upload).

---

## What is included

- Six-deck shoe (312 cards), shuffled locally with the Web Crypto API and Fisher-Yates.
- Dealer stands on all 17s (S17), blackjack pays 3:2, double after split, up to four hands.
- Split aces receive one card each and cannot be resplit; split 21 pays 1:1.
- Virtual bankroll, bet selection, sound toggle and session stats persisted in `localStorage`.
- Keyboard shortcuts (`H`, `S`, `D`, `P`, `N`, `M`), visible focus, live status announcements, labelled cards and reduced-motion support.
- Complete on-page rules, basic-strategy reference, FAQ, accessibility notes and source transparency.
- SEO/GEO layer: canonical, Open Graph, Twitter Card, robots, sitemap, `llms.txt`, and a single JSON-LD graph with Organization, WebSite, WebPage, VideoGame, HowTo, FAQPage and BreadcrumbList entities.
- Generated social card (1200x630) and install icons.
- Production headers with a strict Content Security Policy and immutable asset caching.
- Build-time validation of metadata, structured data, internal links, sitemap, manifest, icon dimensions and CSP.

## Project structure

```
.
├── site/                       # source, deployable as-is if placeholders are acceptable
│   ├── index.html              # game, rules, strategy, FAQ, JSON-LD
│   ├── 404.html
│   ├── assets/
│   │   ├── app.js              # game engine and render layer
│   │   ├── styles.css          # design system and responsive layout
│   │   ├── favicon.svg
│   │   ├── og-cover.png
│   │   ├── icon-192.png
│   │   ├── icon-512.png
│   │   └── apple-touch-icon.png
│   ├── manifest.webmanifest
│   ├── robots.txt
│   ├── sitemap.xml
│   ├── llms.txt
│   └── _headers              # Netlify / Cloudflare Pages header rules
├── scripts/
│   ├── build.ps1             # copy, inject, validate, size report
│   ├── generate-assets.ps1   # regenerate PNG social card and icons
│   └── serve.ps1             # local static server with production headers
├── dist/                     # generated output (build artifact, safe to upload)
├── netlify.toml
├── vercel.json
└── .github/workflows/pages.yml
```

## Requirements

- Windows PowerShell 5.1 or PowerShell 7+ (the build also runs in `pwsh` on Linux CI).
- No Node.js, npm, Python or external packages.

## Build

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build.ps1
```

Optional parameters:

| Parameter | Default | Purpose |
| --- | --- | --- |
| `-SiteUrl` | `https://neonace.example` | Absolute site URL without a trailing slash. Injected into canonical, OG, Twitter, sitemap, robots and `llms.txt`. |
| `-OutDir` | `dist` | Output directory. Must not be the project root or `site/`. |
| `-BuildId` | UTC timestamp | Cache-busting token appended to CSS and JS URLs. |

Examples:

```powershell
# Production domain
powershell -ExecutionPolicy Bypass -File scripts/build.ps1 -SiteUrl https://neonace.com

# Staging preview
powershell -ExecutionPolicy Bypass -File scripts/build.ps1 -SiteUrl https://staging.neonace.com -OutDir preview
```

The build fails if any of the following are wrong:

- unresolved `__PLACEHOLDER__` tokens
- missing required files
- broken internal links or anchors
- invalid JSON-LD, manifest or sitemap
- missing required metadata
- wrong social-card or icon dimensions
- `unsafe-inline` / `unsafe-eval` in the CSP

### Placeholders

| Token | Example |
| --- | --- |
| `__SITE_URL__` | `https://neonace.com` |
| `__BUILD_DATE__` | `2026-11-15` |
| `__BUILD_DATE_PRETTY__` | `November 15, 2026` |
| `__BUILD_ID__` | `20261115123930` |

## Local preview

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/serve.ps1 -Root dist
```

Open <http://localhost:8080/>. The server sends the same security and cache headers as production, maps missing paths to `404.html`, and refuses path traversal. Stop it with `Ctrl+C`.

To preview the source rather than a build:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/serve.ps1
```

## Regenerate images

```powershell
powershell -ExecutionPolicy Bypass -File scripts/generate-assets.ps1
```

This redraws the 1200x630 social card, the 512/192 icons and the Apple touch icon using `System.Drawing`. The script is intentionally ASCII-only so Windows PowerShell 5.1 reads it correctly without a BOM.

## Deployment

The site is a pure static artifact. Always run the build with your real domain first, then upload `dist/`.

### Current production deployment

| Setting | Value |
| --- | --- |
| Platform | Cloudflare Pages (Direct Upload) |
| Project | `neon-ace` |
| Production URL | <https://neon-ace.pages.dev/> |
| Production branch | `main` |
| Build artifact | `dist/` |

Build for this origin before every upload:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build.ps1 -SiteUrl https://neon-ace.pages.dev
```

When deploying through the Direct Upload REST API rather than Wrangler, the following details are required:

- Manifest keys are root-relative, for example `/index.html` and `/assets/app.js`.
- Asset keys are BLAKE3 hashes of `base64(file bytes) + extension-without-dot`, truncated to 32 hex characters.
- `_headers` is excluded from the asset manifest and sent as a separate multipart file part on the deployment request.
- Include `branch=main` so the deployment becomes the production alias.

Production verification: all asset routes return 200, missing paths return the custom `404.html`, Brotli compression is active, the strict CSP/security headers are applied, cache-busted assets are immutable, and W3C Nu HTML validation reports 0 messages. Cloudflare automatically adds `X-Robots-Tag: noindex` to versioned deployment URLs and redirects HTTP to HTTPS.

### Netlify

1. Set the publish directory to `dist` (already configured in `netlify.toml`).
2. Drag `dist/` into the Netlify dashboard, or connect the repository and deploy the prebuilt directory.
3. Netlify reads `dist/_headers` automatically for CSP, security headers and cache policy.
4. Add the custom domain and enable HTTPS.

Netlify does not run the PowerShell build unless you add a compatible build image. Keep `dist/` current in the repository, or build it in CI before deploy.

### Vercel

1. Import the repository.
2. Vercel uses `vercel.json`, which points at `dist/` and repeats the security headers.
3. Add the custom domain and enable HTTPS.

### Cloudflare Pages

The live site is the Direct Upload project `neon-ace` at <https://neon-ace.pages.dev/> (production branch `main`). See [Current production deployment](#current-production-deployment) for the API requirements.

1. Rebuild with `scripts/build.ps1 -SiteUrl https://neon-ace.pages.dev`.
2. Upload `dist/` as a direct-upload project, or connect the repository.
3. Set the output directory to `dist`.
4. Cloudflare Pages parses `_headers` from the output root; the file is not served as a static asset.

### GitHub Pages

1. Push the repository to GitHub.
2. Add a repository variable named `SITE_URL` with the production origin, for example `https://example.com` (no trailing slash).
3. Enable **Settings > Pages > Source: GitHub Actions**.
4. Run the **Deploy Neon Ace to GitHub Pages** workflow. It builds with `pwsh`, validates, uploads `dist/` and deploys.

> **Project pages:** `404.html` uses root-absolute asset paths so it works on a custom domain. A GitHub project site served from `https://user.github.io/repo/` needs a custom domain, or the paths in `site/404.html` must be changed to `/repo/assets/...` before building.

### Any static host

Upload the contents of `dist/` to the web root. Serve `index.html` at `/`, use `404.html` for missing paths, and enable gzip or Brotli. If the host does not read `_headers`, translate the rules in that file into the host's header configuration.

## SEO and GEO checklist

- One canonical URL, one `h1`, semantic landmarks and indexable rules/strategy/FAQ copy.
- Open Graph and Twitter Card metadata with a 1200x630 image.
- `robots.txt` explicitly allows major search and AI crawlers and points to the sitemap.
- `sitemap.xml` includes the page and social image.
- `llms.txt` provides a compact, citation-friendly summary, quick facts, FAQ, sources and citation line.
- JSON-LD `@graph` covers the organization, site, page, game, how-to steps, FAQ and breadcrumb.
- `speakable` selectors identify the quick answer and FAQ for voice/answer engines.

After deploying, verify with:

- Google Rich Results Test
- Schema Markup Validator
- Facebook Sharing Debugger and X Card Validator
- `https://neon-ace.pages.dev/robots.txt`, `/sitemap.xml` and `/llms.txt` (or the equivalents on your own domain)
- Lighthouse SEO, Accessibility and Best Practices

## Headers and privacy

- CSP: `default-src 'self'`, no inline scripts, no inline styles, no third-party origins.
- `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy`.
- `assets/*` is cached for one year and is safe because URLs carry `?v=__BUILD_ID__`.
- HTML is revalidated on every request.
- The game sets no cookies, makes no network requests after load, and stores only bankroll, bet, sound and stats in `localStorage`.

## Accessibility

Target: WCAG 2.2 AA. Implemented:

- keyboard shortcuts and a focusable table group
- native buttons, radios and dialog
- visible `:focus-visible` rings
- screen-reader labels on every card and score
- polite live-region announcements for each action and result
- reduced-motion handling in both CSS and the dealer animation delays
- touch-sized controls, responsive layout and no time limits
- no flashing content

## Manual test notes

The game has been exercised in Chromium at 390, 768, 1024, 1280, 1440 and 1936 CSS pixels, covering:

- deal, hit, stand, double, split, resplit and four-hand layouts
- split aces (one card each, 1:1 payout)
- double after split
- natural blackjack at 3:2, dealer natural and both-natural push
- dealer draw and bust, settlement and bankroll/stat persistence
- out-of-chips state and reset confirmation
- sound toggle, keyboard shortcuts and reduced motion
- no horizontal overflow at any tested width

## License

MIT. See [LICENSE](LICENSE).

The game is an original implementation. Reference projects used during concept screening, including `ChrisZieba/blackjack` (MIT), are credited on the page and in `llms.txt`; no third-party code or assets are bundled.

## Disclaimer

Neon Ace is a free entertainment and practice game. Chips are virtual, have no cash value and cannot be deposited or withdrawn. It is not a gambling service and does not accept payments. If gambling is affecting your life, support is available at [BeGambleAware.org](https://www.begambleaware.org/).
