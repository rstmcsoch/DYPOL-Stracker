import { describe, expect, it } from 'vitest'
import { MODEL_TOOLS } from './tools.js'
import { conversationNeedsData, conversationWriteIntent, messageHasWriteIntent, requiresTools, selectedSystem, shouldOfferTools, toolsForMessage, withoutToolTalk } from './agent.js'

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

// t158: the exact production transcript (three.dev request 01a1de53…). The follow-up with the
// details was routed as analytics with read tools only, so the model said it had no tool to add it.
describe('Stracker AI write intent across turns (add a test)', () => {
  const first = 'How am I doing in each subject?'
  const ask = 'Add a test'
  const details = 'Weekly mock test 17 it was today  and it was full test I got 150 out of 180. Correct are 30, wrong are 13 and remaining skipped out of 45 questions due to time management. It takes around 90min'
  const prior = [
    { role: 'user', content: first },
    { role: 'assistant', content: 'You don’t have any test data recorded yet, so there are no subject averages to show.' },
    { role: 'user', content: ask },
    { role: 'assistant', content: 'I’ll help you add a test entry. I need a few details: title, date, type, marks and total…' }
  ]
  const names = (message: string, history = prior) => toolsForMessage(message, MODEL_TOOLS, history).map(tool => tool.name)

  it('"Add a test" offers create_test', () => {
    expect(messageHasWriteIntent(ask)).toBe(true)
    expect(names(ask, prior.slice(0, 2))).toContain('create_test')
  })

  it('the follow-up with the details keeps create_test, even though it talks about marks and scores', () => {
    expect(conversationWriteIntent(details, prior)).toBe(true)
    const offered = names(details)
    expect(offered).toContain('create_test')
    expect(offered).toContain('find_chapters')
    expect(offered.length).toBeLessThanOrEqual(14)
  })

  it('reads the score report on its own as a request to log the test', () => {
    expect(messageHasWriteIntent(details)).toBe(true)
    expect(names(details, [])).toContain('create_test')
    expect(messageHasWriteIntent('Scored 520/720 in today’s full mock')).toBe(true)
    expect(messageHasWriteIntent('I got 62 in the chemistry test')).toBe(true)
  })

  it('a follow-up that never names the test still gets the test write tools from the earlier turn', () => {
    expect(names('It was today, 150 out of 180, 90 minutes')).toContain('create_test')
    expect(names('Title is Weekly mock 17')).toContain('create_test')
  })

  it('write tools for the action come first, so the tool cap never cuts them', () => {
    const offered = names('Add today’s mock test: 150 out of 180, and plan a revision task for my weak chapters with progress analytics')
    expect(offered).toContain('create_test')
    expect(offered).toContain('create_task')
    expect(offered.indexOf('create_test')).toBeLessThan(offered.indexOf('get_test_history'))
  })

  it('the write request expires after a couple of unrelated turns', () => {
    const later = [...prior, { role: 'user', content: 'Explain Le Chatelier’s principle' }, { role: 'assistant', content: '…' }, { role: 'user', content: 'And Hess’s law?' }, { role: 'assistant', content: '…' }]
    expect(conversationWriteIntent('What about entropy?', later)).toBe(false)
  })

  it('plain read questions still get no update/delete tools; proposing a new test stays on offer', () => {
    const offered = toolsForMessage('How did my last mock test go?', MODEL_TOOLS).map(tool => tool.name)
    expect(offered).toContain('get_test_history')
    expect(offered.some(name => /^(update|delete|complete|mark)_/.test(name))).toBe(false)
    expect(offered).toContain('create_test')
    expect(messageHasWriteIntent('How did my last mock test go?')).toBe(false)
    expect(messageHasWriteIntent('What is a good score in NEET?')).toBe(false)
  })

  it('create_test needs only the essentials: optional fields and IDs are not required', () => {
    const tool = MODEL_TOOLS.find(item => item.name === 'create_test')!
    const required = (tool.inputSchema as { required?: string[] }).required ?? []
    for (const optional of ['chapter_id', 'negative_marks', 'notes', 'subject_scores', 'correct', 'wrong', 'skipped', 'time_minutes']) expect(required).not.toContain(optional)
    expect(required).toEqual(expect.arrayContaining(['title', 'test_date', 'test_type']))
    expect(tool.description).toMatch(/never ask the student for an ID/i)
  })
})

describe('Stracker AI answer guard (no tool talk)', () => {
  it('rewrites the production reply that disclosed its tools', () => {
    const reply = 'Thanks for sharing those details!\n\n- **Score:** 150 / 180 (83.3%)\n\n**However, I don\'t have the ability to add test entries directly through my current tools.** You\'ll need to log this test in the Stracker app itself.'
    const cleaned = withoutToolTalk(reply)
    expect(cleaned).not.toMatch(/tools?/i)
    expect(cleaned).toContain('I can\'t do that here yet — you can add it from the Tests tab.')
    expect(cleaned).toContain('150 / 180 (83.3%)')
  })

  it.each([
    'None of the functions available to me can do that.',
    'I don\'t have a tool for adding tasks.',
    'That needs a function call I can\'t make.',
    'My available tools only read data.'
  ])('catches %j', text => {
    expect(withoutToolTalk(text)).toMatch(/^I can't do that here yet — /)
  })

  it('leaves ordinary study advice about tools alone', () => {
    for (const text of ['Use tools like a formula sheet and flashcards for revision.', 'A good revision tool is spaced repetition.', 'Your score is 150 out of 180.']) expect(withoutToolTalk(text)).toBe(text)
  })

  it('the prompt tells the model how to decline and how to add a test', () => {
    const prompt = selectedSystem('Dashboard', 'action', true)
    expect(prompt).toMatch(/I can't do that here yet — you can add it from the Tests tab/)
    expect(prompt).toMatch(/Never mention tools, functions, capabilities/)
    expect(prompt).toMatch(/Never ask the student for any ID/)
  })
})
