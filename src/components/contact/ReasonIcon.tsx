import { Bug, Copyright, Handshake, Lightbulb, MessageCircleQuestion, MessageSquareWarning } from 'lucide-react'
import type { ContactReason } from '../../lib/contact/reasons'

const ICONS = {
  general_query: MessageCircleQuestion,
  feature_request: Lightbulb,
  bug_report: Bug,
  complaint: MessageSquareWarning,
  copyright: Copyright,
  sponsorship: Handshake
} as const

/** Decorative icon for a contact reason. */
export function ReasonIcon({ reason, size = 18 }: { reason: ContactReason; size?: number }) {
  const Icon = ICONS[reason]
  return <Icon size={size} aria-hidden="true" className="reason-icon" data-reason={reason} />
}
