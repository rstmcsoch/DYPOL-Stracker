const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/i

/** Private mistake images are stored only as `<owner uuid>/<file uuid>.webp`. */
export function isOwnedStoragePath(userId: string, path: string): boolean {
  if (!USER_ID.test(userId) || path.includes('\\') || path.includes('..')) return false
  const slash = path.indexOf('/')
  if (slash <= 0 || path.indexOf('/', slash + 1) !== -1) return false
  return path.slice(0, slash) === userId && FILE_NAME.test(path.slice(slash + 1))
}
