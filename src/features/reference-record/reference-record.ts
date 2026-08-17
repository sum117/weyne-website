export type ReferenceRecord = Readonly<{
  id: string
  name: string
  budget: string
  version: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}>

export type ReferenceRecordSort = 'name' | 'createdAt'
export type ReferenceRecordSortDirection = 'asc' | 'desc'

export type ReferenceRecordCursor = Readonly<{
  sortBy: ReferenceRecordSort
  sortDirection: ReferenceRecordSortDirection
  value: string
  id: string
}>

export type ReferenceRecordListQuery = Readonly<{
  limit: number
  cursor?: string
  filters: Readonly<{ nameContains?: string }>
  sortBy: ReferenceRecordSort
  sortDirection: ReferenceRecordSortDirection
}>

export type ReferenceRecordPage = Readonly<{
  items: readonly ReferenceRecord[]
  nextCursor: string | null
}>

export type ReferenceRecordEvent = Readonly<{
  recordId: string
  operation: 'created' | 'updated' | 'archived'
  actor: string
  version: number
  occurredAt: string
}>

export type CreateReferenceRecord = Readonly<{
  name: string
  budget: string
  actor: string
}>

export type UpdateReferenceRecord = CreateReferenceRecord &
  Readonly<{
    id: string
    expectedVersion: number
  }>

export type ArchiveReferenceRecord = Readonly<{
  id: string
  expectedVersion: number
  actor: string
}>
