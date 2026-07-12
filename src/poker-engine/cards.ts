import { createRng } from '../shared/rng'
import type { Card, Rank, Suit } from './types'

export const RANKS: Rank[] = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'T',
  'J',
  'Q',
  'K',
  'A',
]

export const SUITS: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades']

export function freshDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })))
}

export function shuffleDeck(deck: Card[], seed: string | number): { deck: Card[]; rngState: number } {
  const rng = createRng(seed)
  const shuffled = deck.map((card) => ({ ...card }))

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng.next() * (index + 1))
    const current = shuffled[index]
    shuffled[index] = shuffled[swapIndex]
    shuffled[swapIndex] = current
  }

  return { deck: shuffled, rngState: rng.state() }
}

export function cardToString(card: Card): string {
  const suitSymbols: Record<Suit, string> = {
    clubs: 'c',
    diamonds: 'd',
    hearts: 'h',
    spades: 's',
  }
  return `${card.rank}${suitSymbols[card.suit]}`
}

export function assertUniqueCards(cards: Card[]): boolean {
  return new Set(cards.map(cardToString)).size === cards.length
}
