import { useEffect, useState } from 'react'

/* TEMPORARY diagnostic — remove once the bottom colour block is identified.
   Two marker lines pin the real edges of the web view so a screenshot alone
   tells us whether the block is painted by iOS outside the viewport or by
   the page inside it:
     magenta = bottom: 0        (the very bottom of the fixed viewport)
     cyan    = bottom: env(safe-area-inset-bottom)
   If the block sits BELOW the magenta line, iOS is painting it and the web
   view is inset. If the block sits between the two lines, it is ours. */

function readInsets() {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);' +
    'padding-bottom:env(safe-area-inset-bottom)'
  document.body.appendChild(probe)
  const cs = getComputedStyle(probe)
  const insets = { top: cs.paddingTop, bottom: cs.paddingBottom }
  probe.remove()
  return insets
}

export function ViewportProbe() {
  const [info, setInfo] = useState('')

  useEffect(() => {
    const measure = () => {
      const insets = readInsets()
      setInfo(
        [
          `inner ${window.innerHeight} / client ${document.documentElement.clientHeight}`,
          `visual ${Math.round(window.visualViewport?.height ?? 0)} / screen ${window.screen.height}`,
          `inset top ${insets.top} bottom ${insets.bottom}`,
          `dpr ${window.devicePixelRatio} standalone ${String(
            (window.navigator as Navigator & { standalone?: boolean }).standalone,
          )}`,
          `bodyBg ${getComputedStyle(document.body).backgroundColor}`,
          `scroll ${Math.round(document.querySelector('.page-scroll')?.getBoundingClientRect().bottom ?? 0)}`,
        ].join('\n'),
      )
    }
    measure()
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
    }
  }, [])

  return (
    <>
      <div
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, height: 2,
          background: '#ff00d4', zIndex: 9999, pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 'env(safe-area-inset-bottom)', height: 2,
          background: '#00e5ff', zIndex: 9999, pointerEvents: 'none',
        }}
      />
      <pre
        style={{
          position: 'fixed', left: 8, bottom: 'calc(8px + env(safe-area-inset-bottom))',
          margin: 0, padding: '6px 8px', borderRadius: 8,
          background: 'rgba(0,0,0,.78)', color: '#fff',
          font: '10px/1.35 ui-monospace, Menlo, monospace', whiteSpace: 'pre',
          zIndex: 9999, pointerEvents: 'none',
        }}
      >
        {info}
      </pre>
    </>
  )
}
