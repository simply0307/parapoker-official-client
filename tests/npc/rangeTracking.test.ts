import { describe, expect, it } from 'vitest'
import {
  deriveNpcRangeState,
  updateNpcRangeMemory,
} from '../../src/npc/rangeTracking'
import {
  applyAction,
  createGame,
  getSeatView,
  startNextHand,
  type Card,
  type EngineCommand,
  type GameState,
  type Rank,
  type Suit,
} from '../../src/poker-engine'

const deck = [
  c('A', 'spades'),
  c('K', 'clubs'),
  c('A', 'hearts'),
  c('Q', 'clubs'),
  c('9', 'clubs'),
  c('T', 'diamonds'),
  c('J', 'clubs'),
  c('2', 'spades'),
  c('3', 'hearts'),
]

describe('NPC postflop range tracking', () => {
  it('derives a seat-private range state without opponent cards or canonical secrets', () => {
    const state = mustStart()
    const view = getSeatView(state, 'npc-1')
    const ranges = deriveNpcRangeState(view)

    expect(ranges).toEqual(expect.objectContaining({
      schemaVersion: 'npc-range-state-v1',
      handNumber: 1,
      street: 'preflop',
      heroSeatId: 'npc-1',
    }))
    expect(ranges.seats['npc-1'].knownHandClass).toBe('KQs')
    expect(ranges.seats.human.knownHandClass).toBeUndefined()
    expect(JSON.stringify(ranges)).not.toMatch(/holeCards|deck|rngState|"rank"|"suit"/)
  })

  it('narrows an observed range after aggression while retaining mixed bluffs', () => {
    const initial = mustStart()
    const before = deriveNpcRangeState(getSeatView(initial, 'npc-1'))
    const raised = act(initial, { type: 'raise', seatId: 'human', amount: 4, source: 'human' })
    const after = deriveNpcRangeState(getSeatView(raised, 'npc-1'))

    expect(after.seats.human.rangeWidth).toBeLessThan(before.seats.human.rangeWidth)
    expect(after.seats.human.initiative).toBe(true)
    expect(after.seats.human.lastAction).toBe('raise')
    expect(after.seats.human.weights.weak).toBeGreaterThan(0)
    expect(bucketTotal(after.seats.human.weights)).toBeCloseTo(1, 8)
  })

  it('updates postflop beliefs from board texture and public betting actions', () => {
    let state = mustStart()
    state = act(state, { type: 'call', seatId: 'human', source: 'human' })
    state = act(state, { type: 'check', seatId: 'npc-1', source: 'npc' })
    const beforeBet = deriveNpcRangeState(getSeatView(state, 'npc-1'))
    state = act(state, { type: 'check', seatId: 'npc-1', source: 'npc' })
    state = act(state, { type: 'bet', seatId: 'human', amount: 4, source: 'human' })
    const afterBet = deriveNpcRangeState(getSeatView(state, 'npc-1'))

    expect(beforeBet.street).toBe('flop')
    expect(afterBet.boardTexture).toBe('dynamic')
    expect(afterBet.seats.human.lastAction).toBe('bet')
    expect(afterBet.seats.human.lastAggressiveStreet).toBe('flop')
    expect(afterBet.seats.human.weights.strong).toBeGreaterThan(beforeBet.seats.human.weights.strong)
    expect(afterBet.seats.human.weights.draw).toBeGreaterThan(0)
  })

  it('reconstructs deterministically and exposes deeply read-only controller memory', () => {
    let state = mustStart()
    state = act(state, { type: 'raise', seatId: 'human', amount: 4, source: 'human' })
    const view = getSeatView(state, 'npc-1')
    const first = deriveNpcRangeState(view)
    const replay = deriveNpcRangeState(view)
    const memory = updateNpcRangeMemory({ handsObserved: 7 }, view)

    expect(first).toEqual(replay)
    expect(memory.handsObserved).toBe(7)
    expect(memory.rangeState).toEqual(first)
    expect(Object.isFrozen(memory)).toBe(true)
    expect(Object.isFrozen(memory.rangeState)).toBe(true)
    expect(Object.isFrozen(memory.rangeState?.seats.human.weights)).toBe(true)
  })

  it('builds independent private perspectives for different NPC seats', () => {
    const state = mustStart()
    const humanPerspective = deriveNpcRangeState(getSeatView(state, 'human'))
    const npcPerspective = deriveNpcRangeState(getSeatView(state, 'npc-1'))

    expect(humanPerspective.seats.human.knownHandClass).toBe('AA')
    expect(humanPerspective.seats['npc-1'].knownHandClass).toBeUndefined()
    expect(npcPerspective.seats['npc-1'].knownHandClass).toBe('KQs')
    expect(npcPerspective.seats.human.knownHandClass).toBeUndefined()
    expect(humanPerspective).not.toBe(npcPerspective)
  })
})

function mustStart(): GameState {
  const result = startNextHand(createGame({ fixedDeck: deck }))
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.state
}

function act(state: GameState, command: EngineCommand): GameState {
  const result = applyAction(state, command)
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.state
}

function bucketTotal(weights: Record<string, number>): number {
  return Object.values(weights).reduce((total, weight) => total + weight, 0)
}

function c(rank: Rank, suit: Suit): Card {
  return { rank, suit }
}
