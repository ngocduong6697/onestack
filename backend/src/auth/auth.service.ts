import { Inject, Injectable, Logger } from '@nestjs/common'
import { OrgsService } from '../orgs/orgs.service'
import type { LoginRequest, PublicUser, RegisterRequest } from '@onestack/shared'
import { and, eq, gt, lt, sql } from 'drizzle-orm'
import { ConflictError, UnauthorizedError } from '../common/errors'
import type { Database } from '../database/client'
import { DATABASE } from '../database/database.module'
import { sessions, users, type UserRow } from '../database/schema'
import { burnTimeLikeAVerify, hashPassword, verifyPassword } from './password'
import { createSessionToken, hashSessionToken } from './tokens'

/** A transaction or the pool — anything these writes can run on. */
type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

export interface AuthenticatedSession {
  user: PublicUser
  /** The raw token. Returned once, to be put in a cookie, and never stored. */
  token: string
  expiresAt: Date
}

/** How long a session lives before the holder has to log in again. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** last_seen_at is worth a write at most this often, not on every request. */
const LAST_SEEN_INTERVAL_MS = 60 * 1000

export function toPublicUser(row: UserRow): PublicUser {
  // Built field by field rather than by deleting password_hash from a spread,
  // so a column added later cannot leak by default.
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly orgs: OrgsService,
  ) {}

  /**
   * Creates the account, its organization and its first workspace as one unit.
   * Nobody should log in for the first time with nowhere to put anything, and
   * a half-built tenant is worse than a failed request — so this is one
   * transaction, and the session row is inside it too.
   */
  async register(input: RegisterRequest, userAgent?: string): Promise<AuthenticatedSession> {
    const passwordHash = await hashPassword(input.password)

    const session = await this.db.transaction(async (tx) => {
      let created: UserRow

      try {
        const rows = await tx
          .insert(users)
          .values({ email: input.email, passwordHash, name: input.name })
          .returning()

        created = rows[0]!
      } catch (error) {
        // The unique index is the authority on duplicates. Checking first and
        // inserting after would still race; this cannot.
        if (isUniqueViolation(error)) {
          throw new ConflictError('An account with that email already exists')
        }
        throw error
      }

      await this.orgs.create({ name: `${created.name}'s Organization` }, created.id, tx)

      return this.startSession(created, userAgent, tx)
    })

    this.logger.log(`Registered user ${session.user.id}`)

    return session
  }

  async login(input: LoginRequest, userAgent?: string): Promise<AuthenticatedSession> {
    const found = await this.db.select().from(users).where(eq(users.email, input.email)).limit(1)
    const user = found[0]

    if (!user) {
      // Spend the same time as a real verify, so timing does not reveal which
      // emails have accounts.
      await burnTimeLikeAVerify()
      throw new UnauthorizedError('Invalid email or password')
    }

    if (!(await verifyPassword(user.passwordHash, input.password))) {
      throw new UnauthorizedError('Invalid email or password')
    }

    // Checked after the password so a disabled account is not distinguishable
    // from a wrong password by anyone who does not already know the password.
    if (user.status !== 'active') {
      throw new UnauthorizedError('Invalid email or password')
    }

    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id))

    return this.startSession(user, userAgent)
  }

  /** Resolves a raw cookie value to its user, or null if it grants nothing. */
  async authenticate(token: string): Promise<PublicUser | null> {
    const tokenHash = hashSessionToken(token)

    const rows = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
      .limit(1)

    const row = rows[0]

    if (!row) return null
    if (row.user.status !== 'active') return null

    await this.touch(row.session.id, row.session.lastSeenAt)

    return toPublicUser(row.user)
  }

  /** Deleting the row is what makes logout immediate rather than advisory. */
  async logout(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)))
  }

  /** Housekeeping for expired rows. Called by TASK-011's scheduler later. */
  async purgeExpiredSessions(now: Date = new Date()): Promise<number> {
    const deleted = await this.db.delete(sessions).where(lt(sessions.expiresAt, now)).returning()

    return deleted.length
  }

  private async startSession(
    user: UserRow,
    userAgent?: string,
    executor: Executor = this.db,
  ): Promise<AuthenticatedSession> {
    const token = createSessionToken()
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

    await executor.insert(sessions).values({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
      // A header is attacker-controlled; store a bounded amount of it.
      userAgent: userAgent?.slice(0, 400) ?? null,
    })

    return { user: toPublicUser(user), token, expiresAt }
  }

  private async touch(sessionId: string, lastSeenAt: Date): Promise<void> {
    if (Date.now() - lastSeenAt.getTime() < LAST_SEEN_INTERVAL_MS) return

    await this.db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, sessionId))
  }
}

/** 23505 is Postgres for unique_violation. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}
