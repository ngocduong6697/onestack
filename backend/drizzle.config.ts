import type { Config } from 'drizzle-kit'

/**
 * drizzle-kit generates the forward SQL from the schema. Applying it is the
 * job of src/database/migrate.ts, which also knows about the paired
 * .down.sql files that drizzle-kit does not produce.
 */
export default {
  schema: './src/database/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  breakpoints: true,
} satisfies Config
