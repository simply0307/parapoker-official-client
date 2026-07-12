import { describe, expect, it } from 'vitest'
import {
  applyAction,
  createGame,
  replayHandFromConfig,
  startNextHand,
  type EngineCommand,
  type GameState,
  type HandHistoryEvent,
} from '../../src/poker-engine'

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

function expectEnvelope(event: HandHistoryEvent, sequenceNumber: number, type: string) {
  expect(event).toEqual(
    expect.objectContaining({
      schemaVersion: 'poker-event-v1',
      eventId: `hand-${event.handId}-event-${sequenceNumber}`,
      sequenceNumber,
      handId: expect.any(Number),
      visibility: expect.any(String),
      type,
      payload: expect.any(Object),
    }),
  )
}

describe('event schema v1', () => {
  it('wraps hand-start events in a stable replay envelope', () => {
    const state = mustStart(createGame({ seed: 'event-schema' }))
    const events = state.hand?.history ?? []

    expect(events).toHaveLength(5)
    expectEnvelope(events[0], 1, 'handStarted')
    expect(events[0].payload).toEqual({ dealerSeatId: 'human' })
    expectEnvelope(events[1], 2, 'blindPosted')
    expect(events[1].payload).toEqual({ seatId: 'human', blind: 'small', amount: 1 })
    expectEnvelope(events[3], 4, 'holeCardsDealt')
    expect(events[3].visibility).toBe('human')
    expect(events[3].payload).toEqual({
      seatId: 'human',
      cards: state.seats.find((seat) => seat.id === 'human')?.holeCards,
    })
  })

  it('adds command correlation IDs to action events without affecting deterministic order', () => {
    let state = mustStart(createGame({ seed: 'command-correlation' }))

    state = mustApply(state, {
      type: 'call',
      seatId: 'human',
      source: 'human',
      commandId: 'cmd-call-1',
    })

    const actionEvent = state.hand?.history.find((event) => event.type === 'actionApplied')
    expect(actionEvent).toEqual(
      expect.objectContaining({
        commandId: 'cmd-call-1',
        sequenceNumber: 6,
        eventId: 'hand-1-event-6',
        payload: {
          seatId: 'human',
          action: 'call',
          amount: 1,
          targetContribution: 2,
        },
      }),
    )
  })

  it('keeps replay event sequences stable from config and command stream', () => {
    const commands: EngineCommand[] = [{ type: 'fold', seatId: 'human', source: 'human', commandId: 'cmd-fold-1' }]
    const first = replayHandFromConfig({ seed: 'event-replay' }, commands)
    const second = replayHandFromConfig({ seed: 'event-replay' }, commands)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) {
      throw new Error('Replay failed unexpectedly')
    }

    expect(first.events).toEqual(second.events)
    expect(first.events.map((event) => event.sequenceNumber)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(first.events.map((event) => event.eventId)).toEqual([
      'hand-1-event-1',
      'hand-1-event-2',
      'hand-1-event-3',
      'hand-1-event-4',
      'hand-1-event-5',
      'hand-1-event-6',
      'hand-1-event-7',
    ])
  })

  it('keeps private hole-card events seat-scoped', () => {
    const state = mustStart(createGame({ seed: 'private-events' }))
    const privateEvents = state.hand?.history.filter((event) => event.type === 'holeCardsDealt') ?? []

    expect(privateEvents.map((event) => event.visibility)).toEqual(['human', 'npc-1'])
    expect(privateEvents.every((event) => event.payload.type === undefined)).toBe(true)
  })
})
