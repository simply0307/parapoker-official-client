import { describe, expect, it } from 'vitest'
import {
  applyAction,
  createGame,
  getLegalActions,
  startNextHand,
  type Card,
  type EngineCommand,
  type GameState,
  type Rank,
  type Suit,
} from '../../src/poker-engine'

function c(rank: Rank, suit: Suit): Card {
  return { rank, suit }
}

const seats = [
  { id: 'human', name: 'You', kind: 'human' as const },
  { id: 'npc-1', name: 'ParaBot A', kind: 'npc' as const },
  { id: 'npc-2', name: 'ParaBot B', kind: 'npc' as const },
]

const threeHandedDeck = [
  c('A', 'spades'),
  c('K', 'spades'),
  c('Q', 'spades'),
  c('A', 'hearts'),
  c('K', 'hearts'),
  c('Q', 'hearts'),
  c('2', 'clubs'),
  c('7', 'diamonds'),
  c('8', 'hearts'),
  c('9', 'clubs'),
  c('T', 'diamonds'),
]

function mustStart(config: Parameters<typeof createGame>[0] = {}): GameState {
  const result = startNextHand(createGame({ seats, fixedDeck: threeHandedDeck, ...config }))
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.state
}

function mustApply(state: GameState, command: EngineCommand): GameState {
  const result = applyAction(state, command)
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.state
}

describe('three-handed rules design gate', () => {
  it.fails('assigns dealer, blinds, and UTG without heads-up button-as-small-blind assumptions', () => {
    const state = mustStart()

    expect(state.hand?.dealerSeatId).toBe('human')
    expect(state.hand?.smallBlindSeatId).toBe('npc-1')
    expect(state.hand?.bigBlindSeatId).toBe('npc-2')
    expect(state.hand?.pendingSeatId).toBe('human')
    expect(state.seats.find((seat) => seat.id === 'human')?.stack).toBe(200)
    expect(state.seats.find((seat) => seat.id === 'npc-1')?.stack).toBe(199)
    expect(state.seats.find((seat) => seat.id === 'npc-2')?.stack).toBe(198)
    expect(getLegalActions(state, 'human')).toEqual([
      { type: 'fold' },
      { type: 'call', amount: 2 },
      { type: 'raise', min: 4, max: 200 },
      { type: 'allIn', amount: 200, targetContribution: 200 },
    ])
  })

  it.fails('uses UTG, small blind, big blind preflop order and first active seat after button postflop', () => {
    let state = mustStart()

    state = mustApply(state, { type: 'call', seatId: 'human', source: 'human' })
    expect(state.hand?.pendingSeatId).toBe('npc-1')
    state = mustApply(state, { type: 'call', seatId: 'npc-1', source: 'npc' })
    expect(state.hand?.pendingSeatId).toBe('npc-2')
    state = mustApply(state, { type: 'check', seatId: 'npc-2', source: 'npc' })

    expect(state.hand?.street).toBe('flop')
    expect(state.hand?.communityCards).toHaveLength(3)
    expect(state.hand?.pendingSeatId).toBe('npc-1')
  })

  it.fails('keeps folded-player contributions in multiway pots while excluding folded players from eligibility', () => {
    let state = mustStart({
      startingStack: 60,
      fixedDeck: [
        c('A', 'spades'),
        c('K', 'spades'),
        c('Q', 'clubs'),
        c('A', 'hearts'),
        c('K', 'hearts'),
        c('Q', 'diamonds'),
        c('2', 'clubs'),
        c('7', 'diamonds'),
        c('8', 'hearts'),
        c('9', 'clubs'),
        c('T', 'diamonds'),
      ],
    })

    state = mustApply(state, { type: 'raise', seatId: 'human', amount: 10, source: 'human' })
    state = mustApply(state, { type: 'call', seatId: 'npc-1', source: 'npc' })
    state = mustApply(state, { type: 'call', seatId: 'npc-2', source: 'npc' })
    state = mustApply(state, { type: 'bet', seatId: 'npc-1', amount: 20, source: 'npc' })
    state = mustApply(state, { type: 'fold', seatId: 'npc-2', source: 'npc' })
    state = mustApply(state, { type: 'call', seatId: 'human', source: 'human' })

    while (state.status === 'handInProgress') {
      const pendingSeatId = state.hand?.pendingSeatId
      if (!pendingSeatId) {
        break
      }
      state = mustApply(state, { type: 'check', seatId: pendingSeatId, source: pendingSeatId === 'human' ? 'human' : 'npc' })
    }

    expect(state.hand?.result?.pots).toEqual([
      { amount: 30, eligibleSeatIds: ['human', 'npc-1', 'npc-2'] },
      { amount: 40, eligibleSeatIds: ['human', 'npc-1'] },
    ])
  })
})
