import { resolve } from 'node:path'

/** The repository root, three levels up from src/config or dist/config alike. */
const DEFAULT_PATH = resolve(__dirname, '../../../.env')

/**
 * Pull the repository's .env into process.env so a checkout boots the way the
 * README promises. Node's own reader does the parsing — the same one behind
 * --env-file — which is why this costs no dependency.
 *
 * Two properties come from Node and both are wanted here:
 *   - a real environment variable beats the file, so a deploy that sets
 *     DATABASE_URL is never overridden by a .env that came along for the ride;
 *   - the file is optional, because a container has none and must still boot.
 *
 * Call it from an entry point, before loadEnv(). Reading the filesystem is a
 * side effect and belongs where the process starts, not in a module that other
 * code imports for its own reasons.
 */
export function loadEnvFile(path: string = DEFAULT_PATH): void {
  const alreadySet = new Set(Object.keys(process.env))

  try {
    process.loadEnvFile(path)
  } catch (error) {
    // A missing file is the normal deployed case. Anything else — unreadable,
    // malformed — is a real problem and should not be swallowed.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error

    return
  }

  /**
   * `.env.example` writes an optional variable as a bare `KEY=`, and Node
   * reads that as an empty string. An empty string is a value: it satisfies a
   * required field and it beats a `.default()`. A blank line in the file means
   * "not set", so make it mean that — otherwise `cp .env.example .env` hands
   * the schema three empty API keys and the API refuses to boot.
   *
   * Only keys the file introduced are dropped. A variable the real environment
   * set to empty on purpose is left exactly as it was.
   */
  for (const [key, value] of Object.entries(process.env)) {
    if (value === '' && !alreadySet.has(key)) delete process.env[key]
  }
}
