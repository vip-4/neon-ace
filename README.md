# Neon Ace

A production-ready, single-page blackjack game built with plain HTML, CSS and JavaScript. No frameworks, no build tooling, no remote fonts, no analytics and no real-money wagering. The critical path is roughly **29 KB gzipped**.

**Live production sites:** <https://neon-ace.pages.dev/> (Cloudflare Pages), <https://vip-4.github.io/neon-ace/> (GitHub Pages) and <https://neon-ace-tg.pages.dev/> (Telegram Mini App endpoint).

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

Both production endpoints are built from the same final source. Rebuild with each platform's `-SiteUrl` (plus `-BasePath` for GitHub Pages project sites) before redeploying: Cloudflare Pages and GitHub Pages must not share a built `dist/` directory.

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

The live site is the public repository `vip-4/neon-ace`, deployed by the **Deploy Neon Ace to GitHub Pages** workflow at <https://vip-4.github.io/neon-ace/>.

| Setting | Value |
| --- | --- |
| Repository | `vip-4/neon-ace` |
| Production URL | <https://vip-4.github.io/neon-ace/> |
| Pages build type | GitHub Actions |
| Workflow | `.github/workflows/pages.yml` |
| Repository variables | `SITE_URL=https://vip-4.github.io/neon-ace`, `BASE_PATH=/neon-ace` |

1. Push to `main`; the workflow builds with `pwsh`, validates, uploads `dist/` as a Pages artifact and deploys.
2. Set `SITE_URL` to the production origin without a trailing slash and `BASE_PATH` to the repository path. Use an empty `BASE_PATH` for a user/organization site served from the domain root.
3. `BASE_PATH` is injected into `<base href="...">` in `404.html`, so custom 404 pages served under a project sub-path still resolve assets correctly.

> **Project-site limits:** `robots.txt`, `sitemap.xml` and `llms.txt` live at `/neon-ace/` rather than the host root; the root-level files belong to the existing `vip-4.github.io` user site. GitHub Pages cannot send custom response headers, so `_headers` is served as a plain file there instead of being applied. Use Cloudflare Pages, Netlify, Vercel or a proxied custom domain when you need the strict CSP and security headers.

### Telegram Mini App

The game is also published as a Telegram Mini App. A dedicated endpoint is used because Telegram Web renders Mini Apps inside an `https://web.telegram.org` iframe, which the main sites' `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'` would block.

| Setting | Value |
| --- | --- |
| Mini App endpoint | <https://neon-ace-tg.pages.dev/> |
| Bot | `@VIP865bot` |
| Menu button | `Play Neon Ace` (default, applies to all users) |
| Cloudflare Pages project | `neon-ace-tg` |
| Build script | `scripts/build-telegram.ps1` -> `dist-tg/` |
| Canonical | `https://neon-ace.pages.dev/` (SEO signals stay on the main site) |

Build and deploy with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-telegram.ps1
```

Then upload `dist-tg/` to the `neon-ace-tg` Pages project with Direct Upload (see [Current production deployment](#current-production-deployment)). The variant adds:

- `https://telegram.org/js/telegram-web-app.js` (deferred) plus a same-origin, build-versioned `assets/telegram.js` bridge that calls `ready()`, `expand()` and matches Telegram's header/background colors on supported clients.
- Headers that allow framing (`frame-ancestors *`), permit the Telegram script (`script-src ... https://telegram.org`), omit `X-Frame-Options`/COOP, and send `X-Robots-Tag: noindex` so the duplicate endpoint is not indexed.
- The same HTML, CSS, game engine, JSON-LD, canonical URL, metadata and accessibility features as the main build.

The bot is configured through the Bot API: `setChatMenuButton` with a `MenuButtonWebApp` object (omit `chat_id` to set the default button for all users). **No bot token is stored in this repository**; rotate any token that has been exposed in a chat. `@VIP863Bot` and `@VIP860Bot` were left unconfigured and can be pointed at the same URL with one `setChatMenuButton` call.

> **BotFather-only features:** a Main Mini App with a profile **Launch app** button and direct links such as `https://t.me/VIP865bot?startapp` must be enabled manually with @BotFather (`/mybots > Bot Settings > Configure Mini App`, or `/newapp`). These cannot be set through the Bot API.

Open `@VIP865bot` in Telegram and tap the **Play Neon Ace** menu button.

### Source mirrors

The full source — `site/`, `scripts/`, hosting configs and the CI workflow — is mirrored to three public repositories:

| Platform | Repository |
| --- | --- |
| GitHub | <https://github.com/vip-4/neon-ace> |
| Gitee | <https://gitee.com/vip882/neon-ace> |
| AtomGit | <https://atomgit.com/zzw1208/neon-ace> |

All three contain the same source files. Generated artifacts (`dist/`, `dist-github/`, `dist-tg/`) are excluded; regenerate them with `scripts/build.ps1` or `scripts/build-telegram.ps1` before deploying. Static production hosting is provided by Cloudflare Pages, GitHub Pages and the Telegram Mini App endpoint described above — Gitee and AtomGit are source mirrors only.

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
- `https://neon-ace.pages.dev/robots.txt` and `https://vip-4.github.io/neon-ace/robots.txt`, plus `/sitemap.xml` and `/llms.txt` on each (or the equivalents on your own domain)
- Lighthouse SEO, Accessibility and Best Practices

## Headers and privacy

- CSP: `default-src 'self'`, no inline scripts, no inline styles, no third-party origins.
- `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy`.
- `assets/*` is cached for one year and is safe because URLs carry `?v=__BUILD_ID__`.
- HTML is revalidated on every request.
- The game sets no cookies, makes no network requests after load, and stores only bankroll, bet, sound and stats in `localStorage`.
- GitHub Pages serves `_headers` as a plain file rather than applying it. That deployment relies on the same-origin-only, no-inline-script design and `<meta name="referrer">` instead of response headers.
- The Telegram Mini App endpoint is the deliberate exception: it allows framing, loads `telegram.org/js/telegram-web-app.js` and is `noindex`. The two public web endpoints keep their strict, non-embeddable headers.

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
