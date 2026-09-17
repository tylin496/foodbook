import { useEffect, useState } from 'react'
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth'
import { auth, googleProvider } from './firebase'

const errorCode = (err: unknown) =>
  (err as { code?: string } | null)?.code ?? 'unknown'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  // The Firebase error code of the last failed sign-in, shown next to the
  // message so a failure in an unusual browser can be told apart at a glance.
  const [signInError, setSignInError] = useState<string | null>(null)

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
  }, [])

  // Completes the redirect fallback below; resolves to null on a normal load.
  useEffect(() => {
    getRedirectResult(auth).catch((err) => {
      console.error('[auth] redirect sign-in failed', err)
      setSignInError(errorCode(err))
    })
  }, [])

  // Uncaught, this was a silent failure — the sign-in button just did nothing
  // visible on a closed popup, a blocked popup, or a network error.
  const signIn = () => {
    setSignInError(null)
    signInWithPopup(auth, googleProvider).catch((err) => {
      const code = errorCode(err)
      // The user closing the popup themselves isn't a failure worth surfacing.
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return
      console.error('[auth] popup sign-in failed', err)
      // Embedded browsers (e.g. an in-app browser pane) often can't open or
      // talk to the popup window; a full-page redirect doesn't need one.
      signInWithRedirect(auth, googleProvider).catch((redirectErr) => {
        console.error('[auth] redirect sign-in failed', redirectErr)
        setSignInError(errorCode(redirectErr))
      })
    })
  }
  const logOut = () => signOut(auth)

  return { user, loading, signIn, logOut, signInError }
}
