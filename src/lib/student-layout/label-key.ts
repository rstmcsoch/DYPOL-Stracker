/** `<page>:<key>` → [`<page>.labels`, key]. */
export const labelTarget = (k: string): [string, string] => {
  const at = k.indexOf(':')
  return [`${k.slice(0, at)}.labels`, k.slice(at + 1)]
}

/** Key for a fixed label from a literal list (chips, tabs); mirrors the label generator. */
export const labelSlug = (text: string) => text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '') || 'text'
