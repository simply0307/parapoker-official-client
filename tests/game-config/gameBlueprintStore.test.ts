import { describe, expect, it } from 'vitest'
import { createGameBlueprint } from '../../src/game-config/gameBlueprint'
import {
  IndexedDbGameBlueprintStore,
  InMemoryGameBlueprintStore,
  normalizeGameBlueprint,
} from '../../src/game-config/gameBlueprintStore'

describe('game blueprint store', () => {
  it('persists reusable blueprints and returns cloned records', async () => {
    const store = new InMemoryGameBlueprintStore()
    const blueprint = createGameBlueprint({
      mode: 'heads-up',
      startingStack: 200,
      smallBlind: 1,
      bigBlind: 2,
      seed: 'store-blueprint',
    })

    const record = await store.upsertBlueprint(blueprint)
    record.blueprint.name = 'Mutated outside store'

    const saved = await store.listBlueprints()
    expect(saved).toHaveLength(1)
    expect(saved[0].blueprint.name).toBe('Local Heads-Up Solo')
    expect(saved[0].blueprint.version).toBe(1)
    expect(saved[0].status).toBe('draft')
  })

  it('creates lobby tables from pinned blueprint versions', async () => {
    const store = new InMemoryGameBlueprintStore()
    const blueprint = createGameBlueprint({
      mode: 'six-max',
      startingStack: 300,
      smallBlind: 2,
      bigBlind: 4,
      seed: 'six-max-lobby',
    })

    const table = await store.createLobbyTable(blueprint)
    blueprint.name = 'Edited after open'

    expect(table.status).toBe('open')
    expect(table.blueprintId).toBe('local-six-max-blueprint')
    expect(table.blueprintVersion).toBe(1)
    expect(table.blueprint.name).toBe('Local Six-Max Solo')

    const tables = await store.listLobbyTables()
    expect(tables[0].blueprint.name).toBe('Local Six-Max Solo')
    expect(tables[0].blueprint.seats).toHaveLength(6)
  })

  it('cancels lobby tables without deleting their pinned blueprint snapshot', async () => {
    const store = new InMemoryGameBlueprintStore()
    const table = await store.createLobbyTable(
      createGameBlueprint({
        mode: 'heads-up',
        startingStack: 200,
        smallBlind: 1,
        bigBlind: 2,
        seed: 'cancel-table',
      }),
    )

    const cancelled = await store.cancelLobbyTable(table.tableId, 'test-cancel')

    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.closeReason).toBe('test-cancel')
    expect(cancelled.blueprint.id).toBe('local-heads-up-blueprint')
  })

  it('closes a completed freezeout so it is no longer an open lobby table', async () => {
    const store = new InMemoryGameBlueprintStore()
    const table = await store.createLobbyTable(
      createGameBlueprint({
        mode: 'heads-up',
        startingStack: 200,
        smallBlind: 1,
        bigBlind: 2,
        seed: 'complete-table',
      }),
    )

    const closed = await store.closeLobbyTable(table.tableId, 'match-complete')

    expect(closed.status).toBe('closed')
    expect(closed.closeReason).toBe('match-complete')
    expect(closed.closedAt).toBeTruthy()
    expect((await store.listLobbyTables()).filter((candidate) => candidate.status === 'open')).toHaveLength(0)
  })

  it('removes a single-use freezeout from the open lobby while it is running', async () => {
    const store = new InMemoryGameBlueprintStore()
    const table = await store.createLobbyTable(
      createGameBlueprint({
        mode: 'heads-up',
        startingStack: 200,
        smallBlind: 1,
        bigBlind: 2,
        seed: 'running-table',
      }),
    )

    const running = await store.startLobbyTable(table.tableId)

    expect(running.status).toBe('running')
    expect((await store.listLobbyTables()).filter((candidate) => candidate.status === 'open')).toHaveLength(0)
    await expect(store.startLobbyTable(table.tableId)).resolves.toEqual(running)
  })

  it('rejects invalid blueprint rules before persistence', () => {
    const blueprint = createGameBlueprint({
      mode: 'heads-up',
      startingStack: 200,
      smallBlind: 2,
      bigBlind: 4,
      seed: 'invalid',
    })

    expect(() => normalizeGameBlueprint({ ...blueprint, bigBlind: 1 })).toThrow('big blind')
    expect(() => normalizeGameBlueprint({ ...blueprint, seats: [] })).toThrow('heads-up blueprint requires 2 seats')
  })

  it('persists records across IndexedDB store instances', async () => {
    const testDbName = `test-game-blueprint-store-${Date.now()}`
    const first = new IndexedDbGameBlueprintStore(testDbName)
    const blueprint = createGameBlueprint({
      mode: 'heads-up',
      startingStack: 200,
      smallBlind: 1,
      bigBlind: 2,
      seed: 'indexed-blueprint',
    })

    await first.upsertBlueprint(blueprint)
    await first.createLobbyTable(blueprint)

    const second = new IndexedDbGameBlueprintStore(testDbName)
    const snapshot = await second.snapshot()

    expect(snapshot.blueprints).toHaveLength(1)
    expect(snapshot.lobbyTables).toHaveLength(1)
    expect(snapshot.lobbyTables[0].blueprint.seed).toBe('indexed-blueprint')
  })
})
