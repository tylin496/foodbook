// Foodbook → LiftOS, from Foodbook itself. Inside LiftOS this app is embedded
// and only mirrors its selection out (see embed.ts) — LiftOS does the writing.
// Opened on its own, it adds the selection straight onto LiftOS's logged intake
// for today through LiftOS's foodbook-intake function, which verifies this
// app's Firebase sign-in rather than taking a secret (nothing in a static
// bundle stays secret). An existing day grows by the meal; it's never replaced.
import { auth } from './firebase'

const ENDPOINT = 'https://gcznowwjbeqihhllllpz.supabase.co/functions/v1/foodbook-intake'

export interface LiftosMacros {
  calories: number | null
  protein: number | null
}

export interface LiftosAddResult {
  date: string
  /** The day's totals after the add. */
  calories: number
  protein: number
  added: { calories: number; protein: number }
  /** null: there was no entry for the day before this add. */
  previous: LiftosMacros | null
}

export class LiftosError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

// The phone's own calendar day — the same "today" LiftOS shows on that phone.
function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function call<T>(body: unknown): Promise<T> {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new LiftosError(401, 'not signed in')
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new LiftosError(res.status, data?.error ?? res.statusText)
  return data as T
}

export function addToLiftosToday(totals: { calories: number; protein: number }) {
  return call<LiftosAddResult>({
    date: localDate(),
    calories: Math.round(totals.calories),
    protein: Math.round(totals.protein),
  })
}

/** Takes the add back, unless the day has changed since — LiftOS refuses that
    with a 409 rather than erase whatever was logged after. */
export function undoLiftosAdd(result: LiftosAddResult) {
  return call<LiftosMacros>({
    date: result.date,
    undo: {
      expect: { calories: result.calories, protein: result.protein },
      restore: result.previous,
    },
  })
}
