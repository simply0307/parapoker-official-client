import { describe, expect, it } from 'vitest'
import {
  IndexedDbNpcRegistryStore,
  InMemoryNpcRegistryStore,
  reconcileBuiltInNpcRegistry,
  normalizeNpcDefinition,
  normalizeStrategyProfile,
} from '../../src/npc/npcRegistry'
import { createStrategyProfileVersionDraft } from '../../src/npc/strategyEditing'
import { LOCAL_NPC_DEFINITIONS, LOCAL_NPC_STRATEGY_PROFILES } from '../../src/npc/roster'

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
      strategyProfileId: 'strategy-balanced-caller-v5',
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
      strategyProfileId: 'strategy-balanced-caller-v5',
      status: 'active',
    })

    const second = new IndexedDbNpcRegistryStore(databaseName)
    const definition = (await second.listDefinitions()).find((candidate) => candidate.id === 'npc-maven')
    expect(definition?.name).toBe('Maven Persisted')
  })

  it('creates immutable strategy versions without overwriting their source', async () => {
    const store = new InMemoryNpcRegistryStore()
    const source = (await store.listStrategyProfiles()).find((profile) => profile.id === 'strategy-balanced-caller-v5')
    if (!source) {
      throw new Error('Expected source strategy profile.')
    }
    const draft = createStrategyProfileVersionDraft(source, { id: 'strategy-registry-custom-v6' })

    const created = await store.createStrategyProfileVersion(source.id, draft)

    expect(created.id).toBe('strategy-registry-custom-v6')
    expect(created.version).toBe(6)
    expect((await store.listStrategyProfiles()).find((profile) => profile.id === source.id)).toEqual(source)
    await expect(store.createStrategyProfileVersion(source.id, draft)).rejects.toThrow(/already exists/i)
  })

  it('accepts intentional teaching leaks but rejects malformed teaching metadata', () => {
    const source = structuredClone(requireBuiltInProfile())
    source.teaching = {
      teachingObjective: 'Practice identifying an opponent who overfolds blinds.',
      conceptTags: ['blind defense', 'blind defense'],
      intendedTendencies: [{ id: 'overfolds-blinds' }],
      intentionallyExploitable: true,
      fallbackWarningThreshold: 0.25,
    }

    expect(normalizeStrategyProfile(source).teaching).toEqual(expect.objectContaining({
      conceptTags: ['blind defense'],
      intentionallyExploitable: true,
    }))

    source.teaching.intendedTendencies = [{ id: 'not-a-tendency' as 'overfolds-blinds' }]
    expect(() => normalizeStrategyProfile(source)).toThrow(/unknown npc teaching tendency/i)
  })

  it('seeds fresh registries with v5 only', () => {
    const seeded = reconcileBuiltInNpcRegistry({ definitions: [], strategyProfiles: [] })

    expect(seeded.strategyProfiles).toHaveLength(LOCAL_NPC_STRATEGY_PROFILES.length)
    expect(seeded.strategyProfiles.every((profile) => profile.version === 5 && profile.id.endsWith('-v5'))).toBe(true)
    expect(seeded.definitions).toEqual(LOCAL_NPC_DEFINITIONS)
  })

  it('retains stored v4 profiles while migrating built-in assignments to v5', () => {
    const v5Profile = LOCAL_NPC_STRATEGY_PROFILES[0]
    const v4Profile = {
      ...structuredClone(v5Profile),
      id: v5Profile.id.replace('-v5', '-v4'),
      version: 4,
    }
    const v4Definition = {
      ...structuredClone(LOCAL_NPC_DEFINITIONS[0]),
      name: 'Stored Maven name',
      strategyProfileId: v4Profile.id,
    }

    const migrated = reconcileBuiltInNpcRegistry({
      definitions: [v4Definition],
      strategyProfiles: [v4Profile],
    })

    expect(migrated.strategyProfiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: v4Profile.id, version: 4 }),
      expect.objectContaining({ id: v5Profile.id, version: 5 }),
    ]))
    expect(migrated.definitions.find((definition) => definition.id === v4Definition.id)).toEqual(expect.objectContaining({
      name: 'Stored Maven name',
      strategyProfileId: v5Profile.id,
    }))
  })

  it('keeps archived v4 strategy snapshots readable without upgrading them', () => {
    const archived = structuredClone(LOCAL_NPC_STRATEGY_PROFILES[1])
    archived.id = archived.id.replace('-v5', '-v4')
    archived.version = 4

    expect(normalizeStrategyProfile(JSON.parse(JSON.stringify(archived)))).toEqual(expect.objectContaining({
      id: archived.id,
      version: 4,
    }))
  })
})

function requireBuiltInProfile() {
  return normalizeStrategyProfile({
    id: 'strategy-teaching-fixture-v1',
    version: 1,
    name: 'Teaching fixture',
    status: 'draft',
    difficulty: 'steady',
    modules: [],
    policyConfig: {
      preflopAggression: 0.5,
      preflopLooseness: 0.5,
      postflopAggression: 0.5,
      pressureRaiseMultiplier: 2.5,
    },
  })
}
