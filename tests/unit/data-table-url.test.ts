import { describe, expect, it } from 'vitest'
import {
  dataTableSearchEquals,
  parseDataTableSearch,
  serializeDataTableSearch,
} from '@/components/data-table/data-table-url-state'

const options = {
  defaultPageSize: 20,
  pageSizes: [10, 20, 50],
  sortableColumns: ['name', 'status'],
  filterColumns: ['status', 'region'],
} as const

describe('DataTable URL state', () => {
  it('parses valid pagination, sorting, and repeated facet values', () => {
    expect(
      parseDataTableSearch(
        {
          page: '3',
          pageSize: '50',
          sort: 'name.desc',
          status: ['active', 'pending'],
          region: 'northeast',
        },
        options,
      ),
    ).toEqual({
      pagination: { pageIndex: 2, pageSize: 50 },
      sorting: [{ id: 'name', desc: true }],
      columnFilters: [
        { id: 'status', value: ['active', 'pending'] },
        { id: 'region', value: ['northeast'] },
      ],
    })
  })

  it('falls back safely for missing, invalid, or unknown parameters', () => {
    expect(
      parseDataTableSearch(
        {
          page: '-8',
          pageSize: '999',
          sort: 'private.desc',
          status: [null, '', 42],
        },
        options,
      ),
    ).toEqual({
      pagination: { pageIndex: 0, pageSize: 20 },
      sorting: [],
      columnFilters: [],
    })
  })

  it('round-trips shareable state and preserves unrelated search values', () => {
    const state = {
      pagination: { pageIndex: 1, pageSize: 10 },
      sorting: [{ id: 'status', desc: false }],
      columnFilters: [{ id: 'status', value: ['pending', 'active'] }],
    }

    const search = serializeDataTableSearch(state, options, { tab: 'overview' })

    expect(search).toEqual({
      tab: 'overview',
      page: 2,
      pageSize: 10,
      sort: 'status.asc',
      status: ['pending', 'active'],
    })
    expect(parseDataTableSearch(search, options)).toEqual(state)
  })

  it('omits defaults so canonical URL updates stabilize without loops', () => {
    expect(
      serializeDataTableSearch(
        {
          pagination: { pageIndex: 0, pageSize: 20 },
          sorting: [],
          columnFilters: [],
        },
        options,
        { page: 9, sort: 'name.asc', status: 'active', tab: 'all' },
      ),
    ).toEqual({ tab: 'all' })
  })

  it('compares canonical search objects independently of key order', () => {
    expect(
      dataTableSearchEquals(
        { page: 2, status: ['active'], tab: 'all' },
        { tab: 'all', status: ['active'], page: 2 },
      ),
    ).toBe(true)
  })
})
