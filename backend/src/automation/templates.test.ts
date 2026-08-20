import type { WorkflowStep } from '@onestack/shared'
import { describe, expect, it } from 'vitest'
import { ValidationError } from '../common/errors'
import { assertTemplatesResolvable, referencedSteps, render } from './templates'

const ai = (prompt: string): WorkflowStep => ({
  action: 'ai.complete',
  model: 'claude-opus-5',
  prompt,
  maxTokens: 100,
})

describe('render', () => {
  it('substitutes a prior step field', () => {
    expect(render('Summarise: {{steps.0.text}}', { 0: { text: 'hello' } })).toBe('Summarise: hello')
  })

  it('tolerates whitespace inside the braces', () => {
    expect(render('{{ steps.0.text }}', { 0: { text: 'hi' } })).toBe('hi')
  })

  it('substitutes several references', () => {
    expect(
      render('{{steps.0.text}} then {{steps.1.status}}', {
        0: { text: 'a' },
        1: { status: 200 },
      }),
    ).toBe('a then 200')
  })

  it('serialises a non-string value', () => {
    expect(render('{{steps.0.body}}', { 0: { body: { ok: true } } })).toBe('{"ok":true}')
  })

  it('leaves text with no templates alone', () => {
    expect(render('nothing to see', {})).toBe('nothing to see')
  })

  it('renders a missing value as empty rather than leaving the template', () => {
    expect(render('[{{steps.9.text}}]', {})).toBe('[]')
  })
})

describe('referencedSteps', () => {
  it('finds every reference', () => {
    expect(referencedSteps('{{steps.0.a}} {{steps.2.b}}')).toEqual([0, 2])
  })

  it('finds none in plain text', () => {
    expect(referencedSteps('plain')).toEqual([])
  })
})

describe('assertTemplatesResolvable', () => {
  it('accepts a reference to an earlier step', () => {
    expect(() =>
      assertTemplatesResolvable([ai('first'), ai('about {{steps.0.text}}')]),
    ).not.toThrow()
  })

  it('accepts steps with no templates', () => {
    expect(() => assertTemplatesResolvable([ai('first'), ai('second')])).not.toThrow()
  })

  /** The point of checking at write time rather than at run time. */
  it('refuses a forward reference', () => {
    expect(() => assertTemplatesResolvable([ai('about {{steps.1.text}}'), ai('second')])).toThrow(
      ValidationError,
    )
  })

  it('refuses a step referring to itself', () => {
    expect(() => assertTemplatesResolvable([ai('about {{steps.0.text}}')])).toThrow(
      /does not run before it/,
    )
  })

  it('checks the system prompt too', () => {
    expect(() =>
      assertTemplatesResolvable([
        {
          action: 'ai.complete',
          model: 'claude-opus-5',
          prompt: 'x',
          system: '{{steps.1.text}}',
          maxTokens: 10,
        },
        ai('second'),
      ]),
    ).toThrow(ValidationError)
  })

  it('checks an http step’s url, body and headers', () => {
    const forward = (step: WorkflowStep) => () => assertTemplatesResolvable([step, ai('second')])

    expect(
      forward({ action: 'http.request', method: 'GET', url: 'https://x.test/{{steps.1.text}}' }),
    ).toThrow(ValidationError)
    expect(
      forward({
        action: 'http.request',
        method: 'POST',
        url: 'https://x.test',
        body: '{{steps.1.text}}',
      }),
    ).toThrow(ValidationError)
    expect(
      forward({
        action: 'http.request',
        method: 'GET',
        url: 'https://x.test',
        headers: { 'x-thing': '{{steps.1.text}}' },
      }),
    ).toThrow(ValidationError)
  })
})
