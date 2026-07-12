import { describe, expect, it } from 'vitest'
import { InMemoryEventRecordStore, InMemoryMatchRecordStore } from '../../src/persistence'
import {
  InMemoryServerTableAuthority,
  type PlayerActionRequest,
} from '../../src/table-controllers/server-authoritative/InMemoryServerTableAuthority'

const headsUpHumans = {
  seed: 'server-authority',
  seats: [
    { id: 'seat-1', name: 'Alice', kind: 'human' as const },
    { id: 'seat-2', name: 'Bob', kind: 'human' as const },
  ],
}

function createTable() {
  const table = new InMemoryServerTableAuthority({
    tableId: 'table-1',
    config: headsUpHumans,
    seatBindings: [
      { connectionId: 'conn-alice', seatId: 'seat-1' },
      { connectionId: 'conn-bob', seatId: 'seat-2' },
    ],
  })
  table.startNextHand()
  return table
}

function request(overrides: Partial<PlayerActionRequest> = {}): PlayerActionRequest {
  return {
    protocolVersion: 'parapoker-multiplayer-v1',
    commandId: 'cmd-1',
    tableId: 'table-1',
    expectedStateVersion: 1,
    requestedAction: { type: 'call' },
    ...overrides,
  }
}

describe('in-memory server table authority', () => {
  it('binds a client request to the trusted seat and ignores supplied seat identity', () => {
    const table = createTable()

    const result = table.submitPlayerAction('conn-alice', {
      ...request(),
      requestedAction: {
        type: 'call',
        seatId: 'seat-2',
        source: 'npc',
      } as PlayerActionRequest['requestedAction'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error(result.reason)
    }
    expect(result.stateVersion).toBe(2)
    expect(result.events[0]).toEqual(
      expect.objectContaining({
        commandId: 'cmd-1',
        payload: expect.objectContaining({
          seatId: 'seat-1',
          action: 'call',
          amount: 1,
        }),
      }),
    )
  })

  it('rejects unseated connections without changing table state', () => {
    const table = createTable()
    const before = table.getSnapshotForTests()

    const result = table.submitPlayerAction('conn-stranger', request())

    expect(result).toEqual({
      ok: false,
      tableId: 'table-1',
      commandId: 'cmd-1',
      stateVersion: 1,
      reason: 'NOT_SEATED',
      retryable: false,
    })
    expect(table.getSnapshotForTests()).toEqual(before)
  })

  it('rejects stale state versions and conflicting duplicate command IDs', () => {
    const table = createTable()

    const accepted = table.submitPlayerAction('conn-alice', request())
    expect(accepted.ok).toBe(true)

    const replayed = table.submitPlayerAction('conn-alice', request())
    expect(replayed).toEqual(accepted)

    const conflict = table.submitPlayerAction('conn-alice', {
      ...request({
        requestedAction: { type: 'fold' },
      }),
    })
    expect(conflict).toEqual({
      ok: false,
      tableId: 'table-1',
      commandId: 'cmd-1',
      stateVersion: 2,
      reason: 'IDEMPOTENCY_CONFLICT',
      retryable: false,
    })

    const stale = table.submitPlayerAction('conn-bob', request({ commandId: 'cmd-2', expectedStateVersion: 1 }))
    expect(stale).toEqual({
      ok: false,
      tableId: 'table-1',
      commandId: 'cmd-2',
      stateVersion: 2,
      reason: 'STATE_VERSION_CONFLICT',
      retryable: true,
    })
  })

  it('rejects out-of-turn and illegal action requests through the server boundary', () => {
    const table = createTable()

    expect(table.submitPlayerAction('conn-bob', request())).toEqual({
      ok: false,
      tableId: 'table-1',
      commandId: 'cmd-1',
      stateVersion: 1,
      reason: 'NOT_PENDING_ACTOR',
      retryable: true,
    })

    expect(
      table.submitPlayerAction('conn-alice', request({ commandId: 'cmd-2', requestedAction: { type: 'check' } })),
    ).toEqual({
      ok: false,
      tableId: 'table-1',
      commandId: 'cmd-2',
      stateVersion: 1,
      reason: 'ACTION_NOT_LEGAL',
      retryable: true,
    })
  })

  it('serves only seat-appropriate projections and hides canonical secrets', () => {
    const table = createTable()
    const aliceProjection = table.getProjectionForConnection('conn-alice')
    const publicProjection = table.getPublicProjection()
    const snapshot = table.getSnapshotForTests()
    const bobCards = snapshot.state.seats.find((seat) => seat.id === 'seat-2')?.holeCards ?? []

    expect(aliceProjection.ok).toBe(true)
    if (!aliceProjection.ok) {
      throw new Error(aliceProjection.reason)
    }
    expect(aliceProjection.privateSeatView?.heroSeatId).toBe('seat-1')
    expect(JSON.stringify(aliceProjection)).not.toContain('deck')
    expect(JSON.stringify(aliceProjection)).not.toContain('rngState')
    for (const card of bobCards) {
      expect(JSON.stringify(aliceProjection)).not.toContain(JSON.stringify(card))
    }

    expect(publicProjection.privateSeatView).toBeUndefined()
    expect(JSON.stringify(publicProjection)).not.toContain('deck')
    expect(JSON.stringify(publicProjection)).not.toContain('rngState')
  })

  it('persists match summaries and visibility-scoped events through store interfaces', async () => {
    const matchStore = new InMemoryMatchRecordStore()
    const eventStore = new InMemoryEventRecordStore()
    const table = new InMemoryServerTableAuthority({
      tableId: 'table-1',
      config: headsUpHumans,
      seatBindings: [
        { connectionId: 'conn-alice', seatId: 'seat-1' },
        { connectionId: 'conn-bob', seatId: 'seat-2' },
      ],
      persistence: {
        matchId: 'match-1',
        matchStore,
        eventStore,
        format: 'freezeout',
        rulesContractVersion: 'para-poker-rules-v0',
      },
    })

    const started = table.startNextHand()
    expect(started.ok).toBe(true)
    const acted = table.submitPlayerAction('conn-alice', request())
    expect(acted.ok).toBe(true)

    const match = await matchStore.getMatch('match-1')
    const publicEvents = await eventStore.listPublicEvents('match-1')
    const aliceEvents = await eventStore.listSeatEvents('match-1', 'seat-1')
    const exported = await eventStore.exportSeatHandHistory('match-1', 'seat-1')

    expect(match?.tableId).toBe('table-1')
    expect(match?.status).toBe('active')
    expect(match?.eventSchemaVersion).toBe('poker-event-v1')
    expect(publicEvents.map((record) => record.event.type)).toContain('actionApplied')
    expect(aliceEvents.map((record) => record.event.type)).toContain('holeCardsDealt')
    expect(exported.events.map((event) => event.type)).toContain('holeCardsDealt')
    expect(JSON.stringify(exported)).not.toContain('deck')
    expect(JSON.stringify(exported)).not.toContain('rngState')
  })

  it('does not persist rejected commands as replay events', async () => {
    const eventStore = new InMemoryEventRecordStore()
    const table = new InMemoryServerTableAuthority({
      tableId: 'table-1',
      config: headsUpHumans,
      seatBindings: [
        { connectionId: 'conn-alice', seatId: 'seat-1' },
        { connectionId: 'conn-bob', seatId: 'seat-2' },
      ],
      persistence: {
        matchId: 'match-1',
        matchStore: new InMemoryMatchRecordStore(),
        eventStore,
      },
    })

    table.startNextHand()
    const rejected = table.submitPlayerAction('conn-bob', request())

    expect(rejected.ok).toBe(false)
    expect((await eventStore.listPublicEvents('match-1')).map((record) => record.event.type)).toEqual([
      'handStarted',
      'blindPosted',
      'blindPosted',
    ])
  })
})
