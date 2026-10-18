import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Users, ArrowRight } from 'lucide-react'
import { controlFetch, type UsersResponse } from './api'
import { ALL_NAV_ITEMS, CONSOLE_BASE } from './policy'
import { Spinner } from './ui'

interface LauncherEntry { key: string; label: string; detail: string; to: string; kind: 'page' | 'user' }

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/** Ctrl/⌘+K command launcher: console pages, plus account search through the server-side directory. */
export function CommandLauncher({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const debounced = useDebounced(query.trim(), 300)

  useEffect(() => { input.current?.focus() }, [])

  const pages = useMemo<LauncherEntry[]>(() => {
    const needle = query.trim().toLowerCase()
    return ALL_NAV_ITEMS
      .filter(item => !needle || item.label.toLowerCase().includes(needle) || item.description.toLowerCase().includes(needle))
      .map(item => ({ key: `page-${item.to || 'overview'}`, label: item.label, detail: item.description, to: item.to ? `${CONSOLE_BASE}/${item.to}` : CONSOLE_BASE, kind: 'page' as const }))
  }, [query])

  const accounts = useQuery({
    queryKey: ['control', 'launcher-users', debounced],
    queryFn: () => controlFetch<UsersResponse>(`users?q=${encodeURIComponent(debounced)}&pageSize=6`),
    enabled: debounced.length >= 3,
    staleTime: 15_000
  })

  const entries: LauncherEntry[] = [
    ...pages,
    ...(accounts.data?.users ?? []).map(user => ({
      key: `user-${user.id}`,
      label: user.displayName || user.email,
      detail: user.email,
      to: `${CONSOLE_BASE}/users/${user.id}`,
      kind: 'user' as const
    }))
  ]

  useEffect(() => { setActive(0) }, [query])

  const go = (entry: LauncherEntry | undefined) => {
    if (!entry) return
    navigate(entry.to)
    onClose()
  }

  return (
    <div className="cc-scrim cc-scrim--top" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label="Command launcher" className="cc-launcher">
        <div className="cc-launcher__search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={input}
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Go to a page or find an account…"
            aria-label="Search pages and accounts"
            aria-controls="cc-launcher-results"
            aria-activedescendant={entries[active] ? `cc-launcher-${active}` : undefined}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            onKeyDown={event => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(entries.length - 1, index + 1)) }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)) }
              if (event.key === 'Enter') { event.preventDefault(); go(entries[active]) }
              if (event.key === 'Escape') { event.preventDefault(); onClose() }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <ul id="cc-launcher-results" role="listbox" className="cc-launcher__list" aria-label="Results">
          {entries.map((entry, index) => (
            <li key={entry.key} id={`cc-launcher-${index}`} role="option" aria-selected={index === active} className={index === active ? 'is-active' : ''} onMouseEnter={() => setActive(index)} onClick={() => go(entry)}>
              {entry.kind === 'user' ? <Users size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
              <span className="cc-launcher__label">{entry.label}</span>
              <span className="cc-launcher__detail">{entry.detail}</span>
              <span className="cc-launcher__kind">{entry.kind === 'user' ? 'Account' : 'Page'}</span>
            </li>
          ))}
          {debounced.length >= 3 && accounts.isFetching && <li className="cc-launcher__status"><Spinner label="Searching accounts…" /></li>}
          {debounced.length >= 3 && accounts.isError && <li className="cc-launcher__status" role="alert">Account search is unavailable right now.</li>}
          {entries.length === 0 && <li className="cc-launcher__status">No pages or accounts match “{query.trim()}”.</li>}
        </ul>
        <p className="cc-launcher__hint">Account search needs three characters and matches email, display name, or the full account ID.</p>
      </div>
    </div>
  )
}
