import { describe, expect, it } from 'vitest'
import { compareHandValues, evaluateBestHand, type Card, type Rank, type Suit } from '../../src/poker-engine'

function c(rank: Rank, suit: Suit): Card {
  return { rank, suit }
}

function values(cards: Card[]) {
  const hand = evaluateBestHand(cards)
  return {
    category: hand.category,
    name: hand.name,
    tiebreakers: hand.tiebreakers,
  }
}

describe('hand evaluator regression matrix', () => {
  it.each([
    {
      name: 'high card',
      cards: [
        c('A', 'spades'),
        c('K', 'diamonds'),
        c('9', 'clubs'),
        c('7', 'hearts'),
        c('4', 'clubs'),
        c('3', 'diamonds'),
        c('2', 'hearts'),
      ],
      expected: { category: 0, name: 'High card', tiebreakers: [14, 13, 9, 7, 4] },
    },
    {
      name: 'one pair',
      cards: [
        c('A', 'spades'),
        c('A', 'diamonds'),
        c('K', 'clubs'),
        c('9', 'hearts'),
        c('7', 'clubs'),
        c('4', 'diamonds'),
        c('2', 'hearts'),
      ],
      expected: { category: 1, name: 'One pair', tiebreakers: [14, 13, 9, 7] },
    },
    {
      name: 'two pair',
      cards: [
        c('A', 'spades'),
        c('A', 'diamonds'),
        c('K', 'clubs'),
        c('K', 'hearts'),
        c('9', 'clubs'),
        c('7', 'diamonds'),
        c('2', 'hearts'),
      ],
      expected: { category: 2, name: 'Two pair', tiebreakers: [14, 13, 9] },
    },
    {
      name: 'trips',
      cards: [
        c('Q', 'spades'),
        c('Q', 'diamonds'),
        c('Q', 'clubs'),
        c('A', 'hearts'),
        c('9', 'clubs'),
        c('7', 'diamonds'),
        c('2', 'hearts'),
      ],
      expected: { category: 3, name: 'Three of a kind', tiebreakers: [12, 14, 9] },
    },
    {
      name: 'straight',
      cards: [
        c('9', 'spades'),
        c('8', 'diamonds'),
        c('7', 'clubs'),
        c('6', 'hearts'),
        c('5', 'clubs'),
        c('A', 'diamonds'),
        c('2', 'hearts'),
      ],
      expected: { category: 4, name: 'Straight', tiebreakers: [9] },
    },
    {
      name: 'wheel straight',
      cards: [
        c('A', 'spades'),
        c('5', 'diamonds'),
        c('4', 'clubs'),
        c('3', 'hearts'),
        c('2', 'clubs'),
        c('K', 'diamonds'),
        c('9', 'hearts'),
      ],
      expected: { category: 4, name: 'Straight', tiebreakers: [5] },
    },
    {
      name: 'flush',
      cards: [
        c('A', 'hearts'),
        c('J', 'hearts'),
        c('9', 'hearts'),
        c('6', 'hearts'),
        c('3', 'hearts'),
        c('K', 'diamonds'),
        c('2', 'clubs'),
      ],
      expected: { category: 5, name: 'Flush', tiebreakers: [14, 11, 9, 6, 3] },
    },
    {
      name: 'full house',
      cards: [
        c('T', 'spades'),
        c('T', 'diamonds'),
        c('T', 'clubs'),
        c('7', 'hearts'),
        c('7', 'clubs'),
        c('A', 'diamonds'),
        c('2', 'hearts'),
      ],
      expected: { category: 6, name: 'Full house', tiebreakers: [10, 7] },
    },
    {
      name: 'quads',
      cards: [
        c('9', 'spades'),
        c('9', 'diamonds'),
        c('9', 'clubs'),
        c('9', 'hearts'),
        c('A', 'clubs'),
        c('K', 'diamonds'),
        c('2', 'hearts'),
      ],
      expected: { category: 7, name: 'Four of a kind', tiebreakers: [9, 14] },
    },
    {
      name: 'straight flush',
      cards: [
        c('K', 'spades'),
        c('Q', 'spades'),
        c('J', 'spades'),
        c('T', 'spades'),
        c('9', 'spades'),
        c('A', 'diamonds'),
        c('2', 'hearts'),
      ],
      expected: { category: 8, name: 'Straight flush', tiebreakers: [13] },
    },
    {
      name: 'wheel straight flush',
      cards: [
        c('A', 'clubs'),
        c('5', 'clubs'),
        c('4', 'clubs'),
        c('3', 'clubs'),
        c('2', 'clubs'),
        c('K', 'diamonds'),
        c('9', 'hearts'),
      ],
      expected: { category: 8, name: 'Straight flush', tiebreakers: [5] },
    },
  ])('evaluates $name', ({ cards, expected }) => {
    expect(values(cards)).toEqual(expected)
  })

  it('compares pair kickers', () => {
    const acePairKing = evaluateBestHand([
      c('A', 'spades'),
      c('A', 'diamonds'),
      c('K', 'clubs'),
      c('9', 'hearts'),
      c('7', 'clubs'),
      c('4', 'diamonds'),
      c('2', 'hearts'),
    ])
    const acePairQueen = evaluateBestHand([
      c('A', 'clubs'),
      c('A', 'hearts'),
      c('Q', 'spades'),
      c('9', 'diamonds'),
      c('7', 'diamonds'),
      c('4', 'clubs'),
      c('2', 'clubs'),
    ])

    expect(compareHandValues(acePairKing, acePairQueen)).toBeGreaterThan(0)
  })

  it('recognizes exact ties', () => {
    const first = evaluateBestHand([
      c('A', 'spades'),
      c('K', 'diamonds'),
      c('Q', 'clubs'),
      c('J', 'hearts'),
      c('9', 'clubs'),
      c('4', 'diamonds'),
      c('2', 'hearts'),
    ])
    const second = evaluateBestHand([
      c('A', 'hearts'),
      c('K', 'clubs'),
      c('Q', 'diamonds'),
      c('J', 'spades'),
      c('9', 'diamonds'),
      c('5', 'clubs'),
      c('3', 'clubs'),
    ])

    expect(compareHandValues(first, second)).toBe(0)
  })

  it('plays the board when hole cards do not improve it', () => {
    const result = values([
      c('A', 'spades'),
      c('K', 'diamonds'),
      c('Q', 'clubs'),
      c('J', 'hearts'),
      c('T', 'clubs'),
      c('4', 'diamonds'),
      c('2', 'hearts'),
    ])

    expect(result).toEqual({ category: 4, name: 'Straight', tiebreakers: [14] })
  })

  it('uses the highest two pair on a double-paired board', () => {
    const result = values([
      c('A', 'spades'),
      c('A', 'diamonds'),
      c('K', 'clubs'),
      c('K', 'hearts'),
      c('Q', 'clubs'),
      c('Q', 'diamonds'),
      c('2', 'hearts'),
    ])

    expect(result).toEqual({ category: 2, name: 'Two pair', tiebreakers: [14, 13, 12] })
  })

  it('chooses the best of two possible full houses', () => {
    const result = values([
      c('A', 'spades'),
      c('A', 'diamonds'),
      c('A', 'clubs'),
      c('K', 'hearts'),
      c('K', 'clubs'),
      c('K', 'diamonds'),
      c('2', 'hearts'),
    ])

    expect(result).toEqual({ category: 6, name: 'Full house', tiebreakers: [14, 13] })
  })

  it('chooses the highest trips when two trips are available', () => {
    const result = values([
      c('Q', 'spades'),
      c('Q', 'diamonds'),
      c('Q', 'clubs'),
      c('9', 'hearts'),
      c('9', 'clubs'),
      c('9', 'diamonds'),
      c('A', 'hearts'),
    ])

    expect(result).toEqual({ category: 6, name: 'Full house', tiebreakers: [12, 9] })
  })

  it('selects the best five suited cards from six or seven suited cards', () => {
    const result = values([
      c('A', 'hearts'),
      c('K', 'hearts'),
      c('J', 'hearts'),
      c('9', 'hearts'),
      c('6', 'hearts'),
      c('4', 'hearts'),
      c('2', 'hearts'),
    ])

    expect(result).toEqual({ category: 5, name: 'Flush', tiebreakers: [14, 13, 11, 9, 6] })
  })

  it('selects the highest available straight', () => {
    const result = values([
      c('A', 'spades'),
      c('K', 'diamonds'),
      c('Q', 'clubs'),
      c('J', 'hearts'),
      c('T', 'clubs'),
      c('9', 'diamonds'),
      c('8', 'hearts'),
    ])

    expect(result).toEqual({ category: 4, name: 'Straight', tiebreakers: [14] })
  })

  it('compares quads by kicker after matching quad rank', () => {
    const quadAceKicker = evaluateBestHand([
      c('9', 'spades'),
      c('9', 'diamonds'),
      c('9', 'clubs'),
      c('9', 'hearts'),
      c('A', 'clubs'),
      c('4', 'diamonds'),
      c('2', 'hearts'),
    ])
    const quadKingKicker = evaluateBestHand([
      c('9', 'spades'),
      c('9', 'diamonds'),
      c('9', 'clubs'),
      c('9', 'hearts'),
      c('K', 'clubs'),
      c('4', 'diamonds'),
      c('2', 'hearts'),
    ])

    expect(compareHandValues(quadAceKicker, quadKingKicker)).toBeGreaterThan(0)
  })

  it('ties when both players use only the board', () => {
    const boardOnlyRoyal = evaluateBestHand([
      c('A', 'spades'),
      c('K', 'spades'),
      c('Q', 'spades'),
      c('J', 'spades'),
      c('T', 'spades'),
      c('4', 'diamonds'),
      c('2', 'hearts'),
    ])
    const sameBoardOtherHoles = evaluateBestHand([
      c('A', 'spades'),
      c('K', 'spades'),
      c('Q', 'spades'),
      c('J', 'spades'),
      c('T', 'spades'),
      c('7', 'clubs'),
      c('3', 'diamonds'),
    ])

    expect(compareHandValues(boardOnlyRoyal, sameBoardOtherHoles)).toBe(0)
  })

  it('finds non-obvious seven-card best five over the visually obvious straight', () => {
    const result = values([
      c('A', 'hearts'),
      c('K', 'hearts'),
      c('9', 'hearts'),
      c('8', 'hearts'),
      c('7', 'hearts'),
      c('6', 'clubs'),
      c('5', 'diamonds'),
    ])

    expect(result).toEqual({ category: 5, name: 'Flush', tiebreakers: [14, 13, 9, 8, 7] })
  })
})
