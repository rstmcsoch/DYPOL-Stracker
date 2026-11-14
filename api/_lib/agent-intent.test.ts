import { describe, expect, it } from 'vitest'
import { MODEL_TOOLS } from './tools.js'
import { conversationNeedsData, requiresTools, selectedSystem, shouldOfferTools, toolsForMessage } from './agent.js'

const essay = 'sometimes i think maybe change stream but they already paid fees and bought books so no. just need some real method that works for someone like me who gets low always and confidence is gone. '.repeat(12)

describe('Stracker AI data intent', () => {
  it.each([
    'How am I doing in each subject?',
    'How’m I doing? I don’t have access?',
    'how am i doing',
    "How'm I doing lately?",
    'Am I on track for the exam?',
    'Show my progress',
    'What are my weak areas?',
    'Which chapters should I revise first?',
    'What should I study next?',
    'Subject-wise performance please',
    'Where do I stand in Chemistry?',
    'How are my mocks going?'
  ])('treats %j as a personal-data question', message => {
    expect(requiresTools(message)).toBe(true)
    expect(shouldOfferTools(message)).toBe(true)
  })

  it('keeps the follow-up after a refusal on the data path', () => {
    const prior = [
      { role: 'user', content: 'How am I doing in each subject?' },
      { role: 'assistant', content: 'I can’t load your Stracker data right now.' }
    ]
    expect(requiresTools("What do you mean? You don't have access?")).toBe(true)
    expect(conversationNeedsData('What do you mean?', prior)).toBe(true)
    expect(conversationNeedsData('Explain it again please', prior)).toBe(true)
    expect(conversationNeedsData('What do you mean?', [])).toBe(false)
  })

  it('still offers read-only tools by default for ordinary study questions', () => {
    expect(shouldOfferTools('Explain Newton’s third law with an example')).toBe(true)
    expect(shouldOfferTools('Dllsksd')).toBe(true)
  })

  it('skips tools only for greetings and long notes without a data request', () => {
    for (const message of ['Hello', 'hi!', 'Thanks', 'ok', 'Good morning']) expect(shouldOfferTools(message)).toBe(false)
    expect(shouldOfferTools(essay)).toBe(false)
  })

  it('offers subject performance, read-only, for "how am I doing in each subject"', () => {
    const names = toolsForMessage('How am I doing in each subject?', MODEL_TOOLS).map(tool => tool.name)
    expect(names).toContain('get_subject_performance')
    expect(names).toContain('get_dashboard_summary')
    expect(names.some(name => /^(create|update|delete|complete|mark)_/.test(name))).toBe(false)
  })
})

describe('Stracker AI system prompt', () => {
  const variants = [
    selectedSystem('Dashboard', 'general', false, '', true, false),
    selectedSystem('Dashboard', 'analytics', true, '', false, false),
    selectedSystem('Dashboard', 'analytics', false, '', false, false),
    selectedSystem(null, 'analytics', false, '', false, true)
  ]

  it('never tells the model to say tools were not attached', () => {
    for (const prompt of variants) {
      expect(prompt).not.toMatch(/general study help/i)
      expect(prompt).not.toMatch(/tools are attached to this message/i)
      expect(prompt).not.toMatch(/invite them to ask about/i)
      expect(prompt).toMatch(/never suggest that rephrasing will unlock their data/i)
      expect(prompt).toMatch(/can't load their Stracker data right now/i)
    }
  })

  it('keeps the security rules', () => {
    for (const prompt of variants) {
      expect(prompt).toContain('You do not have SQL, shell, arbitrary database, or cross-account access.')
      expect(prompt).toContain('never request or invent a user ID')
    }
  })

  it('tells a tool-enabled turn that an earlier refusal is outdated', () => {
    expect(variants[1]).toMatch(/that is outdated: read it now/)
  })
})
