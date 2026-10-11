/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, CircleAlert, Info, X } from 'lucide-react'
import { IconButton } from '../components/ui'

type ToastKind = 'success' | 'error' | 'info'
interface ToastMessage { id: number; text: string; kind: ToastKind; leaving?: boolean }
interface ToastContextValue { notify: (text: string, kind?: ToastKind) => void }
const ToastContext = createContext<ToastContextValue | null>(null)
let toastId = 0

/**
 * Notification stack. Toasts render bottom-left so they never cover the
 * persistent top-right light/dark switch. Every auto-dismiss timer is tracked
 * and cleared on manual dismissal or provider unmount, and the empty stack
 * collapses (`.toast-stack:empty`), so no orphaned button, empty box, backdrop
 * or invisible hit area can remain after a toast closes.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const timers = useRef<Map<number, number>>(new Map())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
    // Mark as leaving so CSS can fade it out, then remove (immediately with reduced motion).
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setToasts(items => items.filter(item => item.id !== id)); return }
    setToasts(items => items.map(item => item.id === id ? { ...item, leaving: true } : item))
    window.setTimeout(() => setToasts(items => items.filter(item => item.id !== id)), 140)
  }, [])

  const notify = useCallback((text: string, kind: ToastKind = 'success') => {
    const id = ++toastId
    setToasts(items => [...items.slice(-2), { id, text, kind }])
    timers.current.set(id, window.setTimeout(() => dismiss(id), 4800))
  }, [dismiss])

  useEffect(() => () => {
    timers.current.forEach(timer => window.clearTimeout(timer))
    timers.current.clear()
  }, [])

  const value = useMemo(() => ({ notify }), [notify])
  return <ToastContext.Provider value={value}>
    {children}
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map(toast => <div key={toast.id} className={`toast type-alert toast-${toast.kind}`} data-state={toast.leaving ? 'closed' : 'open'} role={toast.kind === 'error' ? 'alert' : 'status'}>
        <span className="toast-icon">{toast.kind === 'success' ? <Check size={16} /> : toast.kind === 'error' ? <CircleAlert size={16} /> : <Info size={16} />}</span>
        <span>{toast.text}</span>
        <IconButton label="Dismiss notification" onClick={() => dismiss(toast.id)}><X size={15} /></IconButton>
      </div>)}
    </div>
  </ToastContext.Provider>
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
