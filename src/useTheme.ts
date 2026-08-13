import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

function getSystemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// `override` wins over the OS setting: embedded in LiftOS, the host's theme can
// itself be a manual override, so following prefers-color-scheme here would
// leave the frame disagreeing with the sheet around it.
export function useTheme(override: Theme | null = null) {
  const [systemTheme, setSystemTheme] = useState<Theme>(getSystemTheme)
  const theme = override ?? systemTheme

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemTheme(media.matches ? 'dark' : 'light')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return { theme }
}
