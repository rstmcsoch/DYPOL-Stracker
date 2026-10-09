import { openLocalStore, type SQLiteLocalStore } from './sqlite-store'

let opening: Promise<SQLiteLocalStore> | null = null

/** One database connection per app process. The first call opens and migrates the database. */
export function getLocalStore(): Promise<SQLiteLocalStore> {
  if (!opening) {
    opening = openLocalStore().catch(error => {
      opening = null
      throw error
    })
  }
  return opening
}
