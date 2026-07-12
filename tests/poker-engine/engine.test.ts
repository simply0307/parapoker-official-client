import { describe, expect, it } from 'vitest'
import {
  applyAction,
  assertSerializableState,
  cardToString,
  createGame,
  getLegalActions,
  getPublicView,
  getSeatView,
  replayCommands,
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

describe('poker engine', () => {
  it('starts a heads-up hand with correct blinds and action order', () => {
    const state = mustStart(createGame({ seed: 'heads-up' }))

    expect(state.status).toBe('handInProgress')
    expect(state.hand?.dealerSeatId).toBe('human')
    expect(state.hand?.smallBlindSeatId).toBe('human')
    expect(state.hand?.bigBlindSeatId).toBe('npc-1')
    expect(state.hand?.pendingSeatId).toBe('human')
    expect(state.seats.find((seat) => seat.id === 'human')?.stack).toBe(199)
    expect(state.seats.find((seat) => seat.id === 'npc-1')?.stack).toBe(198)
    expect(getLegalActions(state, 'human').map((action) => action.type)).toContain('call')
  })

  it('keeps deck order and opponent hole cards out of projections', () => {
    const state = mustStart(createGame({ seed: 'visibility' }))
    const publicView = getPublicView(state)
    const humanView = getSeatView(state, 'human')
    const npcCards = state.seats.find((seat) => seat.id === 'npc-1')?.holeCards.map(cardToString) ?? []
    const publicJson = JSON.stringify(publicView)
    const humanJson = JSON.stringify(humanView)

    expect(publicJson).not.toContain('deck')
    expect(publicJson).not.toContain('rngState')
    expect(humanJson).not.toContain('deck')
    expect(humanJson).not.toContain('rngState')
    for (const card of npcCards) {
      expect(humanJson).not.toContain(card)
    }
    expect(humanView.holeCards).toHaveLength(2)
  })

  it('rejects illegal actions without changing state', () => {
    const state = mustStart(createGame({ seed: 'illegal' }))
    const before = JSON.stringify(state)
    const result = applyAction(state, { type: 'check', seatId: 'npc-1', source: 'npc' })

    expect(result.ok).toBe(false)
    expect(result.state).toBe(state)
    expect(JSON.stringify(state)).toBe(before)
    if (!result.ok) {
      expect(result.error.reason).toBe('NOT_PENDING_ACTOR')
    }
  })

  it('awards an uncontested pot and conserves chips', () => {
    const state = mustStart(createGame({ seed: 'fold-pot' }))
    const folded = mustApply(state, { type: 'fold', seatId: 'human', source: 'human' })

    expect(folded.status).toBe('waitingForHand')
    expect(folded.seats.map((seat) => seat.stack).reduce((sum, stack) => sum + stack, 0)).toBe(400)
    expect(folded.seats.find((seat) => seat.id === 'npc-1')?.stack).toBe(201)
    expect(folded.hand?.result?.winners[0].seatId).toBe('npc-1')
    expect(assertSerializableState(folded)).toBe(true)
  })

  it('plays to showdown deterministically and awards the best hand', () => {
    const fixedDeck = [
      c('A', 'hearts'),
      c('K', 'hearts'),
      c('A', 'spades'),
      c('K', 'spades'),
      c('2', 'clubs'),
      c('3', 'diamonds'),
      c('4', 'hearts'),
      c('8', 'spades'),
      c('9', 'clubs'),
    ]
    let state = mustStart(createGame({ fixedDeck }))

    state = mustApply(state, { type: 'call', seatId: 'human', source: 'human' })
    state = mustApply(state, { type: 'check', seatId: 'npc-1', source: 'npc' })
    state = mustApply(state, { type: 'check', seatId: 'npc-1', source: 'npc' })
    state = mustApply(state, { type: 'check', seatId: 'human', source: 'human' })
    state = mustApply(state, { type: 'check', seatId: 'npc-1', source: 'npc' })
    state = mustApply(state, { type: 'check', seatId: 'human', source: 'human' })
    state = mustApply(state, { type: 'check', seatId: 'npc-1', source: 'npc' })
    state = mustApply(state, { type: 'check', seatId: 'human', source: 'human' })

    expect(state.status).toBe('waitingForHand')
    expect(state.hand?.street).toBe('showdown')
    expect(state.hand?.result?.winners[0].seatId).toBe('human')
    expect(state.seats.find((seat) => seat.id === 'human')?.stack).toBe(202)
    expect(state.seats.find((seat) => seat.id === 'npc-1')?.stack).toBe(198)
  })

  it('replays command sequences through the same action gateway', () => {
    const state = mustStart(createGame({ seed: 'replay' }))
    const result = replayCommands(state, [{ type: 'fold', seatId: 'human', source: 'human' }])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.hand?.status).toBe('settled')
      expect(result.events.some((event) => event.type === 'actionApplied')).toBe(true)
    }
  })
})
