import { Bot, Hexagon, Sparkles, Waves } from 'lucide-react'
import type { AIProviderId } from '../../lib/ai/catalog'

const LABELS:Record<AIProviderId,string> = { gemini:'G',openai:'O',anthropic:'A',deepseek:'D',qwen:'Q',custom:'AI' }

export function AIProviderMark({ provider,small=false }: { provider:AIProviderId|string; small?:boolean }) {
  const id = (['gemini','openai','anthropic','deepseek','qwen','custom'].includes(provider) ? provider : 'custom') as AIProviderId
  return <span className={`ai-provider-mark ai-provider-${id}${small ? ' ai-provider-mark-small' : ''}`} aria-hidden="true">
    {id === 'gemini' ? <Sparkles size={small ? 14 : 18} strokeWidth={2.1} />
      : id === 'deepseek' ? <Waves size={small ? 14 : 18} strokeWidth={2.1} />
      : id === 'qwen' ? <Hexagon size={small ? 14 : 18} strokeWidth={2.1} />
      : id === 'custom' ? <Bot size={small ? 14 : 18} strokeWidth={2.1} />
      : <span>{LABELS[id]}</span>}
  </span>
}
