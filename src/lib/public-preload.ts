import { withChunkRecovery } from './chunk-recovery'

/**
 * Memoised dynamic import loaders for public and auth routes, shared between App.tsx's
 * `lazy()` definitions and SiteLink's hover/focus/press prefetcher so clicking Log in,
 * Sign up or footer links renders immediately from memory instead of waiting on a cold fetch.
 */
type Loader<T> = () => Promise<T>

function once<T>(rawLoad: Loader<T>): Loader<T> {
  const load = withChunkRecovery(rawLoad)
  let promise: Promise<T> | null = null
  return () => {
    if (!promise) promise = load().catch(error => { promise = null; throw error })
    return promise
  }
}

const infoLoader = once(() => import('../pages/InfoPage'))

export const publicRouteLoaders = {
  '/login': once(() => import('../pages/LoginPage')),
  '/signup': once(() => import('../pages/SignupPage')),
  '/reset-password': once(() => import('../pages/ResetPasswordPage')),
  '/auth/callback': once(() => import('../pages/AuthCallbackPage')),
  '/privacy': infoLoader,
  '/terms': infoLoader,
  '/about': infoLoader,
  '/contact': once(() => import('../pages/ContactPage'))
} as const

export type PublicRoutePath = keyof typeof publicRouteLoaders

/** Starts fetching a public/auth route's chunk on hover, focus or pointerdown. Never throws. */
export function preloadPublicRoute(href: string): void {
  const path = href.split(/[?#]/)[0] ?? href
  const loader = (publicRouteLoaders as Record<string, Loader<unknown> | undefined>)[path]
  if (loader) void loader().catch(() => { /* real navigation retries and uses ChunkErrorBoundary */ })
}
