import { describe, expect, it } from 'vitest'
import {
  applyAction,
  createGame,
  getLegalActions,
  getPublicView,
  getSeatView,
  startNextHand,
  type Card,
  type EngineCommand,
  type GameState,
  type HandState,
  type Rank,
  type SeatState,
  type Suit,
} from '../../src/poker-engine'

function c(rank: Rank, suit: Suit): Card {
  return { rank, suit }
}

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

const showdownDeck = [
  c('A', 'hearts'),
  c('2', 'clubs'),
  c('K', 'spades'),
  c('2', 'diamonds'),
  c('3', 'hearts'),
  c('4', 'clubs'),
  c('8', 'spades'),
  c('9', 'diamonds'),
  c('T', 'clubs'),
]

describe('poker engine hardening regressions', () => {
  it('returns uncalled excess in unequal-stack all-ins and awards only matched contributions', () => {
    const game = createGame({ fixedDeck: showdownDeck, startingStack: 200 })
    game.seats.find((seat) => seat.id === 'npc-1')!.stack = 50
    let state = mustStart(game)

    state = mustApply(state, { type: 'allIn', seatId: 'human', source: 'human' })
    state = mustApply(state, { type: 'call', seatId: 'npc-1', source: 'npc' })

    expect(state.status).toBe('waitingForHand')
    expect(state.hand?.result?.pots).toEqual([{ amount: 100, eligibleSeatIds: ['human', 'npc-1'] }])
    expect(state.hand?.result?.winners).toEqual([
      expect.objectContaining({ seatId: 'npc-1', amount: 100 }),
    ])
    expect(state.seats.find((seat) => seat.id === 'human')?.stack).toBe(150)
    expect(state.seats.find((seat) => seat.id === 'npc-1')?.stack).toBe(100)
    expect(totalStacks(state)).toBe(250)
  })

  it('updates the call amount for short all-ins without reopening raises for prior actors', () => {
    let state = customBettingState({
      currentBet: 10,
      minRaise: 10,
      actedThisRound: ['human', 'npc-1'],
      pendingSeatId: 'npc-2',
      stacks: { human: 90, 'npc-1': 90, 'npc-2': 15 },
      streetContributions: { human: 10, 'npc-1': 10, 'npc-2': 0 },
    })

    state = mustApply(state, { type: 'allIn', seatId: 'npc-2', source: 'npc' })

    expect(state.hand?.currentBet).toBe(15)
    expect(state.hand?.pendingSeatId).toBe('human')
    expect(getLegalActions(state, 'human')).toEqual([
      { type: 'fold' },
      { type: 'call', amount: 5 },
    ])

    state = mustApply(state, { type: 'call', seatId: 'human', source: 'human' })

    expect(state.hand?.pendingSeatId).toBe('npc-1')
    expect(getLegalActions(state, 'npc-1')).toEqual([
      { type: 'fold' },
      { type: 'call', amount: 5 },
    ])
  })

  it('reopens raising after a full raise all-in', () => {
    const state = mustApply(
      customBettingState({
        currentBet: 10,
        minRaise: 10,
        actedThisRound: ['human', 'npc-1'],
        pendingSeatId: 'npc-2',
        stacks: { human: 90, 'npc-1': 90, 'npc-2': 30 },
        streetContributions: { human: 10, 'npc-1': 10, 'npc-2': 0 },
      }),
      { type: 'allIn', seatId: 'npc-2', source: 'npc' },
    )

    expect(state.hand?.currentBet).toBe(30)
    expect(getLegalActions(state, 'human').some((action) => action.type === 'raise')).toBe(true)
  })

  it('does not leave a blind all-in player pending and auto-runs out when nobody can act', () => {
    const state = mustStart(createGame({ fixedDeck: showdownDeck, startingStack: 1 }))

    expect(state.hand?.pendingSeatId).not.toBe('human')
    expect(state.hand?.pendingSeatId).not.toBe('npc-1')
    expect(state.hand?.status).toBe('settled')
    expect(state.status).toBe('complete')
    expect(totalStacks(state)).toBe(2)
  })

  it('returns immutable public and private projections without hidden information', () => {
    const state = mustStart(createGame({ seed: 'immutable-projections' }))
    const before = JSON.stringify(state)
    const publicView = getPublicView(state)
    const seatView = getSeatView(state, 'human')
    const npcCards = state.seats.find((seat) => seat.id === 'npc-1')!.holeCards

    publicView.communityCards.push(c('A', 'spades'))
    publicView.seats[0].stack = 999
    publicView.events[0].type = 'matchComplete'
    seatView.holeCards[0] = c('2', 'clubs')
    seatView.legalActions.push({ type: 'check' })

    expect(JSON.stringify(state)).toBe(before)
    expect(JSON.stringify(publicView)).not.toContain('deck')
    expect(JSON.stringify(publicView)).not.toContain('rngState')
    for (const card of npcCards) {
      expect(JSON.stringify(seatView)).not.toContain(JSON.stringify(card))
    }
  })

  it('rejects fixed decks with duplicate cards as structured engine errors', () => {
    const result = startNextHand(
      createGame({
        fixedDeck: [
          c('A', 'spades'),
          c('A', 'spades'),
          c('K', 'clubs'),
          c('Q', 'diamonds'),
          c('J', 'hearts'),
          c('T', 'clubs'),
          c('9', 'spades'),
          c('8', 'diamonds'),
          c('7', 'clubs'),
        ],
      }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe('INVARIANT_VIOLATION')
      expect(result.error.message).toContain('duplicate')
    }
  })

  it('rejects fixed decks with insufficient cards as structured engine errors', () => {
    const result = startNextHand(createGame({ fixedDeck: [c('A', 'spades'), c('K', 'clubs')] }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toBe('INVARIANT_VIOLATION')
      expect(result.error.message).toContain('at least')
    }
  })
})

function totalStacks(state: GameState): number {
  return state.seats.reduce((sum, seat) => sum + seat.stack, 0)
}

function customBettingState({
  currentBet,
  minRaise,
  actedThisRound,
  pendingSeatId,
  stacks,
  streetContributions,
}: {
  currentBet: number
  minRaise: number
  actedThisRound: string[]
  pendingSeatId: string
  stacks: Record<string, number>
  streetContributions: Record<string, number>
}): GameState {
  const seats: SeatState[] = ['human', 'npc-1', 'npc-2'].map((id) => ({
    id,
    name: id,
    kind: id === 'human' ? 'human' : 'npc',
    stack: stacks[id],
    status: 'active',
    holeCards: [],
  }))
  const hand: HandState = {
    id: 1,
    dealerSeatId: 'human',
    smallBlindSeatId: 'human',
    bigBlindSeatId: 'npc-1',
    street: 'flop',
    deck: [],
    communityCards: [],
    currentBet,
    minRaise,
    actedThisRound,
    streetContributions,
    totalContributions: { ...streetContributions },
    pendingSeatId,
    status: 'active',
    history: [{ type: 'handStarted', handId: 1, dealerSeatId: 'human', visibility: 'public' }],
  }

  return {
    config: {
      startingStack: 100,
      smallBlind: 1,
      bigBlind: 2,
      seed: 'custom',
      seats: seats.map(({ id, name, kind }) => ({ id, name, kind })),
    },
    seats,
    status: 'handInProgress',
    handNumber: 1,
    rngState: 1,
    dealerSeatId: 'human',
    hand,
  }
}
