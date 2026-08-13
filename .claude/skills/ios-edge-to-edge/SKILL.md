---
name: ios-edge-to-edge
description: >-
  Reference for how Foodbook fills the screen as an installed iOS home-screen
  app — no top or bottom chrome, content draws all the way under the status
  bar clock and behind the home indicator. Load this BEFORE adding anything
  fixed to the top or bottom of the viewport (a scrim, a bar, extra reserved
  padding in .page-scroll) or touching the apple-mobile-web-app-* / viewport
  meta tags — even a one-liner ("just add a strip behind the clock", "reserve
  space for X at the bottom"), or sizing anything to fill the screen (never
  `height: 100%` or `100dvh` — use the `--app-height` token, or a flat block
  reappears along the bottom edge). Also load it when a flat colour block
  shows up at the top or bottom edge of the installed app. A frosted scrim
  strip and a 96-104px reserved
  bottom padding were both removed on 2026-08-11 because they read as opaque
  blocks that didn't match the rest of the page — don't reintroduce either
  without being asked.
---

# iOS edge-to-edge chrome

Standalone mode on iOS runs off the Apple-specific meta tags in `index.html`
(`public/manifest.webmanifest` exists too, added 2026-08-13 so non-Safari
installs get a proper `display: standalone`, but the Apple tags are what
drive the layout):

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

- `viewport-fit=cover` + `black-translucent` together are what let page
  content draw under the system status bar (clock/battery) and behind the
  home indicator, with `env(safe-area-inset-*)` reporting the real inset
  instead of 0.
- **Nothing in-app paints a band at the top or bottom.** There used to be a
  `body::before` frosted glass strip covering the status-bar band, and
  `.page-scroll` used to reserve a flat 96–104px of opaque padding at the
  bottom for the floating selection bar. Both were removed 2026-08-11 — they
  were solid-color blocks sitting over/under content instead of letting it
  run to the edge, which read as broken chrome rather than a native-feeling
  app. Don't reintroduce a scrim or an oversized reserved padding block at
  either edge without being asked.
- Floating UI (`.selection-bar`, the Subway back button) already handles its
  own clearance via `position: fixed` + `env(safe-area-inset-bottom/top)` on
  itself — it does not need the scroll container to reserve standing space
  for it. It floats over whatever content is currently scrolled underneath.
- `.page-scroll` padding should stay small breathing room
  (`~16-28px + env(safe-area-inset-*)`), not a large flat block sized for a
  UI element that usually isn't even visible.

## Never size a full-height box with `100%` or `100dvh`

Use `var(--app-height)` (`styles.css`, next to the `html, body, #root` rule)
for anything meant to fill the screen — `100dvh` in the browser, `100vh` under
`@media (display-mode: standalone)`.

Under `black-translucent`, iOS reports a cold-start viewport one status bar
short: measured `innerHeight` 844 on a 912pt screen, `env(safe-area-inset-top)`
68px. `100%` and `100dvh` both resolve to that 844, so the page ends 68px above
the screen bottom and iOS paints the gap with bare web-view background — a flat
block along the bottom edge that **no page background can reach** (`html`,
`body` and `.page-scroll` all carrying `--page-bg` does nothing). `100vh` is
correct from launch. LiftOS documents the same bug in
`src/shared/styles/tokens.css` (`--app-height`).

Diagnosed 2026-08-13, after three commits that wrongly assumed the block was a
page background problem. If a flat block ever shows up at an edge again, first
measure — render `position: fixed; bottom: 0` markers plus a readout of
`innerHeight` / `screen.height` / the resolved insets, and compare
`.page-scroll`'s `getBoundingClientRect().bottom` against `screen.height`. And
check LiftOS: it is the more mature codebase and has usually hit the same iOS
quirk first.

## Install-time caching gotcha

iOS bakes the `apple-mobile-web-app-*` meta values into the home-screen icon
at install time. If those specific meta tags change, the icon must be removed
and re-added to the home screen — a relaunch is not enough. Plain CSS/JS
changes (like the padding/scrim fixes above) only need the app force-quit from
the app switcher and reopened, since iOS standalone apps don't always refetch
a fresh bundle on a simple foreground/reopen.
