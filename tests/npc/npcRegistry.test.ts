import { describe, expect, it } from 'vitest'
import {
  IndexedDbNpcRegistryStore,
  InMemoryNpcRegistryStore,
  normalizeNpcDefinition,
  normalizeStrategyProfile,
} from '../../src/npc/npcRegistry'

describe('NPC registry store', () => {
  it('seeds definitions and strategy profiles from the built-in roster', async () => {
    const store = new InMemoryNpcRegistryStore()
    const snapshot = await store.snapshot()

    expect(snapshot.definitions.map((definition) => definition.id).sort()).toEqual([
      'npc-maven',
      'npc-quinn',
      'npc-rook',
      'npc-sol',
      'npc-vega',
    ])
    expect(snapshot.strategyProfiles.length).toBeGreaterThan(0)
    expect(snapshot.definitions.every((definition) =>
      snapshot.strategyProfiles.some((profile) => profile.id === definition.strategyProfileId)
    )).toBe(true)
  })

  it('upserts and retires versioned NPC definitions without mutating stored copies', async () => {
    const store = new InMemoryNpcRegistryStore()

    const updated = await store.upsertDefinition({
      id: 'npc-maven',
      name: 'Maven Prime',
      archetypeLabel: 'Measured caller',
      strategyProfileId: 'strategy-balanced-caller-v4',
      status: 'active',
    })
    updated.name = 'Mutated'

    expect((await store.listDefinitions()).find((definition) => definition.id === 'npc-maven')?.name).toBe('Maven Prime')
    await expect(store.retireDefinition('npc-maven')).resolves.toEqual(expect.objectContaining({
      id: 'npc-maven',
      status: 'retired',
    }))
  })

  it('rejects unsafe or unknown NPC registry references', () => {
    expect(() => normalizeNpcDefinition({
      id: 'npc-new',
      name: 'New NPC',
      archetypeLabel: 'Experimental',
      strategyProfileId: 'missing-profile',
      status: 'draft',
    }, [])).toThrow('Unknown strategy profile')

    expect(() => normalizeStrategyProfile({
      id: 'strategy-bad',
      version: 0,
      name: 'Bad',
      status: 'draft',
      difficulty: 'steady',
      modules: [],
      policyConfig: {
        preflopAggression: 0.5,
        preflopLooseness: 0.5,
        postflopAggression: 0.5,
        pressureRaiseMultiplier: 2.5,
      },
    })).toThrow('version')
  })

  it('persists local registry edits across IndexedDB store instances', async () => {
    const databaseName = `npc-registry-${Date.now()}`
    const first = new IndexedDbNpcRegistryStore(databaseName)

    await first.upsertDefinition({
      id: 'npc-maven',
      name: 'Maven Persisted',
      archetypeLabel: 'Measured caller',
      strategyProfileId: 'strategy-balanced-caller-v4',
      status: 'active',
    })

    const second = new IndexedDbNpcRegistryStore(databaseName)
    const definition = (await second.listDefinitions()).find((candidate) => candidate.id === 'npc-maven')
    expect(definition?.name).toBe('Maven Persisted')
  })
})
