import { useEffect, type RefObject } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Keeps the current section tab visible in a horizontally scrolling tab bar (narrow screens):
 * after every route change, the link marked aria-current="page" is scrolled into view.
 */
export function useCurrentTabInView(ref: RefObject<HTMLElement | null>): void {
  const { pathname } = useLocation()
  useEffect(() => {
    const current = ref.current?.querySelector<HTMLElement>('[aria-current="page"]')
    if (current && typeof current.scrollIntoView === 'function') current.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [pathname, ref])
}
