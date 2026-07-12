import { describe, expect, it } from 'vitest'
import { createGame, startNextHand, type GameState, type HandHistoryEvent } from '../../src/poker-engine'
import {
  createCommandRecordDraft,
  createEventRecordDrafts,
  InMemoryCommandRecordStore,
  InMemoryEventRecordStore,
  InMemoryMatchRecordStore,
  type MatchRecordDraft,
} from '../../src/persistence'

function mustStart(state: GameState): GameState {
  const result = startNextHand(state)
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.state
}

const matchDraft: MatchRecordDraft = {
  matchId: 'match-1',
  tableId: 'table-1',
  format: 'freezeout',
  rulesContractVersion: 'para-poker-rules-v0',
  eventSchemaVersion: 'poker-event-v1',
  seatAssignments: [
    { seatId: 'human', playerId: 'player-human' },
    { seatId: 'npc-1', npcId: 'npc-1' },
  ],
  startingStacks: { human: 200, 'npc-1': 200 },
  blinds: { smallBlind: 1, bigBlind: 2 },
}

describe('in-memory persistence stores', () => {
  it('creates, reads, updates, and completes match summaries without raw engine state', async () => {
    const store = new InMemoryMatchRecordStore()

    const created = await store.createMatch(matchDraft)
    const withHand = await store.appendHand('match-1', {
      handId: 'match-1-hand-1',
      handNumber: 1,
      dealerSeatId: 'human',
      smallBlindSeatId: 'human',
      bigBlindSeatId: 'npc-1',
      initialStacks: { human: 200, 'npc-1': 200 },
      finalStacks: { human: 199, 'npc-1': 198 },
      publicBoard: [],
      potAwards: [],
    })
    const completed = await store.completeMatch('match-1', {
      status: 'complete',
      winnerSeatIds: ['human'],
      finalStacks: { human: 400, 'npc-1': 0 },
    })
    const readBack = await store.getMatch('match-1')

    expect(created.status).toBe('active')
    expect(withHand.hands).toHaveLength(1)
    expect(completed.status).toBe('complete')
    expect(readBack).toEqual(completed)
    expect(JSON.stringify(readBack)).not.toContain('deck')
    expect(JSON.stringify(readBack)).not.toContain('rngState')
  })

  it('stores public and seat-private events with stable replay ordering', async () => {
    const state = mustStart(createGame({ seed: 'event-store' }))
    const events = state.hand?.history ?? []
    const store = new InMemoryEventRecordStore()

    await store.appendEvents(createEventRecordDrafts('match-1', 'table-1', events))

    const publicEvents = await store.listPublicEvents('match-1')
    const humanEvents = await store.listSeatEvents('match-1', 'human')
    const replayEvents = await store.listReplayEvents('match-1')

    expect(publicEvents.map((record) => record.event.type)).toEqual(['handStarted', 'blindPosted', 'blindPosted'])
    expect(publicEvents.every((record) => record.privacyClass === 'public')).toBe(true)
    expect(humanEvents.map((record) => record.event.type)).toEqual([
      'handStarted',
      'blindPosted',
      'blindPosted',
      'holeCardsDealt',
    ])
    expect(humanEvents.at(-1)?.privacyClass).toBe('seatPrivate')
    expect(humanEvents.at(-1)?.visibilitySeatId).toBe('human')
    expect(replayEvents.map((record) => record.event.sequenceNumber)).toEqual([1, 2, 3])
  })

  it('exports only public events plus the requesting seat private events', async () => {
    const state = mustStart(createGame({ seed: 'seat-export' }))
    const events = state.hand?.history ?? []
    const store = new InMemoryEventRecordStore()
    const npcHoleCardEvent = events.find(
      (event): event is Extract<HandHistoryEvent, { type: 'holeCardsDealt' }> =>
        event.type === 'holeCardsDealt' && event.visibility === 'npc-1',
    )

    await store.appendEvents(createEventRecordDrafts('match-1', 'table-1', events))

    const exported = await store.exportSeatHandHistory('match-1', 'human')
    const exportJson = JSON.stringify(exported)

    expect(exported.events.map((event) => event.type)).toEqual([
      'handStarted',
      'blindPosted',
      'blindPosted',
      'holeCardsDealt',
    ])
    expect(exported.events.at(-1)?.visibility).toBe('human')
    expect(exportJson).not.toContain('deck')
    expect(exportJson).not.toContain('rngState')
    for (const card of npcHoleCardEvent?.payload.cards ?? []) {
      expect(exportJson).not.toContain(JSON.stringify(card))
    }
  })

  it('returns immutable record copies so callers cannot mutate persisted data', async () => {
    const state = mustStart(createGame({ seed: 'immutable-store' }))
    const store = new InMemoryEventRecordStore()

    await store.appendEvents(createEventRecordDrafts('match-1', 'table-1', state.hand?.history ?? []))

    const firstRead = await store.listPublicEvents('match-1')
    firstRead[0].event.payload = { dealerSeatId: 'mutated' }

    const secondRead = await store.listPublicEvents('match-1')
    expect(secondRead[0].event.payload).toEqual({ dealerSeatId: 'human' })
  })

  it('stores command records separately from replay events for database-ready export metadata', async () => {
    const store = new InMemoryCommandRecordStore()

    await store.appendCommand(
      createCommandRecordDraft({
        matchId: 'match-1',
        tableId: 'table-1',
        commandId: 'cmd-call',
        playerId: 'player-human',
        trustedSeatId: 'human',
        expectedStateVersion: 1,
        requestedAction: { type: 'call' },
        status: 'accepted',
        resultingEventIds: ['hand-1-event-6'],
      }),
    )
    await store.appendCommand(
      createCommandRecordDraft({
        matchId: 'match-1',
        tableId: 'table-1',
        commandId: 'cmd-bad',
        playerId: 'player-npc',
        trustedSeatId: 'npc-1',
        expectedStateVersion: 1,
        requestedAction: { type: 'check', seatId: 'human', source: 'npc' },
        status: 'rejected',
        rejectionReason: 'NOT_PENDING_ACTOR',
      }),
    )

    const records = await store.listCommandsForMatch('match-1')
    const rejected = await store.listRejectedCommands('match-1')

    expect(records.map((record) => record.commandId)).toEqual(['cmd-call', 'cmd-bad'])
    expect(records[0].status).toBe('accepted')
    expect(records[0].resultingEventIds).toEqual(['hand-1-event-6'])
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toEqual(expect.objectContaining({ commandId: 'cmd-bad', rejectionReason: 'NOT_PENDING_ACTOR' }))
    expect(JSON.stringify(records)).not.toContain('deck')
    expect(JSON.stringify(records)).not.toContain('rngState')
  })
})
