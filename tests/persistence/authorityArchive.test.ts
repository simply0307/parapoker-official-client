import { describe, expect, it } from 'vitest'
import { applyAction, createGame, startNextHand, type GameState } from '../../src/poker-engine'
import {
  appendAuthorityCommands,
  appendAuthorityEvents,
  buildArchivedHandRecord,
  createActiveTableJournal,
  createCommandRecordDraft,
  createEventRecordDrafts,
  InMemoryCommandRecordStore,
  InMemoryEventRecordStore,
  recordCompletedAuthorityHand,
} from '../../src/persistence'

function mustStart(state: GameState): GameState {
  const result = startNextHand(state)
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.state
}

describe('authority archive journal', () => {
  it('assigns contiguous table sequences while preserving hand-local sequences and visibility', async () => {
    let state = mustStart(createGame({ seed: 'authority-journal-1' }))
    const firstHandEvents = state.hand?.history ?? []
    const fold = applyAction(state, { type: 'fold', seatId: 'human', source: 'human', commandId: 'cmd-fold-1' })
    expect(fold.ok).toBe(true)
    if (!fold.ok) {
      throw new Error(fold.error.message)
    }
    state = fold.state
    state = mustStart(state)
    const secondHandEvents = state.hand?.history ?? []
    const eventStore = new InMemoryEventRecordStore()

    await eventStore.appendEvents(createEventRecordDrafts('match-1', 'table-1', [...firstHandEvents, ...fold.events, ...secondHandEvents]))

    const allSeatEvents = await eventStore.listSeatEvents('match-1', 'human')
    const journal = appendAuthorityEvents(
      createActiveTableJournal({
        matchId: 'match-1',
        tableId: 'table-1',
        authorityClass: 'local-browser',
        createdAt: '2026-07-15T12:00:00.000Z',
      }),
      allSeatEvents,
    )

    expect(journal.events.map((event) => event.tableSequence)).toEqual(
      Array.from({ length: journal.events.length }, (_, index) => index + 1),
    )
    expect(journal.events.filter((event) => event.handNumber === 2)[0].handSequence).toBe(1)
    expect(journal.events.some((event) => event.visibility === 'human' && event.event.type === 'holeCardsDealt')).toBe(true)
    expect(journal.lastPersistedTableSequence).toBe(journal.events.length)
    expect(JSON.stringify(journal)).not.toContain('deck')
    expect(JSON.stringify(journal)).not.toContain('rngState')
  })

  it('retains accepted and rejected command evidence separately from event replay', async () => {
    const commandStore = new InMemoryCommandRecordStore()
    await commandStore.appendCommand(
      createCommandRecordDraft({
        matchId: 'match-1',
        tableId: 'table-1',
        commandId: 'cmd-call',
        trustedSeatId: 'human',
        expectedStateVersion: 1,
        stateVersionBefore: 1,
        stateVersionAfter: 2,
        requestedAction: { type: 'call' },
        trustedCommand: { type: 'call', seatId: 'human', source: 'human', commandId: 'cmd-call' },
        status: 'accepted',
        resultingEventIds: ['hand-1-event-6'],
      }),
    )
    await commandStore.appendCommand(
      createCommandRecordDraft({
        matchId: 'match-1',
        tableId: 'table-1',
        commandId: 'cmd-stale',
        trustedSeatId: 'npc-1',
        expectedStateVersion: 1,
        requestedAction: { type: 'check' },
        status: 'rejected',
        rejectionReason: 'STATE_VERSION_CONFLICT',
      }),
    )

    const journal = appendAuthorityCommands(
      createActiveTableJournal({
        matchId: 'match-1',
        tableId: 'table-1',
        authorityClass: 'server-exhibition',
      }),
      await commandStore.listCommandsForMatch('match-1'),
    )

    expect(journal.commands).toHaveLength(2)
    expect(journal.commands[0]).toEqual(expect.objectContaining({
      commandId: 'cmd-call',
      status: 'accepted',
      stateVersionBefore: 1,
      stateVersionAfter: 2,
      trustedCommand: expect.objectContaining({ seatId: 'human', source: 'human' }),
      resultingEventIds: ['hand-1-event-6'],
    }))
    expect(journal.commands[1]).toEqual(expect.objectContaining({
      commandId: 'cmd-stale',
      status: 'rejected',
      rejectionReason: 'STATE_VERSION_CONFLICT',
      stateVersionBefore: 1,
    }))
    expect(journal.commands[1].trustedCommand).toBeUndefined()
  })

  it('can record completed-hand checkpoints without duplicating a hand', async () => {
    const state = mustStart(createGame({ seed: 'authority-journal-hand' }))
    const hand = buildArchivedHandRecord({
      matchId: 'match-1',
      tableId: 'table-1',
      handNumber: 1,
      publicEvents: state.hand?.history ?? [],
      completedAt: '2026-07-15T12:00:00.000Z',
    })
    const journal = createActiveTableJournal({
      matchId: 'match-1',
      tableId: 'table-1',
      authorityClass: 'local-browser',
    })

    const once = recordCompletedAuthorityHand(journal, hand)
    const twice = recordCompletedAuthorityHand(once, {
      ...hand,
      completedAt: '2026-07-15T12:00:01.000Z',
    })

    expect(twice.completedHands).toHaveLength(1)
    expect(twice.completedHands[0].completedAt).toBe('2026-07-15T12:00:01.000Z')
  })
})
