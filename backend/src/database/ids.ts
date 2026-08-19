import { v7 as uuidV7 } from 'uuid'

/**
 * Every primary key in OneStack is a UUIDv7.
 *
 * v7 puts a millisecond timestamp in the high bits, so identifiers sort by
 * creation time. That keeps primary key inserts at the right edge of the
 * B-tree instead of scattering across it the way v4 does, while still being
 * opaque in a URL — /customers/18 would tell the world how many customers
 * there are.
 */
export function newId(): string {
  return uuidV7()
}
