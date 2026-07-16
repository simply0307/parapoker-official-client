import type { NpcDefinition, NpcDefinitionStatus, NpcStrategyProfile } from './config'
import { validatePostflopStrategy } from './postflopStrategy'
import { validatePreflopStrategy } from './preflopRanges'
import { LOCAL_NPC_DEFINITIONS, LOCAL_NPC_STRATEGY_PROFILES } from './roster'

export const NPC_REGISTRY_DB_NAME = 'parapoker-npc-registry'
export const NPC_REGISTRY_DB_VERSION = 1

export interface NpcRegistrySnapshot {
  definitions: NpcDefinition[]
  strategyProfiles: NpcStrategyProfile[]
}

export interface NpcDefinitionDraft {
  id: string
  name: string
  archetypeLabel: string
  description?: string
  avatarKey?: string
  strategyProfileId: string
  status: NpcDefinitionStatus
}

export interface NpcRegistryStore {
  listDefinitions(): Promise<NpcDefinition[]>
  listStrategyProfiles(): Promise<NpcStrategyProfile[]>
  upsertDefinition(definition: NpcDefinitionDraft): Promise<NpcDefinition>
  upsertStrategyProfile(profile: NpcStrategyProfile): Promise<NpcStrategyProfile>
  createStrategyProfileVersion(sourceProfileId: string, profile: NpcStrategyProfile): Promise<NpcStrategyProfile>
  retireDefinition(npcDefinitionId: string): Promise<NpcDefinition>
  snapshot(): Promise<NpcRegistrySnapshot>
}

export class InMemoryNpcRegistryStore implements NpcRegistryStore {
  private readonly definitions = new Map<string, NpcDefinition>()
  private readonly strategyProfiles = new Map<string, NpcStrategyProfile>()

  constructor(initial: Partial<NpcRegistrySnapshot> = {}) {
    for (const profile of initial.strategyProfiles ?? LOCAL_NPC_STRATEGY_PROFILES) {
      this.strategyProfiles.set(profile.id, clone(profile))
    }
    for (const definition of initial.definitions ?? LOCAL_NPC_DEFINITIONS) {
      this.definitions.set(definition.id, clone(definition))
    }
  }

  async listDefinitions(): Promise<NpcDefinition[]> {
    return clone([...this.definitions.values()].sort((left, right) => left.name.localeCompare(right.name)))
  }

  async listStrategyProfiles(): Promise<NpcStrategyProfile[]> {
    return clone([...this.strategyProfiles.values()].sort(compareStrategyProfiles))
  }

  async upsertDefinition(definition: NpcDefinitionDraft): Promise<NpcDefinition> {
    const normalized = normalizeNpcDefinition(definition, await this.listStrategyProfiles())
    this.definitions.set(normalized.id, clone(normalized))
    return clone(normalized)
  }

  async upsertStrategyProfile(profile: NpcStrategyProfile): Promise<NpcStrategyProfile> {
    const normalized = normalizeStrategyProfile(profile)
    this.strategyProfiles.set(normalized.id, clone(normalized))
    return clone(normalized)
  }

  async createStrategyProfileVersion(
    sourceProfileId: string,
    profile: NpcStrategyProfile,
  ): Promise<NpcStrategyProfile> {
    const source = this.strategyProfiles.get(sourceProfileId)
    if (!source) {
      throw new Error(`Unknown source strategy profile: ${sourceProfileId}`)
    }
    if (this.strategyProfiles.has(profile.id)) {
      throw new Error(`NPC strategy profile already exists: ${profile.id}`)
    }
    const normalized = normalizeStrategyProfile(profile)
    if (normalized.version <= source.version) {
      throw new Error('A new NPC strategy profile version must exceed its source version.')
    }
    this.strategyProfiles.set(normalized.id, clone(normalized))
    return clone(normalized)
  }

  async retireDefinition(npcDefinitionId: string): Promise<NpcDefinition> {
    const existing = this.definitions.get(npcDefinitionId)
    if (!existing) {
      throw new Error(`Unknown NPC definition: ${npcDefinitionId}`)
    }
    const retired = { ...existing, status: 'retired' as const }
    this.definitions.set(npcDefinitionId, retired)
    return clone(retired)
  }

  async snapshot(): Promise<NpcRegistrySnapshot> {
    const [definitions, strategyProfiles] = await Promise.all([
      this.listDefinitions(),
      this.listStrategyProfiles(),
    ])
    return { definitions, strategyProfiles }
  }
}

const memoryFallbacks = new Map<string, InMemoryNpcRegistryStore>()

export class IndexedDbNpcRegistryStore implements NpcRegistryStore {
  private readonly databaseName: string
  private readonly fallback?: InMemoryNpcRegistryStore

  constructor(databaseName = NPC_REGISTRY_DB_NAME) {
    this.databaseName = databaseName
    if (!globalThis.indexedDB) {
      const existing = memoryFallbacks.get(databaseName) ?? new InMemoryNpcRegistryStore()
      memoryFallbacks.set(databaseName, existing)
      this.fallback = existing
    }
  }

  async listDefinitions(): Promise<NpcDefinition[]> {
    if (this.fallback) {
      return this.fallback.listDefinitions()
    }
    await this.seedIfEmpty()
    return clone((await this.getAll<NpcDefinition>('definitions')).sort((left, right) => left.name.localeCompare(right.name)))
  }

  async listStrategyProfiles(): Promise<NpcStrategyProfile[]> {
    if (this.fallback) {
      return this.fallback.listStrategyProfiles()
    }
    await this.seedIfEmpty()
    return clone((await this.getAll<NpcStrategyProfile>('strategyProfiles')).sort(compareStrategyProfiles))
  }

  async upsertDefinition(definition: NpcDefinitionDraft): Promise<NpcDefinition> {
    if (this.fallback) {
      return this.fallback.upsertDefinition(definition)
    }
    await this.seedIfEmpty()
    const normalized = normalizeNpcDefinition(definition, await this.listStrategyProfiles())
    await this.put('definitions', normalized)
    return clone(normalized)
  }

  async upsertStrategyProfile(profile: NpcStrategyProfile): Promise<NpcStrategyProfile> {
    if (this.fallback) {
      return this.fallback.upsertStrategyProfile(profile)
    }
    await this.seedIfEmpty()
    const normalized = normalizeStrategyProfile(profile)
    await this.put('strategyProfiles', normalized)
    return clone(normalized)
  }

  async createStrategyProfileVersion(
    sourceProfileId: string,
    profile: NpcStrategyProfile,
  ): Promise<NpcStrategyProfile> {
    if (this.fallback) {
      return this.fallback.createStrategyProfileVersion(sourceProfileId, profile)
    }
    await this.seedIfEmpty()
    const profiles = await this.listStrategyProfiles()
    const source = profiles.find((candidate) => candidate.id === sourceProfileId)
    if (!source) {
      throw new Error(`Unknown source strategy profile: ${sourceProfileId}`)
    }
    if (profiles.some((candidate) => candidate.id === profile.id)) {
      throw new Error(`NPC strategy profile already exists: ${profile.id}`)
    }
    const normalized = normalizeStrategyProfile(profile)
    if (normalized.version <= source.version) {
      throw new Error('A new NPC strategy profile version must exceed its source version.')
    }
    await this.put('strategyProfiles', normalized)
    return clone(normalized)
  }

  async retireDefinition(npcDefinitionId: string): Promise<NpcDefinition> {
    const existing = (await this.listDefinitions()).find((definition) => definition.id === npcDefinitionId)
    if (!existing) {
      throw new Error(`Unknown NPC definition: ${npcDefinitionId}`)
    }
    return this.upsertDefinition({ ...existing, status: 'retired' })
  }

  async snapshot(): Promise<NpcRegistrySnapshot> {
    const [definitions, strategyProfiles] = await Promise.all([
      this.listDefinitions(),
      this.listStrategyProfiles(),
    ])
    return { definitions, strategyProfiles }
  }

  private async seedIfEmpty(): Promise<void> {
    const existingProfiles = await this.getAll<NpcStrategyProfile>('strategyProfiles')
    const existingProfileIds = new Set(existingProfiles.map((profile) => profile.id))
    await Promise.all(
      LOCAL_NPC_STRATEGY_PROFILES
        .filter((profile) => !existingProfileIds.has(profile.id))
        .map((profile) => this.put('strategyProfiles', profile)),
    )
    const existingDefinitions = await this.getAll<NpcDefinition>('definitions')
    if (existingDefinitions.length === 0) {
      await Promise.all(LOCAL_NPC_DEFINITIONS.map((definition) => this.put('definitions', definition)))
    }
  }

  private async put(storeName: StoreName, value: NpcDefinition | NpcStrategyProfile): Promise<void> {
    const db = await this.open()
    await transaction(db, [storeName], 'readwrite', (stores) => {
      stores[storeName].put(clone(value))
    })
    db.close()
  }

  private async getAll<T>(storeName: StoreName): Promise<T[]> {
    const db = await this.open()
    const values = await transaction<T[]>(db, [storeName], 'readonly', (stores, resolve, reject) => {
      const request = stores[storeName].getAll()
      request.onsuccess = () => resolve(request.result as T[])
      request.onerror = () => reject(request.error ?? new Error('IndexedDB NPC registry getAll failed.'))
    })
    db.close()
    return clone(values)
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, NPC_REGISTRY_DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('definitions')) {
          db.createObjectStore('definitions', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('strategyProfiles')) {
          db.createObjectStore('strategyProfiles', { keyPath: 'id' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB NPC registry open failed.'))
    })
  }
}

export function normalizeNpcDefinition(
  definition: NpcDefinitionDraft,
  strategyProfiles: readonly NpcStrategyProfile[],
): NpcDefinition {
  const id = definition.id.trim()
  const name = definition.name.trim()
  const archetypeLabel = definition.archetypeLabel.trim()
  if (!id) {
    throw new Error('NPC definition requires an id.')
  }
  if (!name) {
    throw new Error('NPC definition requires a name.')
  }
  if (!archetypeLabel) {
    throw new Error('NPC definition requires an archetype label.')
  }
  if (!strategyProfiles.some((profile) => profile.id === definition.strategyProfileId)) {
    throw new Error(`Unknown strategy profile: ${definition.strategyProfileId}`)
  }
  return {
    id,
    name,
    archetypeLabel,
    ...(definition.description ? { description: definition.description } : {}),
    ...(definition.avatarKey ? { avatarKey: definition.avatarKey } : {}),
    strategyProfileId: definition.strategyProfileId,
    status: definition.status,
  }
}

export function normalizeStrategyProfile(profile: NpcStrategyProfile): NpcStrategyProfile {
  const id = profile.id.trim()
  const name = profile.name.trim()
  if (!id) {
    throw new Error('NPC strategy profile requires an id.')
  }
  if (!name) {
    throw new Error('NPC strategy profile requires a name.')
  }
  if (!Number.isInteger(profile.version) || profile.version < 1) {
    throw new Error('NPC strategy profile version must be a positive integer.')
  }
  if (profile.preflopStrategy) {
    validatePreflopStrategy(profile.preflopStrategy)
  }
  if (profile.postflopStrategy) {
    validatePostflopStrategy(profile.postflopStrategy)
  }
  return clone({
    ...profile,
    id,
    name,
  })
}

type StoreName = 'definitions' | 'strategyProfiles'

function transaction<TResult = void>(
  db: IDBDatabase,
  storeNames: StoreName[],
  mode: IDBTransactionMode,
  callback: (
    stores: Record<StoreName, IDBObjectStore>,
    resolve: (value: TResult) => void,
    reject: (reason?: unknown) => void,
  ) => void,
): Promise<TResult> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode)
    const stores = {
      definitions: storeNames.includes('definitions') ? tx.objectStore('definitions') : undefined,
      strategyProfiles: storeNames.includes('strategyProfiles') ? tx.objectStore('strategyProfiles') : undefined,
    } as Record<StoreName, IDBObjectStore>
    tx.oncomplete = () => resolve(undefined as TResult)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB NPC registry transaction failed.'))
    callback(stores, resolve, reject)
  })
}

function compareStrategyProfiles(left: NpcStrategyProfile, right: NpcStrategyProfile): number {
  return left.name.localeCompare(right.name) || left.version - right.version
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
