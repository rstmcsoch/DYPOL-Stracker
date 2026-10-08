import { useEffect } from 'react'

/** The app-wide defaults declared in index.html. Restored when a public page unmounts. */
export const APP_TITLE = 'Stracker — JEE 2027 Study Notebook'
export const APP_DESCRIPTION = 'A private, notebook-inspired JEE study planner, revision tracker, and test journal.'

function setDescription(content: string) {
  const tag = document.querySelector<HTMLMetaElement>('meta[name="description"]')
  if (tag) tag.content = content
}

/**
 * Keeps the document title and meta description in step with the public pages
 * (homepage, log in, sign up, password reset) without pulling in a head manager.
 * The notebook itself keeps the application title.
 */
export function usePageMeta(title?: string, description?: string) {
  useEffect(() => {
    if (!title && !description) return
    if (title) document.title = title
    if (description) setDescription(description)
    return () => {
      document.title = APP_TITLE
      setDescription(APP_DESCRIPTION)
    }
  }, [title, description])
}
