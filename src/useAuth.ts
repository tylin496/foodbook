import { useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { auth, googleProvider } from './firebase'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [signInError, setSignInError] = useState(false)

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
  }, [])

  // Uncaught, this was a silent failure — the sign-in button just did nothing
  // visible on a closed popup, a blocked popup, or a network error.
  const signIn = () => {
    setSignInError(false)
    signInWithPopup(auth, googleProvider).catch((err) => {
      // The user closing the popup themselves isn't a failure worth surfacing.
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') return
      setSignInError(true)
    })
  }
  const logOut = () => signOut(auth)

  return { user, loading, signIn, logOut, signInError }
}
