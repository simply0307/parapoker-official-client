import { describe, expect, it } from 'vitest'
import { assertUniqueCards, freshDeck, shuffleDeck } from '../../src/poker-engine'

describe('deck and shuffle', () => {
  it('creates a unique 52-card deck', () => {
    const deck = freshDeck()

    expect(deck).toHaveLength(52)
    expect(assertUniqueCards(deck)).toBe(true)
  })

  it('shuffles deterministically from a seed', () => {
    const first = shuffleDeck(freshDeck(), 'same-seed')
    const second = shuffleDeck(freshDeck(), 'same-seed')
    const third = shuffleDeck(freshDeck(), 'different-seed')

    expect(first.deck).toEqual(second.deck)
    expect(first.rngState).toBe(second.rngState)
    expect(first.deck).not.toEqual(third.deck)
  })
})
