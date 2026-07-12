import type { Card } from './types'

export interface HandValue {
  category: number
  tiebreakers: number[]
  name: string
  cards: Card[]
}

const RANK_VALUES: Record<Card['rank'], number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
}

const HAND_NAMES = [
  'High card',
  'One pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
]

export function rankValue(card: Card): number {
  return RANK_VALUES[card.rank]
}

export function compareHandValues(left: HandValue, right: HandValue): number {
  if (left.category !== right.category) {
    return left.category - right.category
  }

  const length = Math.max(left.tiebreakers.length, right.tiebreakers.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (left.tiebreakers[index] ?? 0) - (right.tiebreakers[index] ?? 0)
    if (difference !== 0) {
      return difference
    }
  }
  return 0
}

export function evaluateBestHand(cards: Card[]): HandValue {
  if (cards.length < 5) {
    throw new Error('At least five cards are required to evaluate a poker hand.')
  }

  const combinations = fiveCardCombinations(cards)
  let best = evaluateFive(combinations[0])

  for (const combination of combinations.slice(1)) {
    const candidate = evaluateFive(combination)
    if (compareHandValues(candidate, best) > 0) {
      best = candidate
    }
  }

  return best
}

function fiveCardCombinations(cards: Card[]): Card[][] {
  const results: Card[][] = []
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            results.push([cards[a], cards[b], cards[c], cards[d], cards[e]])
          }
        }
      }
    }
  }
  return results
}

function evaluateFive(cards: Card[]): HandValue {
  const ranks = cards.map(rankValue).sort((left, right) => right - left)
  const flush = cards.every((card) => card.suit === cards[0].suit)
  const straightHigh = getStraightHigh(ranks)
  const rankCounts = countRanks(ranks)
  const groups = Array.from(rankCounts.entries()).sort((left, right) => {
    const countDifference = right[1] - left[1]
    return countDifference === 0 ? right[0] - left[0] : countDifference
  })

  if (flush && straightHigh > 0) {
    return value(8, [straightHigh], cards)
  }

  if (groups[0][1] === 4) {
    return value(7, [groups[0][0], groups[1][0]], cards)
  }

  if (groups[0][1] === 3 && groups[1]?.[1] === 2) {
    return value(6, [groups[0][0], groups[1][0]], cards)
  }

  if (flush) {
    return value(5, ranks, cards)
  }

  if (straightHigh > 0) {
    return value(4, [straightHigh], cards)
  }

  if (groups[0][1] === 3) {
    const kickers = groups.filter((group) => group[1] === 1).map((group) => group[0])
    return value(3, [groups[0][0], ...kickers], cards)
  }

  if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    const pairs = groups.filter((group) => group[1] === 2).map((group) => group[0])
    const kicker = groups.find((group) => group[1] === 1)?.[0] ?? 0
    return value(2, [...pairs, kicker], cards)
  }

  if (groups[0][1] === 2) {
    const kickers = groups.filter((group) => group[1] === 1).map((group) => group[0])
    return value(1, [groups[0][0], ...kickers], cards)
  }

  return value(0, ranks, cards)
}

function value(category: number, tiebreakers: number[], cards: Card[]): HandValue {
  return {
    category,
    tiebreakers,
    name: HAND_NAMES[category],
    cards,
  }
}

function countRanks(ranks: number[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const rank of ranks) {
    counts.set(rank, (counts.get(rank) ?? 0) + 1)
  }
  return counts
}

function getStraightHigh(ranks: number[]): number {
  const unique = Array.from(new Set(ranks)).sort((left, right) => right - left)
  if (unique.includes(14)) {
    unique.push(1)
  }

  for (let index = 0; index <= unique.length - 5; index += 1) {
    const window = unique.slice(index, index + 5)
    if (window.every((rank, offset) => rank === window[0] - offset)) {
      return window[0]
    }
  }
  return 0
}
