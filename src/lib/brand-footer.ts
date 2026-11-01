/** The "Stracker by DYPOL LABS" trademark footer shows only on Home, Profile and Settings. */
export const BRAND_FOOTER_ROUTES = ['/', '/profile', '/settings'] as const
export function showsBrandFooter(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return (BRAND_FOOTER_ROUTES as readonly string[]).includes(path)
}
