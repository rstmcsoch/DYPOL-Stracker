import { contactReasonLabel, type ContactStatus } from '../../lib/contact/reasons'

export interface MessageSummary {
  id: string; created_at: string; name: string; email: string; reason: string; subject: string | null
  status: ContactStatus; read_at: string | null; preview: string; fileCount: number; linkCount: number
}
export interface MessageFile { name: string; size: number; type: string; viewUrl: string | null; downloadUrl: string | null }
export interface MessageDetail {
  id: string; created_at: string; name: string; email: string; reason: string; subject: string | null; message: string
  details: Record<string, string | boolean>; links: string[]; status: ContactStatus; read_at: string | null; signedIn: boolean
  files: MessageFile[]; linkExpiresInSeconds: number
}
/** Reply link: the sender's address with a prefilled subject line. */
export function replyHref(message: Pick<MessageDetail, 'email' | 'subject' | 'reason'>): string {
  const subject = `Re: ${message.subject?.trim() || `${contactReasonLabel(message.reason)} · Stracker`}`
  return `mailto:${encodeURIComponent(message.email).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}`
}

/** Only http(s) links are ever rendered as anchors. */
export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

