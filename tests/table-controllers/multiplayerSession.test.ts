import { describe, expect, it } from 'vitest'
import {
  InMemoryMultiplayerTableService,
  type MultiplayerConnectionStatus,
} from '../../src/table-controllers/server-authoritative/InMemoryMultiplayerTableService'
import type { PlayerActionRequest } from '../../src/table-controllers/server-authoritative/InMemoryServerTableAuthority'

const tableConfig = {
  seed: 'multiplayer-session',
  seats: [
    { id: 'seat-1', name: 'Alice', kind: 'human' as const },
    { id: 'seat-2', name: 'Bob', kind: 'human' as const },
  ],
}

function createService() {
  const service = new InMemoryMultiplayerTableService({
    tableId: 'table-1',
    config: tableConfig,
    seats: [
      { playerId: 'alice', seatId: 'seat-1' },
      { playerId: 'bob', seatId: 'seat-2' },
    ],
  })
  service.startNextHand()
  return service
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

describe('in-memory multiplayer table service', () => {
  it('connects multiple authenticated players to distinct private seat projections', () => {
    const service = createService()

    const alice = service.connectPlayer({ playerId: 'alice', connectionId: 'alice-conn-1' })
    const bob = service.connectPlayer({ playerId: 'bob', connectionId: 'bob-conn-1' })

    expect(alice.ok).toBe(true)
    expect(bob.ok).toBe(true)
    if (!alice.ok || !bob.ok) {
      throw new Error('Expected both players to connect')
    }
    expect(alice.privateSeatView?.heroSeatId).toBe('seat-1')
    expect(bob.privateSeatView?.heroSeatId).toBe('seat-2')
    expect(JSON.stringify(alice)).not.toContain(JSON.stringify(bob.privateSeatView?.holeCards[0]))
    expect(JSON.stringify(bob)).not.toContain(JSON.stringify(alice.privateSeatView?.holeCards[0]))
    expect(service.getConnectionStatus('alice-conn-1')).toBe<MultiplayerConnectionStatus>('connected')
    expect(service.getConnectionStatus('bob-conn-1')).toBe<MultiplayerConnectionStatus>('connected')
  })

  it('routes real-player actions from separate connections through one authoritative table', () => {
    const service = createService()
    service.connectPlayer({ playerId: 'alice', connectionId: 'alice-conn-1' })
    service.connectPlayer({ playerId: 'bob', connectionId: 'bob-conn-1' })

    const aliceAction = service.submitPlayerAction('alice-conn-1', request())
    expect(aliceAction.ok).toBe(true)
    if (!aliceAction.ok) {
      throw new Error(aliceAction.reason)
    }
    expect(aliceAction.stateVersion).toBe(2)
    expect(aliceAction.events[0].payload).toEqual(
      expect.objectContaining({
        seatId: 'seat-1',
        action: 'call',
      }),
    )

    const bobProjection = service.getProjectionForConnection('bob-conn-1')
    expect(bobProjection.ok).toBe(true)
    if (!bobProjection.ok) {
      throw new Error(bobProjection.reason)
    }
    expect(bobProjection.privateSeatView?.pendingSeatId).toBe('seat-2')
    expect(bobProjection.privateSeatView?.legalActions.map((action) => action.type)).toContain('check')

    const bobAction = service.submitPlayerAction(
      'bob-conn-1',
      request({
        commandId: 'cmd-2',
        expectedStateVersion: 2,
        requestedAction: { type: 'check' },
      }),
    )
    expect(bobAction.ok).toBe(true)
    if (!bobAction.ok) {
      throw new Error(bobAction.reason)
    }
    expect(bobAction.stateVersion).toBe(3)
  })

  it('keeps disconnected connections from acting and lets the player reconnect to the same seat', () => {
    const service = createService()
    service.connectPlayer({ playerId: 'alice', connectionId: 'alice-conn-1' })

    service.disconnect('alice-conn-1')
    expect(service.getConnectionStatus('alice-conn-1')).toBe<MultiplayerConnectionStatus>('disconnected')
    expect(service.submitPlayerAction('alice-conn-1', request())).toEqual({
      ok: false,
      tableId: 'table-1',
      commandId: 'cmd-1',
      stateVersion: 1,
      reason: 'AUTH_REQUIRED',
      retryable: true,
    })

    const reconnected = service.connectPlayer({ playerId: 'alice', connectionId: 'alice-conn-2' })
    expect(reconnected.ok).toBe(true)
    if (!reconnected.ok) {
      throw new Error(reconnected.reason)
    }
    expect(reconnected.privateSeatView?.heroSeatId).toBe('seat-1')
    expect(service.getConnectionStatus('alice-conn-2')).toBe<MultiplayerConnectionStatus>('connected')
  })

  it('preserves command idempotency across reconnect retries for the same player', () => {
    const service = createService()
    service.connectPlayer({ playerId: 'alice', connectionId: 'alice-conn-1' })

    const accepted = service.submitPlayerAction('alice-conn-1', request())
    expect(accepted.ok).toBe(true)

    service.disconnect('alice-conn-1')
    service.connectPlayer({ playerId: 'alice', connectionId: 'alice-conn-2' })

    const retried = service.submitPlayerAction('alice-conn-2', request())
    expect(retried).toEqual(accepted)
  })

  it('supports spectator public projections without granting action authority', () => {
    const service = createService()
    const spectator = service.connectSpectator({ connectionId: 'spectator-conn-1' })

    expect(spectator.ok).toBe(true)
    if (!spectator.ok) {
      throw new Error(spectator.reason)
    }
    expect(spectator.privateSeatView).toBeUndefined()
    expect(JSON.stringify(spectator)).not.toContain('holeCards')
    expect(service.submitPlayerAction('spectator-conn-1', request())).toEqual({
      ok: false,
      tableId: 'table-1',
      commandId: 'cmd-1',
      stateVersion: 1,
      reason: 'NOT_SEATED',
      retryable: false,
    })
  })
})
