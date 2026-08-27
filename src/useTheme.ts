import { useCallback, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'
export type ThemePreference = 'system' | Theme

export const THEME_KEY = 'foodbook:theme'
export const THEME_ORDER: ThemePreference[] = ['system', 'light', 'dark']

function getSystemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

// Three sources, in order of authority:
//
// `override` — embedded in LiftOS, the host's theme can itself be a manual
// choice, so following prefers-color-scheme here would leave the frame
// disagreeing with the sheet around it.
// The user's own choice — the app followed the OS and nothing else, with no
// way to pin it either way.
// The OS, when neither of the above has an opinion.
export function useTheme(override: Theme | null = null) {
  const [systemTheme, setSystemTheme] = useState<Theme>(getSystemTheme)
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference)
  const theme = override ?? (preference === 'system' ? systemTheme : preference)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemTheme(media.matches ? 'dark' : 'light')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, next)
    } catch {
      // storage unavailable — the choice just won't outlive this visit
    }
  }, [])

  return { theme, preference, setPreference }
}
