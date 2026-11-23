import { describe, expect, it } from 'vitest'
import { compactSchema, MODEL_TOOLS, modelToolsFor, normalizeToolCall, resolveToolName } from './tools.js'
import { fastPathReply } from './agent.js'
import { geminiThinkingConfig, openAIReasoningControls } from './provider-adapters.js'

const NEET = ['Physics', 'Chemistry', 'Botany', 'Zoology']

describe('tool names models invent map to the real tool', () => {
  it.each([
    ['add_test', 'create_test'], ['log_test', 'create_test'], ['functions.add_test', 'create_test'], ['Add-Test', 'create_test'],
    ['add_task', 'create_task'], ['add_mistake', 'create_mistake'], ['add_goal', 'create_weekly_goal'], ['complete_revision', 'mark_revision_complete'],
    ['create_test', 'create_test'], ['get_dashboard', 'get_dashboard_summary'], ['edit_task', 'update_task']
  ])('%s → %s', (raw, name) => expect(resolveToolName(raw)).toBe(name))

  it('an unknown name gets a helpful error listing the real tools, not "not available"', () => {
    expect(() => normalizeToolCall({ id: '1', name: 'teleport_student', arguments: {} })).toThrow(/Use one of: .*create_test/)
  })
})

describe('arguments are accepted in the shapes models send', () => {
  it('the exact three.dev add_test call becomes a valid create_test call', () => {
    const call = normalizeToolCall({ id: 'c', name: 'add_test', arguments: {
      title: 'Weekly mock test 17', date: '2026-11-15', test_type: 'Full Mock', marks_obtained: '150', total_marks: '180',
      subject_breakdown: '[{"subject": "Physics", "marks": 40, "total": 45}, {"subject": "Chemistry", "marks": 45, "total": 45}, {"subject": "Botany", "marks": 35, "total": 45}, {"subject": "Zoology", "marks": 30, "total": 45}]',
      time_taken_minutes: '90', correct_count: '30', wrong_count: '13', skipped_count: '2', notes: 'Time management issues - 2 questions skipped'
    } }, NEET)
    expect(call.name).toBe('create_test')
    expect(call.arguments).toEqual({
      title: 'Weekly mock test 17', test_date: '2026-11-15', test_type: 'Full Mock', marks_obtained: 150, total_marks: 180,
      subject_scores: [
        { subject: 'Physics', marks_obtained: 40, total_marks: 45 }, { subject: 'Chemistry', marks_obtained: 45, total_marks: 45 },
        { subject: 'Botany', marks_obtained: 35, total_marks: 45 }, { subject: 'Zoology', marks_obtained: 30, total_marks: 45 }
      ],
      time_minutes: 90, correct: 30, wrong: 13, skipped: 2, notes: 'Time management issues - 2 questions skipped'
    })
  })

  it('arguments as a JSON string, lower-case subjects and loose test types', () => {
    const call = normalizeToolCall({ id: 'c', name: 'create_test', arguments: '{"title":"Optics","test_date":"2026-11-15","test_type":"chapter test","subject":"physics","marks_obtained":"20","total_marks":"25"}' }, NEET)
    expect(call.arguments).toMatchObject({ test_type: 'Chapter Test', subject: 'Physics', marks_obtained: 20, total_marks: 25 })
    expect(normalizeToolCall({ id: 'c', name: 'create_test', arguments: { test_type: 'full test' } }).arguments).toMatchObject({ test_type: 'Full Mock' })
  })

  it('rejects a subject outside the student\u2019s exam, naming the real ones', () => {
    expect(() => normalizeToolCall({ id: 'c', name: 'create_test', arguments: { subject: 'Biology' } }, NEET)).toThrow(/Physics, Chemistry, Botany, Zoology/)
    expect(() => normalizeToolCall({ id: 'c', name: 'create_test', arguments: { test_type: 'Full Mock', subject_scores: [{ subject: 'Maths', marks_obtained: 1, total_marks: 2 }] } }, NEET)).toThrow(/not one of the student/)
  })

  it('the subject split is optional: an incomplete split next to the overall score is dropped, not asked for', () => {
    const call = normalizeToolCall({ id: 'c', name: 'create_test', arguments: { test_type: 'Full Mock', marks_obtained: 150, total_marks: 180, subject_scores: { Physics: 40, Chemistry: 45, Botany: 35, Zoology: 30 } } }, NEET)
    expect(call.arguments).not.toHaveProperty('subject_scores')
    expect(call.arguments).toMatchObject({ marks_obtained: 150, total_marks: 180 })
  })

  it('drops keys the tool does not have instead of failing the whole call', () => {
    expect(normalizeToolCall({ id: 'c', name: 'create_task', arguments: { title: 'Revise optics', date: '2026-11-16', mood: 'happy', minutes: '45' } }).arguments)
      .toEqual({ title: 'Revise optics', task_date: '2026-11-16', estimated_minutes: 45 })
  })
})

describe('compact catalog with the student\u2019s subjects', () => {
  it('keeps every tool and every write tool, without regex patterns or bounds', () => {
    expect(MODEL_TOOLS).toHaveLength(30)
    expect(MODEL_TOOLS.filter(tool => /^(create|update|delete|complete|mark)_/.test(tool.name))).toHaveLength(17)
    const text = JSON.stringify(MODEL_TOOLS)
    expect(text).not.toMatch(/"(pattern|maximum|minLength|maxLength|multipleOf)"/)
    expect(text.length).toBeLessThan(13_500)
    expect(compactSchema({ type: 'string', pattern: 'x', format: 'uuid' })).toEqual({ type: 'string', format: 'uuid' })
  })

  it('adds the exam subjects as an enum on subject fields only', () => {
    const tools = modelToolsFor(NEET)
    const createTest = tools.find(tool => tool.name === 'create_test')!.inputSchema as { properties: Record<string, Record<string, unknown>> }
    expect(JSON.stringify(createTest.properties.subject)).toContain('"enum":["Physics","Chemistry","Botany","Zoology"]')
    expect(JSON.stringify(createTest.properties.subject_scores)).toContain('"enum":["Physics","Chemistry","Botany","Zoology"]')
    expect(tools.find(tool => tool.name === 'get_dashboard_summary')).toBe(MODEL_TOOLS.find(tool => tool.name === 'get_dashboard_summary'))
    // The shared catalog is not mutated.
    expect(JSON.stringify(MODEL_TOOLS)).not.toContain('Botany')
  })
})

describe('instant checklist for a bare "add a test"', () => {
  it.each(['Add a test', 'add test', 'Add a new test.', 'please add my test', 'Can you add a test?', 'log a mock', 'I want to add a test result', 'Add today\u2019s mock test'])('%j', message => {
    const reply = fastPathReply(message, NEET)!
    expect(reply).toContain('**Title**')
    expect(reply).toContain('**Subject** (Physics, Chemistry, Botany or Zoology), or say it was a full test')
    expect(reply).toContain('**Marks obtained** and **total marks**')
  })

  it.each(['Add a test: Weekly mock 17, today, 150/180', 'How do I add a test?', 'add test 150 out of 180', 'What is a good mock score?', 'Delete my last test'])('goes to the model for %j', message => {
    expect(fastPathReply(message, NEET)).toBeNull()
  })

  it('a bare "add a task" lists what a task needs', () => {
    expect(fastPathReply('Add a task', NEET)).toContain('**What to do**')
  })
})

describe('short thinking for reasoning models', () => {
  it('OpenRouter (nemotron and every other model it serves) gets low effort with hidden reasoning', () => {
    expect(openAIReasoningControls({ providerId: 'custom', modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free' }, 'https://openrouter.ai/api/v1')).toEqual({ reasoning: { effort: 'low', exclude: true } })
  })
  it('OpenAI reasoning models get reasoning_effort low; plain chat models and other hosts get nothing', () => {
    expect(openAIReasoningControls({ providerId: 'openai', modelId: 'gpt-5-mini' }, 'https://api.openai.com/v1')).toEqual({ reasoning_effort: 'low' })
    expect(openAIReasoningControls({ providerId: 'openai', modelId: 'gpt-4o-mini' }, 'https://api.openai.com/v1')).toEqual({})
    expect(openAIReasoningControls({ providerId: 'custom', modelId: 'x' }, 'https://example.com/v1')).toEqual({})
  })
  it('Gemini 2.5 / 3 get a small thinking budget; older models are left alone', () => {
    expect(geminiThinkingConfig('gemini-2.5-flash')).toEqual({ thinkingBudget: 0 })
    expect(geminiThinkingConfig('gemini-2.5-pro')).toEqual({ thinkingBudget: 128 })
    expect(geminiThinkingConfig('gemini-3-pro-preview')).toEqual({ thinkingLevel: 'low' })
    expect(geminiThinkingConfig('gemini-2.0-flash')).toBeNull()
  })
})
