import { describe, expect, it } from 'vitest'
import { taskInputSchema } from './task-validation'

const task = { title: 'Revise a chapter', estimated_minutes: 30, task_date: '2026-10-08' }

describe('task input validation', () => {
  it('accepts whole-minute estimates within the database range and real calendar dates', () => {
    expect(taskInputSchema.safeParse(task).success).toBe(true)
    expect(taskInputSchema.safeParse({ ...task, estimated_minutes: 0 }).success).toBe(true)
    expect(taskInputSchema.safeParse({ ...task, estimated_minutes: 1440 }).success).toBe(true)
    expect(taskInputSchema.safeParse({ ...task, task_date: '2026-02-30' }).success).toBe(false)
  })

  it('rejects fractional, negative, and over-day task estimates', () => {
    expect(taskInputSchema.safeParse({ ...task, estimated_minutes: 1.5 }).success).toBe(false)
    expect(taskInputSchema.safeParse({ ...task, estimated_minutes: -1 }).success).toBe(false)
    expect(taskInputSchema.safeParse({ ...task, estimated_minutes: 1441 }).success).toBe(false)
  })
})
