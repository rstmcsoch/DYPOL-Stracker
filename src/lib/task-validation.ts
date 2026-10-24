import { z } from 'zod'

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, 'Task title is required.').max(200),
  topic: z.string().trim().max(120, 'Keep the topic under 120 characters.').nullable().optional(),
  estimated_minutes: z.number().finite().int().min(0).max(1440),
  task_date: z.iso.date()
})
