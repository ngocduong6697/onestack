import { describe, expect, it } from 'vitest'
import { enabledLogLevels } from './logger'

/**
 * Nest takes a list of levels to enable rather than a threshold, and this
 * translation had no test at all — coverage reported the file at zero.
 */
describe('enabledLogLevels', () => {
  it('enables everything at debug', () => {
    expect(enabledLogLevels('debug')).toEqual(['debug', 'verbose', 'log', 'warn', 'error'])
  })

  it('drops debug and verbose at info', () => {
    expect(enabledLogLevels('info')).toEqual(['log', 'warn', 'error'])
  })

  it('keeps only warnings and errors at warn', () => {
    expect(enabledLogLevels('warn')).toEqual(['warn', 'error'])
  })

  it('keeps only errors at error', () => {
    expect(enabledLogLevels('error')).toEqual(['error'])
  })

  /** Whatever the level, an error is never silenced. */
  it.each(['debug', 'info', 'warn', 'error'] as const)('always includes error at %s', (level) => {
    expect(enabledLogLevels(level)).toContain('error')
  })

  it('narrows monotonically as the level rises', () => {
    const widths = (['debug', 'info', 'warn', 'error'] as const).map(
      (level) => enabledLogLevels(level).length,
    )

    expect(widths).toEqual([...widths].sort((a, b) => b - a))
  })
})
