import { z } from 'zod'

export const settingsSchema = z.object({
  owner_name: z.string().trim().max(100),
  target_score: z.number().min(0).max(10000),
  weak_threshold: z.number().min(0).max(99.99),
  strong_threshold: z.number().min(0.01).max(100),
  dropping_threshold: z.number().min(0).max(100),
  revision_gaps: z.array(z.number().int().positive().max(365)).min(1).max(12),
  daily_study_goal_minutes: z.number().int().min(0).max(1440)
}).refine(value => value.weak_threshold < value.strong_threshold, { message: 'The weak threshold must be below the strong threshold.' })
