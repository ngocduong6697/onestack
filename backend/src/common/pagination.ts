import type { SQL } from 'drizzle-orm'
import { and, gt } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'

/**
 * Keyset pagination, in one place.
 *
 * Six services had each written this out: fetch one more row than asked for,
 * slice it off, and use the last surviving id as the next cursor. It is not
 * complicated, which is exactly why six copies of it was six chances to get
 * the off-by-one wrong in a different way.
 *
 * Keyset rather than offset because every id here is a UUIDv7 and therefore
 * already sorted by creation time, so `where id > cursor order by id` costs
 * the same on page one thousand as on page one.
 */
export const MAX_PAGE_LIMIT = 100

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

/** Adds the cursor condition, if there is one. */
export function withCursor(
  idColumn: PgColumn,
  cursor: string | undefined,
  conditions: (SQL | undefined)[],
): SQL | undefined {
  return and(...conditions, cursor ? gt(idColumn, cursor) : undefined)
}

export function cappedLimit(limit: number): number {
  return Math.min(limit, MAX_PAGE_LIMIT)
}

/**
 * Turns `limit + 1` rows into a page. The extra row is how "is there more"
 * is answered without a second count query; it is dropped before returning.
 */
export function toPage<Row, Item extends { id: string }>(
  rows: Row[],
  limit: number,
  map: (row: Row) => Item,
): Page<Item> {
  const items = rows.slice(0, limit).map(map)

  return {
    items,
    nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null,
  }
}
