import type { LogLevel as NestLogLevel } from '@nestjs/common'
import type { LogLevel } from '@onestack/shared'

/**
 * Nest takes a list of levels to enable, not a threshold. Translate one into
 * the other so LOG_LEVEL behaves the way every other tool makes people expect.
 */
const LEVELS: Record<LogLevel, NestLogLevel[]> = {
  debug: ['debug', 'verbose', 'log', 'warn', 'error'],
  info: ['log', 'warn', 'error'],
  warn: ['warn', 'error'],
  error: ['error'],
}

export function enabledLogLevels(level: LogLevel): NestLogLevel[] {
  return LEVELS[level]
}
