import { z } from 'zod'
import {
  createListRequestSchema,
  entityIdRequestSchema,
} from '@/lib/server/request.schema'

const referenceRecordNameSchema = z.string().trim().min(1).max(200)
const referenceRecordBudgetSchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, 'Invalid decimal value')
const referenceRecordActorSchema = z.string().trim().min(1).max(200)
const referenceRecordVersionSchema = z.number().int().positive()

export const readReferenceRecordRequestSchema = entityIdRequestSchema

export const listReferenceRecordsRequestSchema = createListRequestSchema({
  filters: {
    nameContains: z.string().trim().min(1).max(200),
  },
  sortFields: ['name', 'createdAt'],
  defaultSort: 'createdAt',
  defaultDirection: 'desc',
})

export const createReferenceRecordRequestSchema = z.strictObject({
  name: referenceRecordNameSchema,
  budget: referenceRecordBudgetSchema,
  actor: referenceRecordActorSchema,
})

export const updateReferenceRecordRequestSchema = z.strictObject({
  id: z.uuid(),
  name: referenceRecordNameSchema,
  budget: referenceRecordBudgetSchema,
  expectedVersion: referenceRecordVersionSchema,
  actor: referenceRecordActorSchema,
})

export const archiveReferenceRecordRequestSchema = z.strictObject({
  id: z.uuid(),
  expectedVersion: referenceRecordVersionSchema,
  actor: referenceRecordActorSchema,
})
