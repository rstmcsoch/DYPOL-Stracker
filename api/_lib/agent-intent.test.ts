import { describe, expect, it } from 'vitest'
import { MODEL_TOOLS } from './tools.js'
import { conversationNeedsData, conversationWriteIntent, messageHasWriteIntent, requiresTools, selectedSystem, refusesSupportedWork, toolsForTurn, withoutToolTalk } from './agent.js'

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

  it('every turn gets the full catalog, read and write: greetings, long notes and study questions too', () => {
    const all = MODEL_TOOLS.map(tool => tool.name)
    expect(toolsForTurn().map(tool => tool.name)).toEqual(all)
    expect(all.length).toBe(30)
    for (const name of ['create_test', 'update_test', 'delete_test', 'create_task', 'create_mistake', 'create_weekly_goal', 'mark_revision_complete', 'update_settings', 'get_subject_performance', 'get_backlog']) expect(all).toContain(name)
    expect(essay.length).toBeGreaterThan(800)
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

  it('tells the model the backlog is not the revision schedule', () => {
    for (const prompt of variants) {
      expect(prompt).toMatch(/use get_backlog/)
      expect(prompt).toMatch(/not the chapter revision schedule/)
    }
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
  const names = () => toolsForTurn(['Physics', 'Chemistry', 'Botany', 'Zoology']).map(tool => tool.name)

  it('"Add a test" offers create_test', () => {
    expect(messageHasWriteIntent(ask)).toBe(true)
    expect(names()).toContain('create_test')
  })

  it('the follow-up with the details keeps create_test, even though it talks about marks and scores', () => {
    expect(conversationWriteIntent(details, prior)).toBe(true)
    const offered = names()
    expect(offered).toContain('create_test')
    expect(offered).toContain('find_chapters')
  })

  it('reads the score report on its own as a request to log the test', () => {
    expect(messageHasWriteIntent(details)).toBe(true)
    expect(messageHasWriteIntent('Scored 520/720 in today’s full mock')).toBe(true)
    expect(messageHasWriteIntent('I got 62 in the chemistry test')).toBe(true)
  })

  it('the write request expires after a couple of unrelated turns', () => {
    const later = [...prior, { role: 'user', content: 'Explain Le Chatelier’s principle' }, { role: 'assistant', content: '…' }, { role: 'user', content: 'And Hess’s law?' }, { role: 'assistant', content: '…' }]
    expect(conversationWriteIntent('What about entropy?', later)).toBe(false)
  })

  it('create_test needs only the essentials: optional fields and IDs are not required', () => {
    const tool = MODEL_TOOLS.find(item => item.name === 'create_test')!
    const required = (tool.inputSchema as { required?: string[] }).required ?? []
    for (const optional of ['chapter_id', 'negative_marks', 'notes', 'subject_scores', 'correct', 'wrong', 'skipped', 'time_minutes']) expect(required).not.toContain(optional)
    expect(required).toEqual(expect.arrayContaining(['title', 'test_date', 'test_type']))
    expect(tool.description).toMatch(/never ask the student for an ID/i)
    // Compact: no regex patterns or numeric bounds, and the whole catalog stays small.
    expect(JSON.stringify(MODEL_TOOLS)).not.toContain('"pattern"')
    expect(JSON.stringify(MODEL_TOOLS).length).toBeLessThan(13_500)
  })
})

describe('Stracker AI answer guard (no tool talk)', () => {
  it('drops the production reply\'s tool talk without claiming it can\'t add a test (a tool exists)', () => {
    const reply = 'Thanks for sharing those details!\n\n- **Score:** 150 / 180 (83.3%)\n\n**However, I don\'t have the ability to add test entries directly through my current tools.** You\'ll need to log this test in the Stracker app itself.'
    const cleaned = withoutToolTalk(reply, 'Weekly mock test 17, 150 out of 180')
    expect(cleaned).not.toMatch(/tools?/i)
    expect(cleaned).not.toMatch(/can't do that here/)
    expect(cleaned).toContain('150 / 180 (83.3%)')
  })

  it('never says "can\'t do that here" when the requested action has a tool, or one was just called', () => {
    const transcript = 'I can\'t do that here yet — you can add it from the Tests tab.'
    expect(refusesSupportedWork(transcript, 'Sorry, 40, 45, 35, 30')).toBe(true)
    expect(withoutToolTalk(transcript, 'Sorry, 40, 45, 35, 30')).toBe('')
    expect(refusesSupportedWork('The tool add_test is not available in the provided tools list.', 'Sorry, 40, 45, 35, 30')).toBe(true)
    expect(withoutToolTalk('I don\'t have a tool for adding tasks.', 'Add a task to revise optics')).toBe('')
    expect(refusesSupportedWork('I\'m unable to log that test for you.', 'log my mock')).toBe(true)
  })

  it.each([
    ['None of the functions available to me can do that.', 'Send an email to my teacher'],
    ['I don\'t have a tool for setting reminders.', 'Remind me at 6 pm'],
    ['That needs a function call I can\'t make.', 'Change my password'],
    ['My available tools only read data.', 'Upload my answer sheet photo']
  ])('keeps a plain one-line decline for work with no tool: %j', (text, request) => {
    expect(refusesSupportedWork(text, request)).toBe(false)
    expect(withoutToolTalk(text, request)).toMatch(/^I can't do that here yet — /)
  })

  it('leaves ordinary study advice about tools alone', () => {
    for (const text of ['Use tools like a formula sheet and flashcards for revision.', 'A good revision tool is spaced repetition.', 'Your score is 150 out of 180.']) expect(withoutToolTalk(text)).toBe(text)
  })

  it('the prompt never teaches a refusal line and says how to add a test', () => {
    const prompt = selectedSystem('Dashboard', 'action', true)
    expect(prompt).not.toMatch(/I can't do that here yet/)
    expect(prompt).toMatch(/Never decline work a tool can do/)
    expect(prompt).toMatch(/Never mention tools, functions, capabilities/)
    expect(prompt).toMatch(/Never ask the student for any ID/)
    expect(prompt).toMatch(/title, date, test type, subject \(or Full Mock\), marks obtained and total marks/)
    expect(prompt.length).toBeLessThan(3_400)
  })
})
