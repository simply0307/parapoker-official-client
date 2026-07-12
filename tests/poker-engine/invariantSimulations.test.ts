import { describe, expect, it } from 'vitest'
import {
  applyAction,
  assertSerializableState,
  cardToString,
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

const TOTAL_CHIPS = 400
const MAX_HANDS_PER_MATCH = 200
const MAX_ACTIONS_PER_HAND = 80

describe('invariant and randomized legal-game simulations', () => {
  it('preserves core invariants across seeded legal-action simulations', () => {
    for (const seed of ['sim-alpha', 'sim-bravo', 'sim-charlie', 'sim-delta', 'sim-echo']) {
      let state = createGame({ seed })
      const chooser = seededChooser(seed)
      let handsStarted = 0

      while (state.status !== 'complete' && handsStarted < MAX_HANDS_PER_MATCH) {
        const started = startNextHand(state)
        expect(started.ok, seed).toBe(true)
        if (!started.ok) {
          throw new Error(started.error.message)
        }

        state = started.state
        handsStarted += 1
        assertCoreInvariants(state, seed)

        let actionsThisHand = 0
        while (state.status === 'handInProgress' && state.hand?.status === 'active') {
          actionsThisHand += 1
          expect(actionsThisHand, `${seed} hand ${state.handNumber} exceeded action cap`).toBeLessThanOrEqual(
            MAX_ACTIONS_PER_HAND,
          )

          const pendingSeatId = state.hand.pendingSeatId
          expect(pendingSeatId, `${seed} missing pending actor`).toBeDefined()
          if (!pendingSeatId) {
            throw new Error('Missing pending actor')
          }

          const action = chooseLegalAction(getLegalActions(state, pendingSeatId), chooser)
          const result = applyAction(state, toCommand(action, pendingSeatId, `${seed}-${state.handNumber}-${actionsThisHand}`))
          expect(result.ok, `${seed} rejected a generated legal action`).toBe(true)
          if (!result.ok) {
            throw new Error(result.error.message)
          }

          state = result.state
          assertCoreInvariants(state, seed)
        }
      }

      expect(state.status, seed).toBe('complete')
      expect(handsStarted, `${seed} exceeded hand cap`).toBeLessThanOrEqual(MAX_HANDS_PER_MATCH)
      expect(totalStacks(state)).toBe(TOTAL_CHIPS)
    }
  })
})

function assertCoreInvariants(state: GameState, label: string): void {
  expect(assertSerializableState(state), `${label} state must remain serializable with unique cards`).toBe(true)
  expect(state.seats.every((seat) => Number.isInteger(seat.stack) && seat.stack >= 0), label).toBe(true)
  expect(chipTotalForState(state), `${label} chips must be conserved`).toBe(TOTAL_CHIPS)
  assertPendingActorInvariant(state, label)
  assertLegalActionCompletion(state, label)
  assertProjectionVisibility(state, label)
  assertEventSequence(state, label)
}

function assertPendingActorInvariant(state: GameState, label: string): void {
  if (state.status !== 'handInProgress' || state.hand?.status !== 'active') {
    expect(state.hand?.pendingSeatId, `${label} settled hands must not keep pending actors`).toBeUndefined()
    return
  }

  const pendingSeatId = state.hand.pendingSeatId
  expect(pendingSeatId, `${label} active hand must have a pending actor`).toBeDefined()
  const pendingSeat = state.seats.find((seat) => seat.id === pendingSeatId)
  expect(pendingSeat?.status, `${label} pending actor must be active`).toBe('active')
  expect((pendingSeat?.stack ?? 0) > 0, `${label} pending actor must have chips`).toBe(true)
}

function assertLegalActionCompletion(state: GameState, label: string): void {
  for (const seat of state.seats) {
    const legalActions = getLegalActions(state, seat.id)
    if (state.status === 'handInProgress' && state.hand?.status === 'active' && state.hand.pendingSeatId === seat.id) {
      expect(legalActions.length, `${label} pending actor must have legal actions`).toBeGreaterThan(0)
    } else {
      expect(legalActions, `${label} non-pending seats must not have legal actions`).toEqual([])
    }
  }
}

function assertProjectionVisibility(state: GameState, label: string): void {
  const publicJson = JSON.stringify(getPublicView(state))
  expect(publicJson, `${label} public projection must not expose deck`).not.toContain('deck')
  expect(publicJson, `${label} public projection must not expose RNG state`).not.toContain('rngState')

  if (state.status === 'handInProgress' && state.hand?.status === 'active') {
    for (const seat of state.seats) {
      const viewJson = JSON.stringify(getSeatView(state, seat.id))
      const opponentCards = state.seats
        .filter((candidate) => candidate.id !== seat.id)
        .flatMap((candidate) => candidate.holeCards.map(cardToString))

      expect(viewJson, `${label} seat projection must not expose deck`).not.toContain('deck')
      expect(viewJson, `${label} seat projection must not expose RNG state`).not.toContain('rngState')
      for (const card of opponentCards) {
        expect(viewJson, `${label} active seat projection leaked opponent ${card}`).not.toContain(card)
      }
    }
  }
}

function assertEventSequence(state: GameState, label: string): void {
  const events = state.hand?.history ?? []
  for (const [index, event] of events.entries()) {
    const sequenceNumber = index + 1
    expect(event.schemaVersion, label).toBe('poker-event-v1')
    expect(event.sequenceNumber, label).toBe(sequenceNumber)
    expect(event.eventId, label).toBe(`hand-${event.handId}-event-${sequenceNumber}`)
    expect(event.payload, label).not.toHaveProperty('type')
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

function chooseLegalAction(actions: LegalAction[], next: () => number): LegalAction {
  const nonRaiseActions = actions.filter((action) => action.type !== 'bet' && action.type !== 'raise')
  const candidateActions = nonRaiseActions.length > 0 && next() < 0.65 ? nonRaiseActions : actions
  return candidateActions[Math.floor(next() * candidateActions.length)]
}

function toCommand(action: LegalAction, seatId: SeatId, commandId: string): EngineCommand {
  switch (action.type) {
    case 'fold':
      return { type: 'fold', seatId, commandId }
    case 'check':
      return { type: 'check', seatId, commandId }
    case 'call':
      return { type: 'call', seatId, commandId }
    case 'allIn':
      return { type: 'allIn', seatId, commandId }
    case 'bet':
      return { type: 'bet', seatId, amount: chooseAmount(action.min, action.max, commandId), commandId }
    case 'raise':
      return { type: 'raise', seatId, amount: chooseAmount(action.min, action.max, commandId), commandId }
  }
}

function chooseAmount(min: number, max: number, salt: string): number {
  if (min === max) {
    return min
  }
  const next = seededChooser(salt)
  const options = [min, Math.floor((min + max) / 2), max]
  return options[Math.floor(next() * options.length)]
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
