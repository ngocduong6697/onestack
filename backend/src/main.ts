import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { enabledLogLevels } from './common/logger'
import { loadEnv } from './config/env'

async function bootstrap(): Promise<void> {
  // Before the application, so a bad environment fails here and not later.
  const env = loadEnv()

  const app = await NestFactory.create(AppModule, {
    logger: enabledLogLevels(env.LOG_LEVEL),
  })

  app.use(helmet())
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true })
  app.enableShutdownHooks()

  await app.listen(env.API_PORT)

  new Logger('Bootstrap').log(`API listening on :${env.API_PORT} (${env.NODE_ENV})`)
}

bootstrap().catch((error: unknown) => {
  // A stack trace helps nobody when the cause is a missing variable. Print the
  // message the validator wrote and stop.
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
