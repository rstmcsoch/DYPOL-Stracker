/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Check, CircleAlert, Info, X } from 'lucide-react'
import { IconButton } from '../components/ui'

type ToastKind = 'success' | 'error' | 'info'
interface ToastMessage { id: number; text: string; kind: ToastKind }
interface ToastContextValue { notify: (text: string, kind?: ToastKind) => void }
const ToastContext = createContext<ToastContextValue | null>(null)
let toastId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const dismiss = useCallback((id: number) => setToasts(items => items.filter(item => item.id !== id)), [])
  const notify = useCallback((text: string, kind: ToastKind = 'success') => {
    const id = ++toastId
    setToasts(items => [...items.slice(-2), { id, text, kind }])
    window.setTimeout(() => dismiss(id), 4800)
  }, [dismiss])
  const value = useMemo(() => ({ notify }), [notify])
  return <ToastContext.Provider value={value}>
    {children}
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map(toast => <div key={toast.id} className={`toast type-alert toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
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
