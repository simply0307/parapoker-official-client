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
  type SeatState,
  type Suit,
} from '../../src/poker-engine'

function c(rank: Rank, suit: Suit): Card {
  return { rank, suit }
}

const safeDeck = [
  c('A', 'hearts'),
  c('2', 'clubs'),
  c('K', 'spades'),
  c('3', 'diamonds'),
  c('4', 'hearts'),
  c('5', 'clubs'),
  c('8', 'spades'),
  c('9', 'diamonds'),
  c('T', 'clubs'),
]

function mustStart(state: GameState): GameState {
  const result = startNextHand(state)
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

function seat(state: GameState, seatId: string): SeatState {
  const found = state.seats.find((candidate) => candidate.id === seatId)
  if (!found) {
    throw new Error(`Missing seat ${seatId}`)
  }
  return found
}

describe('heads-up betting-round contract', () => {
  it('offers correct initial small-blind legal actions with raise-to amounts', () => {
    const state = mustStart(createGame({ fixedDeck: safeDeck }))

    expect(getLegalActions(state, 'human')).toEqual([
      { type: 'fold' },
      { type: 'call', amount: 1 },
      { type: 'raise', min: 4, max: 200 },
      { type: 'allIn', amount: 199, targetContribution: 200 },
    ])
  })

  it('applies raise-to semantics and updates the next minimum full raise', () => {
    let state = mustStart(createGame({ fixedDeck: safeDeck }))

    state = mustApply(state, { type: 'raise', seatId: 'human', amount: 6, source: 'human' })

    expect(seat(state, 'human').stack).toBe(194)
    expect(state.hand?.streetContributions.human).toBe(6)
    expect(state.hand?.currentBet).toBe(6)
    expect(state.hand?.minRaise).toBe(4)
    expect(state.hand?.pendingSeatId).toBe('npc-1')
    expect(getLegalActions(state, 'npc-1')).toEqual([
      { type: 'fold' },
      { type: 'call', amount: 4 },
      { type: 'raise', min: 10, max: 200 },
      { type: 'allIn', amount: 198, targetContribution: 200 },
    ])
  })

  it('rejects raises below the minimum target without changing state', () => {
    const state = mustStart(createGame({ fixedDeck: safeDeck }))
    const before = JSON.stringify(state)
    const result = applyAction(state, { type: 'raise', seatId: 'human', amount: 3, source: 'human' })

    expect(result.ok).toBe(false)
    expect(JSON.stringify(state)).toBe(before)
    if (!result.ok) {
      expect(result.error.reason).toBe('ACTION_NOT_LEGAL')
    }
  })

  it('advances from preflop to flop after the small blind calls and big blind checks', () => {
    let state = mustStart(createGame({ fixedDeck: safeDeck }))

    state = mustApply(state, { type: 'call', seatId: 'human', source: 'human' })
    expect(state.hand?.pendingSeatId).toBe('npc-1')
    state = mustApply(state, { type: 'check', seatId: 'npc-1', source: 'npc' })

    expect(state.hand?.street).toBe('flop')
    expect(state.hand?.communityCards).toHaveLength(3)
    expect(state.hand?.currentBet).toBe(0)
    expect(state.hand?.streetContributions).toEqual({ human: 0, 'npc-1': 0 })
    expect(state.hand?.pendingSeatId).toBe('npc-1')
  })

  it('offers minimum opening bet on postflop streets and advances after bet-call completion', () => {
    let state = advanceToFlop()

    state = mustApply(state, { type: 'check', seatId: 'npc-1', source: 'npc' })
    expect(getLegalActions(state, 'human')).toEqual([
      { type: 'check' },
      { type: 'bet', min: 2, max: 198 },
      { type: 'allIn', amount: 198, targetContribution: 198 },
    ])

    state = mustApply(state, { type: 'bet', seatId: 'human', amount: 8, source: 'human' })
    expect(state.hand?.currentBet).toBe(8)
    expect(state.hand?.minRaise).toBe(2)
    expect(getLegalActions(state, 'npc-1')).toEqual([
      { type: 'fold' },
      { type: 'call', amount: 8 },
      { type: 'raise', min: 10, max: 198 },
      { type: 'allIn', amount: 198, targetContribution: 198 },
    ])

    state = mustApply(state, { type: 'call', seatId: 'npc-1', source: 'npc' })
    expect(state.hand?.street).toBe('turn')
    expect(state.hand?.communityCards).toHaveLength(4)
    expect(state.hand?.currentBet).toBe(0)
    expect(state.hand?.pendingSeatId).toBe('npc-1')
  })

  it('advances streets after check-check completion', () => {
    let state = advanceToFlop()

    state = mustApply(state, { type: 'check', seatId: 'npc-1', source: 'npc' })
    state = mustApply(state, { type: 'check', seatId: 'human', source: 'human' })

    expect(state.hand?.street).toBe('turn')
    expect(state.hand?.communityCards).toHaveLength(4)
    expect(state.hand?.pendingSeatId).toBe('npc-1')
  })

  it('settles uncontested when facing player folds to a bet', () => {
    let state = advanceToFlop()

    state = mustApply(state, { type: 'bet', seatId: 'npc-1', amount: 10, source: 'npc' })
    state = mustApply(state, { type: 'fold', seatId: 'human', source: 'human' })

    expect(state.status).toBe('waitingForHand')
    expect(state.hand?.status).toBe('settled')
    expect(state.hand?.result?.winners).toEqual([{ seatId: 'npc-1', amount: 14 }])
    expect(seat(state, 'npc-1').stack).toBe(202)
    expect(seat(state, 'human').stack).toBe(198)
  })

  it('allows all-in calls for less and automatically runs out when no betting remains', () => {
    const game = createGame({ fixedDeck: safeDeck, startingStack: 20 })
    game.seats.find((candidate) => candidate.id === 'npc-1')!.stack = 5
    let state = mustStart(game)

    state = mustApply(state, { type: 'raise', seatId: 'human', amount: 20, source: 'human' })
    expect(getLegalActions(state, 'npc-1')).toEqual([
      { type: 'fold' },
      { type: 'call', amount: 3 },
      { type: 'allIn', amount: 3, targetContribution: 5 },
    ])

    state = mustApply(state, { type: 'call', seatId: 'npc-1', source: 'npc' })

    expect(state.hand?.status).toBe('settled')
    expect(state.hand?.street).toBe('showdown')
    expect(state.hand?.result?.pots).toEqual([{ amount: 10, eligibleSeatIds: ['human', 'npc-1'] }])
    expect(seat(state, 'human').stack + seat(state, 'npc-1').stack).toBe(25)
  })

  it('runs out when the small blind posts all-in for less than the big blind', () => {
    const game = createGame({ fixedDeck: safeDeck, startingStack: 10 })
    game.seats.find((candidate) => candidate.id === 'human')!.stack = 1
    const state = mustStart(game)

    expect(seat(state, 'human').status).toBe('all-in')
    expect(state.hand?.pendingSeatId).toBeUndefined()
    expect(state.hand?.status).toBe('settled')
    expect(state.hand?.street).toBe('showdown')
    expect(getLegalActions(state, 'human')).toEqual([])
    expect(getLegalActions(state, 'npc-1')).toEqual([])
  })

  it('uses the last full raise increment for subsequent minimum raises', () => {
    let state = mustStart(createGame({ fixedDeck: safeDeck, startingStack: 300 }))

    state = mustApply(state, { type: 'raise', seatId: 'human', amount: 6, source: 'human' })
    state = mustApply(state, { type: 'raise', seatId: 'npc-1', amount: 18, source: 'npc' })

    expect(state.hand?.minRaise).toBe(12)
    expect(getLegalActions(state, 'human')).toEqual([
      { type: 'fold' },
      { type: 'call', amount: 12 },
      { type: 'raise', min: 30, max: 300 },
      { type: 'allIn', amount: 294, targetContribution: 300 },
    ])
  })
})

function advanceToFlop(): GameState {
  let state = mustStart(createGame({ fixedDeck: safeDeck }))
  state = mustApply(state, { type: 'call', seatId: 'human', source: 'human' })
  return mustApply(state, { type: 'check', seatId: 'npc-1', source: 'npc' })
}
