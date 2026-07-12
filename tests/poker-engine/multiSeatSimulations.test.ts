import { describe, expect, it } from 'vitest'
import {
  applyAction,
  assertSerializableState,
  createGame,
  getLegalActions,
  getPublicView,
  getSeatView,
  startNextHand,
  type EngineCommand,
  type GameState,
  type LegalAction,
  type SeatId,
} from '../../src/poker-engine'

const MAX_HANDS = 120
const MAX_ACTIONS_PER_HAND = 120

describe('generic multi-seat engine simulations', () => {
  it('plays deterministic four-seat freezeout simulations while preserving invariants', () => {
    const state = createGame({
      seed: 'four-seat-sim',
      startingStack: 24,
      seats: makeSeats(4),
    })

    const finalState = playLegalFreezeout(state, 'four-seat-sim')

    expect(finalState.status).toBe('complete')
    expect(totalStacks(finalState)).toBe(96)
  })

  it('plays deterministic six-seat freezeout simulations while preserving invariants', () => {
    const state = createGame({
      seed: 'six-seat-sim',
      startingStack: 18,
      seats: makeSeats(6),
    })

    const finalState = playLegalFreezeout(state, 'six-seat-sim')

    expect(finalState.status).toBe('complete')
    expect(totalStacks(finalState)).toBe(108)
  })
})

function playLegalFreezeout(initialState: GameState, seed: string): GameState {
  let state = initialState
  const next = seededChooser(seed)
  const totalChips = totalStacks(state)
  let hands = 0

  while (state.status !== 'complete' && hands < MAX_HANDS) {
    const started = startNextHand(state)
    expect(started.ok, `${seed} should start hand ${hands + 1}`).toBe(true)
    if (!started.ok) {
      throw new Error(started.error.message)
    }
    state = started.state
    hands += 1
    assertInvariants(state, totalChips, seed)

    let actions = 0
    while (state.status === 'handInProgress' && state.hand?.status === 'active') {
      actions += 1
      expect(actions, `${seed} hand ${state.handNumber} exceeded action cap`).toBeLessThanOrEqual(
        MAX_ACTIONS_PER_HAND,
      )

      const seatId = state.hand.pendingSeatId
      expect(seatId, `${seed} hand ${state.handNumber} missing pending actor`).toBeDefined()
      if (!seatId) {
        throw new Error('Missing pending actor')
      }

      const legalAction = chooseLegalAction(getLegalActions(state, seatId), next)
      const result = applyAction(state, toCommand(legalAction, seatId))
      expect(result.ok, `${seed} generated legal action should apply`).toBe(true)
      if (!result.ok) {
        throw new Error(result.error.message)
      }
      state = result.state
      assertInvariants(state, totalChips, seed)
    }
  }

  expect(hands, `${seed} exceeded hand cap`).toBeLessThan(MAX_HANDS)
  return state
}

function assertInvariants(state: GameState, totalChips: number, label: string): void {
  expect(assertSerializableState(state), `${label} state serializable and card-unique`).toBe(true)
  expect(state.seats.every((seat) => Number.isInteger(seat.stack) && seat.stack >= 0), label).toBe(true)
  expect(chipTotalForState(state), `${label} chip conservation`).toBe(totalChips)
  expect(JSON.stringify(getPublicView(state)), `${label} public projection leaks deck`).not.toContain('deck')
  expect(JSON.stringify(getPublicView(state)), `${label} public projection leaks RNG`).not.toContain('rngState')

  if (state.status === 'handInProgress' && state.hand?.status === 'active') {
    const pendingSeat = state.seats.find((seat) => seat.id === state.hand?.pendingSeatId)
    expect(pendingSeat?.status, `${label} pending actor active`).toBe('active')
    expect((pendingSeat?.stack ?? 0) > 0, `${label} pending actor funded`).toBe(true)

    for (const seat of state.seats) {
      const viewText = JSON.stringify(getSeatView(state, seat.id))
      expect(viewText, `${label} seat view leaks deck`).not.toContain('deck')
      expect(viewText, `${label} seat view leaks RNG`).not.toContain('rngState')
    }
  } else {
    expect(state.hand?.pendingSeatId, `${label} settled hand pending actor`).toBeUndefined()
  }
}

function makeSeats(count: number): GameState['config']['seats'] {
  return Array.from({ length: count }, (_, index) => ({
    id: index === 0 ? 'human' : `npc-${index}`,
    name: index === 0 ? 'You' : `ParaBot ${index}`,
    kind: index === 0 ? 'human' : 'npc',
  }))
}

function chooseLegalAction(actions: LegalAction[], next: () => number): LegalAction {
  expect(actions.length).toBeGreaterThan(0)

  const checksAndCalls = actions.filter((action) => action.type === 'check' || action.type === 'call')
  const folds = actions.filter((action) => action.type === 'fold')
  const allIns = actions.filter((action) => action.type === 'allIn')
  const pressure = actions.filter((action) => action.type === 'bet' || action.type === 'raise')
  const roll = next()

  if (allIns.length > 0 && roll > 0.88) {
    return allIns[0]
  }
  if (checksAndCalls.length > 0 && roll > 0.22) {
    return checksAndCalls[0]
  }
  if (pressure.length > 0 && roll > 0.12) {
    return pressure[0]
  }
  if (folds.length > 0) {
    return folds[0]
  }

  return actions[0]
}

function toCommand(action: LegalAction, seatId: SeatId): EngineCommand {
  switch (action.type) {
    case 'fold':
      return { type: 'fold', seatId }
    case 'check':
      return { type: 'check', seatId }
    case 'call':
      return { type: 'call', seatId }
    case 'allIn':
      return { type: 'allIn', seatId }
    case 'bet':
      return { type: 'bet', seatId, amount: action.min }
    case 'raise':
      return { type: 'raise', seatId, amount: action.min }
  }
}

function chipTotalForState(state: GameState): number {
  const stacks = totalStacks(state)
  if (state.status === 'handInProgress' && state.hand?.status === 'active') {
    return stacks + Object.values(state.hand.totalContributions).reduce((sum, amount) => sum + amount, 0)
  }
  return stacks
}

function totalStacks(state: GameState): number {
  return state.seats.reduce((sum, seat) => sum + seat.stack, 0)
}

function seededChooser(seed: string): () => number {
  let state = 0
  for (let index = 0; index < seed.length; index += 1) {
    state = (state * 31 + seed.charCodeAt(index)) >>> 0
  }
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x100000000
  }
}
