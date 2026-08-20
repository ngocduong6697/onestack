import { z } from 'zod'
import { completionRequestSchema } from './ai'

export const TRIGGER_TYPE_VALUES = ['manual', 'schedule'] as const
export const RUN_STATUS_VALUES = ['running', 'succeeded', 'failed'] as const
export const STEP_STATUS_VALUES = ['succeeded', 'failed', 'skipped'] as const

export const triggerTypeSchema = z.enum(TRIGGER_TYPE_VALUES)

/**
 * A step's inputs may reference an earlier step, as `{{steps.0.text}}`. The
 * reference is checked when the workflow is written, not when it runs — a
 * template pointing at a step that has not happened is a definition mistake,
 * and finding out at three in the morning is not the moment for it.
 */
export const TEMPLATE_PATTERN = /\{\{\s*steps\.(\d+)\.([a-zA-Z0-9_]+)\s*\}\}/g

export const aiStepSchema = z.object({
  action: z.literal('ai.complete'),
  model: completionRequestSchema.shape.model,
  prompt: z.string().min(1).max(50_000),
  system: z.string().max(50_000).optional(),
  maxTokens: z.number().int().min(1).max(128_000).default(1024),
})

export const httpStepSchema = z.object({
  action: z.literal('http.request'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  /**
   * The scheme is checked here as well as at run time. `z.string().url()`
   * happily accepts `file:///etc/passwd`, and a workflow that can only fail
   * should be refused when it is written, not when it fires.
   */
  url: z
    .string()
    .url()
    .max(2000)
    .refine((value) => /^https?:\/\//i.test(value), 'Only http and https URLs may be requested'),
  headers: z.record(z.string().max(200), z.string().max(2000)).optional(),
  body: z.string().max(50_000).optional(),
})

export const stepSchema = z.discriminatedUnion('action', [aiStepSchema, httpStepSchema])

export const workflowStepsSchema = z.array(stepSchema).min(1).max(20)

const nameSchema = z.string().trim().min(1, 'Name is required').max(200)

/**
 * A cron expression, five fields. Validated for shape here and parsed properly
 * by the scheduler; a schedule trigger without one is rejected outright.
 */
export const cronSchema = z
  .string()
  .trim()
  .regex(/^(\S+\s+){4}\S+$/, 'A cron expression has five fields')

export const createWorkflowRequestSchema = z
  .object({
    name: nameSchema,
    enabled: z.boolean().default(true),
    triggerType: triggerTypeSchema.default('manual'),
    cron: cronSchema.optional(),
    timezone: z.string().max(64).default('UTC'),
    steps: workflowStepsSchema,
  })
  .refine(
    (body) => body.triggerType !== 'schedule' || Boolean(body.cron),
    'A scheduled workflow needs a cron expression',
  )

export const updateWorkflowRequestSchema = z
  .object({
    name: nameSchema.optional(),
    enabled: z.boolean().optional(),
    triggerType: triggerTypeSchema.optional(),
    cron: cronSchema.nullish(),
    timezone: z.string().max(64).optional(),
    steps: workflowStepsSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update')

export const workflowSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  enabled: z.boolean(),
  triggerType: triggerTypeSchema,
  cron: z.string().nullable(),
  timezone: z.string(),
  steps: workflowStepsSchema,
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
})

export const runStepSchema = z.object({
  id: z.string().uuid(),
  index: z.number().int(),
  action: z.string(),
  status: z.enum(STEP_STATUS_VALUES),
  durationMs: z.number().int(),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  costMicroUsd: z.number().int(),
})

export const runSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  status: z.enum(RUN_STATUS_VALUES),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
})

export const runWithStepsSchema = runSchema.extend({ steps: z.array(runStepSchema) })

export const runPageSchema = z.object({
  items: z.array(runSchema),
  nextCursor: z.string().uuid().nullable(),
})

export type WorkflowStep = z.infer<typeof stepSchema>
export type AiStep = z.infer<typeof aiStepSchema>
export type HttpStep = z.infer<typeof httpStepSchema>
export type CreateWorkflowRequest = z.infer<typeof createWorkflowRequestSchema>
export type UpdateWorkflowRequest = z.infer<typeof updateWorkflowRequestSchema>
export type Workflow = z.infer<typeof workflowSchema>
export type Run = z.infer<typeof runSchema>
export type RunStep = z.infer<typeof runStepSchema>
export type RunWithSteps = z.infer<typeof runWithStepsSchema>
export type RunPage = z.infer<typeof runPageSchema>
