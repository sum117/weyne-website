import { logUnexpectedError } from '@/lib/server/log-redaction'
import { createServerFn } from '@tanstack/react-start'
import type { z } from 'zod'
import { getDatabase } from '@/lib/db/database.server'
import {
  failure,
  unexpected,
  type ApplicationError,
  type Result,
} from '@/lib/domain/result'
import { toPublicResult, type PublicResult } from '@/lib/server/public-error'
import { parseRequest } from '@/lib/server/request.schema'
import {
  createReferenceRecordPersistence,
  referenceRecordCursorCodec,
} from './reference-record.repository.server'
import {
  archiveReferenceRecordRequestSchema,
  createReferenceRecordRequestSchema,
  listReferenceRecordsRequestSchema,
  readReferenceRecordRequestSchema,
  updateReferenceRecordRequestSchema,
} from './reference-record.schema'
import { createReferenceRecordService } from './reference-record.service'
import type { ReferenceRecord, ReferenceRecordPage } from './reference-record'

export type ReferenceRecordServiceContract = Readonly<{
  read: (id: string) => Promise<Result<ReferenceRecord>>
  list: (
    query: z.output<typeof listReferenceRecordsRequestSchema>,
  ) => Promise<Result<ReferenceRecordPage>>
  create: (
    input: z.output<typeof createReferenceRecordRequestSchema>,
  ) => Promise<Result<ReferenceRecord>>
  update: (
    input: z.output<typeof updateReferenceRecordRequestSchema>,
  ) => Promise<Result<ReferenceRecord>>
  archive: (
    input: z.output<typeof archiveReferenceRecordRequestSchema>,
  ) => Promise<Result<ReferenceRecord>>
}>

type OperationDependencies = Readonly<{
  getService: () => Promise<ReferenceRecordServiceContract>
  logUnexpectedError: (cause: unknown) => void
}>

function publicResult<T>(
  result: Result<T, ApplicationError>,
  logUnexpectedError: (cause: unknown) => void,
): PublicResult<T> {
  if (!result.ok && result.error.category === 'unexpected') {
    logUnexpectedError(result.error.cause)
  }
  return toPublicResult(result)
}

export function createReferenceRecordOperations(
  dependencies: OperationDependencies,
) {
  const execute = async <TSchema extends z.ZodType, T>(
    schema: TSchema,
    input: unknown,
    invoke: (
      service: ReferenceRecordServiceContract,
      validated: z.output<TSchema>,
    ) => Promise<Result<T>>,
  ): Promise<PublicResult<T>> => {
    const parsed = parseRequest(schema, input)
    if (!parsed.ok) return toPublicResult(parsed)

    try {
      const service = await dependencies.getService()
      const result = await invoke(service, parsed.data)
      return publicResult(result, dependencies.logUnexpectedError)
    } catch (cause) {
      dependencies.logUnexpectedError(cause)
      return toPublicResult(failure(unexpected(cause)))
    }
  }

  return Object.freeze({
    read(input: unknown) {
      return execute(readReferenceRecordRequestSchema, input, (service, request) =>
        service.read(request.id),
      )
    },
    list(input: unknown) {
      return execute(listReferenceRecordsRequestSchema, input, (service, request) =>
        service.list(request),
      )
    },
    create(input: unknown) {
      return execute(createReferenceRecordRequestSchema, input, (service, request) =>
        service.create(request),
      )
    },
    update(input: unknown) {
      return execute(updateReferenceRecordRequestSchema, input, (service, request) =>
        service.update(request),
      )
    },
    archive(input: unknown) {
      return execute(archiveReferenceRecordRequestSchema, input, (service, request) =>
        service.archive(request),
      )
    },
  })
}

async function getReferenceRecordService(): Promise<ReferenceRecordServiceContract> {
  const database = await getDatabase()
  const persistence = createReferenceRecordPersistence(database)
  return createReferenceRecordService({
    ...persistence,
    createId: () => crypto.randomUUID(),
    now: () => new Date(),
    cursorCodec: referenceRecordCursorCodec,
  })
}

const referenceRecordOperations = createReferenceRecordOperations({
  getService: getReferenceRecordService,
  logUnexpectedError: (cause) => {
    logUnexpectedError('reference-record.server', cause)
  },
})

const acceptUnknownInput = (input: unknown) => input

export const readReferenceRecord = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(({ data }) => referenceRecordOperations.read(data))

export const listReferenceRecords = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(({ data }) => referenceRecordOperations.list(data))

export const createReferenceRecord = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(({ data }) => referenceRecordOperations.create(data))

export const updateReferenceRecord = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(({ data }) => referenceRecordOperations.update(data))

export const archiveReferenceRecord = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(({ data }) => referenceRecordOperations.archive(data))
