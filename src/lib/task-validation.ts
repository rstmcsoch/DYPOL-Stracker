import { z } from 'zod'

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, 'Task title is required.').max(200),
  estimated_minutes: z.number().int().min(0).max(1440),
  task_date: z.iso.date()
})
