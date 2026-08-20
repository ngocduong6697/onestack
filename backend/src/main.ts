import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { AutomationWorker } from './automation/worker'
import { enabledLogLevels } from './common/logger'
import { loadEnv } from './config/env'
import { loadEnvFile } from './config/env-file'

async function bootstrap(): Promise<void> {
  // Before the application, so a bad environment fails here and not later.
  loadEnvFile()
  const env = loadEnv()

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: enabledLogLevels(env.LOG_LEVEL),
  })

  /**
   * Express reads `X-Forwarded-For` only as far as this allows. With zero —
   * the default — the header is ignored entirely and the socket address is
   * used, so a direct client cannot lie about where it came from.
   */
  app.set('trust proxy', env.TRUST_PROXY)

  app.use(helmet())
  // The session token arrives as a cookie; nothing reads req.cookies without this.
  app.use(cookieParser())
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true })
  app.enableShutdownHooks()

  /**
   * Started here rather than on module init: every end-to-end test boots the
   * application, and a worker that starts itself would have every suite
   * quietly running background work against the test database.
   */
  app.get(AutomationWorker).start()

  await app.listen(env.API_PORT)

  new Logger('Bootstrap').log(`API listening on :${env.API_PORT} (${env.NODE_ENV})`)
}

bootstrap().catch((error: unknown) => {
  // A stack trace helps nobody when the cause is a missing variable. Print the
  // message the validator wrote and stop.
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
