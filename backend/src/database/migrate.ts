import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import postgres, { type Sql } from 'postgres'

/**
 * A migration runner rather than drizzle-kit's, for one reason: rule 9 asks
 * for reversibility, and that means every `0000_x.sql` has a hand-written
 * `0000_x.down.sql` this runner knows how to apply. drizzle-kit still
 * generates the forward SQL; it just does not own applying it.
 */

const TABLE = 'onestack_migrations'
const BREAKPOINT = '--> statement-breakpoint'

export interface Migration {
  id: string
  upPath: string
  downPath: string
  hash: string
}

/** Resolves whether invoked from the backend workspace or the repository root. */
export function migrationsDir(cwd: string = process.cwd()): string {
  const local = join(cwd, 'drizzle')
  return existsSync(local) ? local : join(cwd, 'backend', 'drizzle')
}

export async function discover(dir: string = migrationsDir()): Promise<Migration[]> {
  const entries = await readdir(dir)
  const ups = entries.filter((name) => name.endsWith('.sql') && !name.endsWith('.down.sql')).sort()

  return Promise.all(
    ups.map(async (name) => {
      const id = name.replace(/\.sql$/, '')
      const upPath = join(dir, name)
      const contents = await readFile(upPath, 'utf8')

      return {
        id,
        upPath,
        downPath: join(dir, `${id}.down.sql`),
        hash: createHash('sha256').update(contents).digest('hex'),
      }
    }),
  )
}

async function ensureTable(sql: Sql): Promise<void> {
  await sql.unsafe(`
    create table if not exists ${TABLE} (
      id text primary key,
      hash text not null,
      applied_at timestamptz not null default now()
    )
  `)
}

async function applied(sql: Sql): Promise<Map<string, string>> {
  const rows = await sql.unsafe<{ id: string; hash: string }[]>(
    `select id, hash from ${TABLE} order by id`,
  )
  return new Map(rows.map((row) => [row.id, row.hash]))
}

/** Splits on drizzle's breakpoint marker so each statement runs on its own. */
function statements(contents: string): string[] {
  return contents
    .split(BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

export async function up(sql: Sql, dir?: string): Promise<string[]> {
  await ensureTable(sql)

  const known = await applied(sql)
  const all = await discover(dir)
  const run: string[] = []

  for (const migration of all) {
    const previousHash = known.get(migration.id)

    if (previousHash !== undefined) {
      // An applied migration that has since been edited means the database and
      // the repository disagree about history. Refuse rather than guess.
      if (previousHash !== migration.hash) {
        throw new Error(
          `Migration ${migration.id} was modified after it was applied. ` +
            `Write a new migration instead of editing history.`,
        )
      }
      continue
    }

    if (!existsSync(migration.downPath)) {
      throw new Error(
        `Migration ${migration.id} has no ${migration.id}.down.sql. ` +
          `CLAUDE.md rule 9 asks for reversibility; write the down migration, ` +
          `or state in it why the change cannot be reversed.`,
      )
    }

    const contents = await readFile(migration.upPath, 'utf8')

    await sql.begin(async (tx) => {
      for (const statement of statements(contents)) {
        await tx.unsafe(statement)
      }
      await tx.unsafe(`insert into ${TABLE} (id, hash) values ($1, $2)`, [
        migration.id,
        migration.hash,
      ])
    })

    run.push(migration.id)
  }

  return run
}

/** Reverts the most recently applied migration. One step, deliberately. */
export async function down(sql: Sql, dir?: string): Promise<string | null> {
  await ensureTable(sql)

  const rows = await sql.unsafe<{ id: string }[]>(
    `select id from ${TABLE} order by id desc limit 1`,
  )
  const last = rows[0]

  if (!last) return null

  const migration = (await discover(dir)).find((candidate) => candidate.id === last.id)

  if (!migration) {
    throw new Error(`Applied migration ${last.id} has no file in ${migrationsDir()}.`)
  }

  const contents = await readFile(migration.downPath, 'utf8')

  await sql.begin(async (tx) => {
    for (const statement of statements(contents)) {
      await tx.unsafe(statement)
    }
    await tx.unsafe(`delete from ${TABLE} where id = $1`, [migration.id])
  })

  return migration.id
}

export async function status(
  sql: Sql,
  dir?: string,
): Promise<{ id: string; appliedAt: Date | null }[]> {
  await ensureTable(sql)

  const rows = await sql.unsafe<{ id: string; applied_at: Date }[]>(
    `select id, applied_at from ${TABLE}`,
  )
  const appliedAt = new Map(rows.map((row) => [row.id, row.applied_at]))

  return (await discover(dir)).map((migration) => ({
    id: migration.id,
    appliedAt: appliedAt.get(migration.id) ?? null,
  }))
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'status'
  const url = process.env.DATABASE_URL

  if (!url) throw new Error('DATABASE_URL is not set.')

  // One connection: a migration is not a workload.
  const sql = postgres(url, { max: 1, onnotice: () => undefined })

  try {
    if (command === 'up') {
      const ran = await up(sql)
      console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Nothing to apply.')
    } else if (command === 'down') {
      const reverted = await down(sql)
      console.log(reverted ? `Reverted: ${reverted}` : 'Nothing to revert.')
    } else if (command === 'status') {
      for (const entry of await status(sql)) {
        console.log(`${entry.appliedAt ? 'applied ' : 'pending '} ${entry.id}`)
      }
    } else {
      throw new Error(`Unknown command "${command}". Expected up, down or status.`)
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
