---
name: ios-edge-to-edge
description: >-
  Reference for how Foodbook fills the screen as an installed iOS home-screen
  app — no top or bottom chrome, content draws all the way under the status bar
  clock and behind the home indicator. Load this BEFORE adding anything fixed
  to the top or bottom of the viewport (a scrim, a bar, extra reserved padding
  in .page-scroll), sizing anything to fill the screen (never `height: 100%` or
  `100dvh` — use `var(--app-height)`), or touching the apple-mobile-web-app-* /
  viewport meta tags or public/manifest.webmanifest — even for a one-liner
  ("just add a strip behind the clock", "reserve space for X at the bottom").
  Also load it whenever a flat colour block appears along the top or bottom
  edge of the installed app, or the page looks vertically short or shifted.
---

# iOS edge-to-edge chrome

Foodbook is used as an installed iOS home-screen app. The whole design assumes
the page runs edge to edge: content draws under the status bar clock and behind
the home indicator, and **nothing in-app paints a band at either edge**. Two
things break that, and both have already bitten once — an in-app scrim, and a
full-height box sized with `100%`.

## The setup

`index.html`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<link rel="manifest" href="%BASE_URL%manifest.webmanifest" />
```

- `viewport-fit=cover` + `black-translucent` are what let content draw under
  the status bar and behind the home indicator, with `env(safe-area-inset-*)`
  reporting real insets instead of 0.
- `public/manifest.webmanifest` (added 2026-08-13) gives non-Safari installs a
  proper `display: standalone`; it also makes `@media (display-mode: standalone)`
  reliable. The Apple tags are still what drive the layout.
- App served from `/foodbook/` on GitHub Pages, so the manifest uses relative
  `start_url`/`scope`/icon paths and the `<link>` goes through `%BASE_URL%`.

## Never size a full-height box with `100%` or `100dvh`

Use `var(--app-height)` — defined in `styles.css` next to the
`html, body, #root` rule: `100dvh` in the browser, `100vh` under
`@media (display-mode: standalone)`. It sizes `html`, `body`, `#root`,
`.page-scroll` and the dialog `max-height`s.

Under `black-translucent`, iOS reports a cold-start viewport one status bar
short: measured `innerHeight` 844 on a 912pt screen with
`env(safe-area-inset-top)` 68px. `100%` and `100dvh` both resolve to that 844,
so the page ends 68px above the screen bottom and iOS paints the gap with bare
web-view background — a flat block along the bottom edge (white in light mode)
that **no page background can reach**. `html`, `body` and `.page-scroll` all
carrying `--page-bg` does nothing for it. `100vh` is correct from launch, and
with no dynamic toolbars in standalone the two are otherwise equal.

LiftOS documents the identical bug on its own `--app-height` token in
`~/Documents/liftos/src/shared/styles/tokens.css`.

## No chrome at the edges

- There used to be a `body::before` frosted glass strip covering the status-bar
  band, and `.page-scroll` used to reserve a flat 96–104px of opaque padding at
  the bottom for the floating selection bar. Both were removed 2026-08-11 —
  they were solid-colour blocks sitting over/under content instead of letting it
  run to the edge, which read as broken chrome rather than a native-feeling app.
  Don't reintroduce either without being asked.
- Floating UI (`.selection-bar`, the Subway back button) handles its own
  clearance via `position: fixed` + `env(safe-area-inset-bottom/top)` on itself.
  It does not need the scroll container to reserve standing space; it floats
  over whatever is scrolled underneath.
- `.page-scroll` padding stays small breathing room
  (`~16-28px + env(safe-area-inset-*)`), never a large flat block sized for a UI
  element that usually isn't even visible.
- `html` and `body` both carry `.page-scroll`'s gradient (`--page-bg`, not the
  flat `--bg`) so an overscroll bounce reveals the page continuing, not a grey
  band.

## When a flat block appears at an edge

Measure before theorising — the local preview cannot reproduce installed-PWA
behaviour at all, and reasoning about background colours wasted three commits
on 2026-08-13 before the real cause (the `100%` height above) turned up.

1. Ship a temporary probe: markers at `position: fixed; bottom: 0` and at
   `bottom: env(safe-area-inset-bottom)`, plus a readout of `innerHeight`,
   `document.documentElement.clientHeight`, `visualViewport.height`,
   `screen.height`, the resolved insets, `navigator.standalone`, and
   `.page-scroll`'s `getBoundingClientRect().bottom`.
2. Compare `.page-scroll`'s rect bottom against `screen.height`. Equal means
   the page fills the screen and the block is ours; short means the web view
   itself is short and no CSS can reach the gap.
3. Check LiftOS — the more mature codebase, it has usually hit the same iOS
   quirk first and left a comment explaining it.

## Install-time caching gotcha

iOS bakes the `apple-mobile-web-app-*` meta values into the home-screen icon at
install time. If those tags change, the icon must be deleted and re-added — a
relaunch is not enough. Plain CSS/JS changes only need the app force-quit from
the app switcher and reopened, since iOS standalone apps don't always refetch a
fresh bundle on a simple foreground.
