import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { peekLiftosToday, type LiftosToday } from '../liftos'
import { useDialogDismiss } from '../useDialogDismiss'
import { useFocusTrap } from '../useFocusTrap'
import { formatAmount } from '../utils'

interface LiftosDialogProps {
  calories: number
  protein: number
  closing: boolean
  sending: boolean
  /** Set when the add itself failed — shown here, where the retry is. */
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The step between the selection bar and LiftOS: where the meal lands on today
 * before it's written. Not an "are you sure" — LiftOS's own numbers aren't
 * visible from here otherwise, and how close the day already is to its targets
 * is the thing worth knowing at the moment of adding to it.
 */
export function LiftosDialog({ calories, protein, closing, sending, error, onConfirm, onCancel }: LiftosDialogProps) {
  const backdropProps = useDialogDismiss(onCancel)
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, true)

  const [today, setToday] = useState<LiftosToday | null>(null)
  const [peekFailed, setPeekFailed] = useState(false)
  useEffect(() => {
    let active = true
    peekLiftosToday()
      .then((t) => active && setToday(t))
      .catch((err) => {
        console.error('[liftos] peek failed', err)
        if (active) setPeekFailed(true)
      })
    return () => {
      active = false
    }
  }, [])

  const addCalories = Math.round(calories)
  const addProtein = Math.round(protein)
  const date = today?.date.split('-').map(Number)

  return createPortal(
    <div className={`dialog-backdrop${closing ? ' is-closing' : ''}`} {...backdropProps}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="liftos-dialog-title"
        className={`dialog liftos-dialog${closing ? ' is-closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="liftos-dialog-head">
          <div className="dialog-title" id="liftos-dialog-title">
            加入 LiftOS 今日
          </div>
          {date && <span className="liftos-dialog-date">{`${date[1]}月${date[2]}日`}</span>}
        </div>

        <MacroRow
          label="熱量"
          unit="kcal"
          before={today ? today.calories ?? 0 : null}
          add={addCalories}
          target={today?.calorie_target ?? null}
          loading={!today && !peekFailed}
          remaining={(left) => (left >= 0 ? `還剩 ${left} kcal` : `超出 ${-left} kcal`)}
        />
        <MacroRow
          label="蛋白質"
          unit="g"
          before={today ? today.protein ?? 0 : null}
          add={addProtein}
          target={today?.protein_target ?? null}
          loading={!today && !peekFailed}
          remaining={(left) => (left > 0 ? `還差 ${formatAmount(left)} g` : '已達標')}
        />

        {peekFailed && !error && (
          <div className="liftos-dialog-note">讀不到 LiftOS 今日的紀錄，仍可直接加入</div>
        )}
        {error && <div className="liftos-dialog-note is-error">{error}</div>}

        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={sending}>
            {sending ? '加入中…' : '加入'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function MacroRow({
  label,
  unit,
  before,
  add,
  target,
  loading,
  remaining,
}: {
  label: string
  unit: string
  /** null while LiftOS hasn't answered (or couldn't). */
  before: number | null
  add: number
  target: number | null
  /** Waiting on LiftOS: the bar pulses. Failed: no bar at all — an empty one
      would read as an empty day. */
  loading: boolean
  remaining: (left: number) => string
}) {
  const known = before !== null && target !== null
  const from = before ?? 0
  const goal = target ?? 0
  const after = from + add
  // Scaled to whichever is larger, so going over shows as the bar running past
  // the target mark instead of being clipped at a full bar.
  const scale = Math.max(goal, after, 1)
  const pct = (n: number) => `${(n / scale) * 100}%`

  return (
    <div className="liftos-macro">
      <div className="liftos-macro-top">
        <span className="liftos-macro-label">{label}</span>
        <span className="liftos-macro-figures">
          {known ? (
            <>
              <span className="liftos-macro-from">{formatAmount(from)}</span>
              <span className="liftos-macro-arrow" aria-label="加入後">→</span>
              <span className="liftos-macro-to">{formatAmount(after)}</span>
              <span className="liftos-macro-target">
                / {formatAmount(goal)} {unit}
              </span>
            </>
          ) : (
            <span className="liftos-macro-to">
              +{add} {unit}
            </span>
          )}
        </span>
      </div>
      {(known || loading) && (
        <div className={`liftos-macro-bar${known ? '' : ' is-loading'}`} aria-hidden="true">
          {known && (
            <>
              <span className="liftos-macro-existing" style={{ width: pct(from) }} />
              <span className="liftos-macro-added" style={{ left: pct(from), width: pct(add) }} />
              {after > goal && <span className="liftos-macro-mark" style={{ left: pct(goal) }} />}
            </>
          )}
        </div>
      )}
      {known && (
        <div className="liftos-macro-foot">
          <span className="liftos-macro-add">
            +{add} {unit}
          </span>
          <span>{remaining(goal - after)}</span>
        </div>
      )}
    </div>
  )
}
