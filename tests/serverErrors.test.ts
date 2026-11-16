import { describe, expect, test } from 'bun:test'
import { formatServerError } from '../src/net/wsClient'

describe('server error messages', () => {
  test('explains known errors without exposing protocol codes or raw payloads', () => {
    expect(formatServerError('match_not_found', { message: 'match TEST not found' }))
      .toBe('Lobby not found. Check the code and try again.')
    expect(formatServerError('not_at_stash')).toBe('Move closer to the stash to collect.')
    expect(formatServerError('insufficient_resources')).toBe('Not enough resources to build.')
  })

  test('uses a safe fallback for unrecognized errors', () => {
    expect(formatServerError('unknown_code', { message: 'internal details' }))
      .toBe('Something went wrong. Please try again.')
  })
})
