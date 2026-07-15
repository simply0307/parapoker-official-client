import type { GameBlueprint } from './gameBlueprint'

export const GAME_BLUEPRINT_DB_NAME = 'parapoker-game-blueprints'
export const GAME_BLUEPRINT_DB_VERSION = 1
export const GAME_BLUEPRINT_RECORD_SCHEMA_VERSION = 'para-game-blueprint-record-v1' as const
export const LOBBY_TABLE_INSTANCE_SCHEMA_VERSION = 'para-lobby-table-instance-v1' as const

export type GameBlueprintRecordStatus = 'draft' | 'open' | 'retired'
export type LobbyTableStatus = 'draft' | 'open' | 'running' | 'cancelled' | 'closed'

export interface GameBlueprintRecord {
  schemaVersion: typeof GAME_BLUEPRINT_RECORD_SCHEMA_VERSION
  blueprint: GameBlueprint
  status: GameBlueprintRecordStatus
  createdAt: string
  updatedAt: string
}

export interface LobbyTableInstance {
  schemaVersion: typeof LOBBY_TABLE_INSTANCE_SCHEMA_VERSION
  tableId: string
  blueprintId: string
  blueprintVersion: number
  blueprint: GameBlueprint
  resolvedSeed: string | number
  status: LobbyTableStatus
  createdAt: string
  updatedAt: string
  openedAt?: string
  cancelledAt?: string
  closedAt?: string
  closeReason?: string
}

export interface GameBlueprintStoreSnapshot {
  blueprints: GameBlueprintRecord[]
  lobbyTables: LobbyTableInstance[]
}

export interface GameBlueprintStore {
  listBlueprints(): Promise<GameBlueprintRecord[]>
  listLobbyTables(): Promise<LobbyTableInstance[]>
  upsertBlueprint(blueprint: GameBlueprint, status?: GameBlueprintRecordStatus): Promise<GameBlueprintRecord>
  retireBlueprint(blueprintId: string): Promise<GameBlueprintRecord>
  createLobbyTable(blueprint: GameBlueprint, status?: Extract<LobbyTableStatus, 'draft' | 'open'>): Promise<LobbyTableInstance>
  startLobbyTable(tableId: string): Promise<LobbyTableInstance>
  cancelLobbyTable(tableId: string, reason?: string): Promise<LobbyTableInstance>
  closeLobbyTable(tableId: string, reason?: string): Promise<LobbyTableInstance>
  snapshot(): Promise<GameBlueprintStoreSnapshot>
}

export class InMemoryGameBlueprintStore implements GameBlueprintStore {
  private readonly blueprints = new Map<string, GameBlueprintRecord>()
  private readonly lobbyTables = new Map<string, LobbyTableInstance>()
  private readonly createRandomSeed: () => string

  constructor(
    initial: Partial<GameBlueprintStoreSnapshot> = {},
    createRandomSeed: () => string = createRandomGameSeed,
  ) {
    this.createRandomSeed = createRandomSeed
    for (const record of initial.blueprints ?? []) {
      this.blueprints.set(record.blueprint.id, clone(record))
    }
    for (const table of initial.lobbyTables ?? []) {
      this.lobbyTables.set(table.tableId, clone(table))
    }
  }

  async listBlueprints(): Promise<GameBlueprintRecord[]> {
    return clone([...this.blueprints.values()].sort(compareBlueprintRecords))
  }

  async listLobbyTables(): Promise<LobbyTableInstance[]> {
    return clone([...this.lobbyTables.values()].sort(compareLobbyTables))
  }

  async upsertBlueprint(blueprint: GameBlueprint, status: GameBlueprintRecordStatus = 'draft'): Promise<GameBlueprintRecord> {
    const normalized = normalizeGameBlueprint(blueprint)
    const existing = this.blueprints.get(normalized.id)
    const now = new Date().toISOString()
    const record: GameBlueprintRecord = {
      schemaVersion: GAME_BLUEPRINT_RECORD_SCHEMA_VERSION,
      blueprint: normalized,
      status,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    this.blueprints.set(normalized.id, clone(record))
    return clone(record)
  }

  async retireBlueprint(blueprintId: string): Promise<GameBlueprintRecord> {
    const existing = this.blueprints.get(blueprintId)
    if (!existing) {
      throw new Error(`Unknown game blueprint: ${blueprintId}`)
    }
    return this.upsertBlueprint(existing.blueprint, 'retired')
  }

  async createLobbyTable(
    blueprint: GameBlueprint,
    status: Extract<LobbyTableStatus, 'draft' | 'open'> = 'open',
  ): Promise<LobbyTableInstance> {
    const normalized = normalizeGameBlueprint(blueprint)
    await this.upsertBlueprint(normalized, status === 'open' ? 'open' : 'draft')
    const now = new Date().toISOString()
    const table: LobbyTableInstance = {
      schemaVersion: LOBBY_TABLE_INSTANCE_SCHEMA_VERSION,
      tableId: createTableId(normalized, now, this.lobbyTables.size),
      blueprintId: normalized.id,
      blueprintVersion: normalized.version,
      blueprint: clone(normalized),
      resolvedSeed: resolveGameBlueprintSeed(normalized, this.createRandomSeed),
      status,
      createdAt: now,
      updatedAt: now,
      ...(status === 'open' ? { openedAt: now } : {}),
    }
    this.lobbyTables.set(table.tableId, clone(table))
    return clone(table)
  }

  async cancelLobbyTable(tableId: string, reason = 'operator-cancelled'): Promise<LobbyTableInstance> {
    const existing = this.lobbyTables.get(tableId)
    if (!existing) {
      throw new Error(`Unknown lobby table: ${tableId}`)
    }
    if (existing.status === 'closed') {
      throw new Error(`Closed lobby table cannot be cancelled: ${tableId}`)
    }
    const now = new Date().toISOString()
    const cancelled: LobbyTableInstance = {
      ...existing,
      status: 'cancelled',
      updatedAt: now,
      cancelledAt: now,
      closeReason: reason,
    }
    this.lobbyTables.set(tableId, clone(cancelled))
    return clone(cancelled)
  }

  async startLobbyTable(tableId: string): Promise<LobbyTableInstance> {
    const existing = this.lobbyTables.get(tableId)
    if (!existing) {
      throw new Error(`Unknown lobby table: ${tableId}`)
    }
    if (existing.status === 'running') {
      return clone(existing)
    }
    if (existing.status !== 'open') {
      throw new Error(`Only an open lobby table can start: ${tableId}`)
    }
    const running: LobbyTableInstance = {
      ...existing,
      status: 'running',
      updatedAt: new Date().toISOString(),
    }
    this.lobbyTables.set(tableId, clone(running))
    return clone(running)
  }

  async closeLobbyTable(tableId: string, reason = 'match-complete'): Promise<LobbyTableInstance> {
    const existing = this.lobbyTables.get(tableId)
    if (!existing) {
      throw new Error(`Unknown lobby table: ${tableId}`)
    }
    if (existing.status === 'closed') {
      return clone(existing)
    }
    const now = new Date().toISOString()
    const closed: LobbyTableInstance = {
      ...existing,
      status: 'closed',
      updatedAt: now,
      closedAt: now,
      closeReason: reason,
    }
    this.lobbyTables.set(tableId, clone(closed))
    return clone(closed)
  }

  async snapshot(): Promise<GameBlueprintStoreSnapshot> {
    const [blueprints, lobbyTables] = await Promise.all([this.listBlueprints(), this.listLobbyTables()])
    return { blueprints, lobbyTables }
  }
}

const memoryFallbacks = new Map<string, InMemoryGameBlueprintStore>()

export class IndexedDbGameBlueprintStore implements GameBlueprintStore {
  private readonly databaseName: string
  private readonly fallback?: InMemoryGameBlueprintStore
  private readonly createRandomSeed: () => string

  constructor(databaseName = GAME_BLUEPRINT_DB_NAME, createRandomSeed: () => string = createRandomGameSeed) {
    this.databaseName = databaseName
    this.createRandomSeed = createRandomSeed
    if (!globalThis.indexedDB) {
      const existing = memoryFallbacks.get(databaseName) ?? new InMemoryGameBlueprintStore({}, createRandomSeed)
      memoryFallbacks.set(databaseName, existing)
      this.fallback = existing
    }
  }

  async listBlueprints(): Promise<GameBlueprintRecord[]> {
    if (this.fallback) {
      return this.fallback.listBlueprints()
    }
    return clone((await this.getAll<GameBlueprintRecord>('blueprints')).sort(compareBlueprintRecords))
  }

  async listLobbyTables(): Promise<LobbyTableInstance[]> {
    if (this.fallback) {
      return this.fallback.listLobbyTables()
    }
    return clone((await this.getAll<LobbyTableInstance>('lobbyTables')).sort(compareLobbyTables))
  }

  async upsertBlueprint(blueprint: GameBlueprint, status: GameBlueprintRecordStatus = 'draft'): Promise<GameBlueprintRecord> {
    if (this.fallback) {
      return this.fallback.upsertBlueprint(blueprint, status)
    }
    const normalized = normalizeGameBlueprint(blueprint)
    const existing = (await this.listBlueprints()).find((record) => record.blueprint.id === normalized.id)
    const now = new Date().toISOString()
    const record: GameBlueprintRecord = {
      schemaVersion: GAME_BLUEPRINT_RECORD_SCHEMA_VERSION,
      blueprint: normalized,
      status,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await this.put('blueprints', record)
    return clone(record)
  }

  async retireBlueprint(blueprintId: string): Promise<GameBlueprintRecord> {
    const existing = (await this.listBlueprints()).find((record) => record.blueprint.id === blueprintId)
    if (!existing) {
      throw new Error(`Unknown game blueprint: ${blueprintId}`)
    }
    return this.upsertBlueprint(existing.blueprint, 'retired')
  }

  async createLobbyTable(
    blueprint: GameBlueprint,
    status: Extract<LobbyTableStatus, 'draft' | 'open'> = 'open',
  ): Promise<LobbyTableInstance> {
    if (this.fallback) {
      return this.fallback.createLobbyTable(blueprint, status)
    }
    const normalized = normalizeGameBlueprint(blueprint)
    await this.upsertBlueprint(normalized, status === 'open' ? 'open' : 'draft')
    const existingTables = await this.listLobbyTables()
    const now = new Date().toISOString()
    const table: LobbyTableInstance = {
      schemaVersion: LOBBY_TABLE_INSTANCE_SCHEMA_VERSION,
      tableId: createTableId(normalized, now, existingTables.length),
      blueprintId: normalized.id,
      blueprintVersion: normalized.version,
      blueprint: clone(normalized),
      resolvedSeed: resolveGameBlueprintSeed(normalized, this.createRandomSeed),
      status,
      createdAt: now,
      updatedAt: now,
      ...(status === 'open' ? { openedAt: now } : {}),
    }
    await this.put('lobbyTables', table)
    return clone(table)
  }

  async cancelLobbyTable(tableId: string, reason = 'operator-cancelled'): Promise<LobbyTableInstance> {
    if (this.fallback) {
      return this.fallback.cancelLobbyTable(tableId, reason)
    }
    const existing = (await this.listLobbyTables()).find((table) => table.tableId === tableId)
    if (!existing) {
      throw new Error(`Unknown lobby table: ${tableId}`)
    }
    if (existing.status === 'closed') {
      throw new Error(`Closed lobby table cannot be cancelled: ${tableId}`)
    }
    const now = new Date().toISOString()
    const cancelled: LobbyTableInstance = {
      ...existing,
      status: 'cancelled',
      updatedAt: now,
      cancelledAt: now,
      closeReason: reason,
    }
    await this.put('lobbyTables', cancelled)
    return clone(cancelled)
  }

  async startLobbyTable(tableId: string): Promise<LobbyTableInstance> {
    if (this.fallback) {
      return this.fallback.startLobbyTable(tableId)
    }
    const existing = (await this.listLobbyTables()).find((table) => table.tableId === tableId)
    if (!existing) {
      throw new Error(`Unknown lobby table: ${tableId}`)
    }
    if (existing.status === 'running') {
      return clone(existing)
    }
    if (existing.status !== 'open') {
      throw new Error(`Only an open lobby table can start: ${tableId}`)
    }
    const running: LobbyTableInstance = {
      ...existing,
      status: 'running',
      updatedAt: new Date().toISOString(),
    }
    await this.put('lobbyTables', running)
    return clone(running)
  }

  async closeLobbyTable(tableId: string, reason = 'match-complete'): Promise<LobbyTableInstance> {
    if (this.fallback) {
      return this.fallback.closeLobbyTable(tableId, reason)
    }
    const existing = (await this.listLobbyTables()).find((table) => table.tableId === tableId)
    if (!existing) {
      throw new Error(`Unknown lobby table: ${tableId}`)
    }
    if (existing.status === 'closed') {
      return clone(existing)
    }
    const now = new Date().toISOString()
    const closed: LobbyTableInstance = {
      ...existing,
      status: 'closed',
      updatedAt: now,
      closedAt: now,
      closeReason: reason,
    }
    await this.put('lobbyTables', closed)
    return clone(closed)
  }

  async snapshot(): Promise<GameBlueprintStoreSnapshot> {
    const [blueprints, lobbyTables] = await Promise.all([this.listBlueprints(), this.listLobbyTables()])
    return { blueprints, lobbyTables }
  }

  private async put(storeName: StoreName, value: GameBlueprintRecord | LobbyTableInstance): Promise<void> {
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
      request.onerror = () => reject(request.error ?? new Error('IndexedDB game blueprint getAll failed.'))
    })
    db.close()
    return clone(values)
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, GAME_BLUEPRINT_DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('blueprints')) {
          db.createObjectStore('blueprints', { keyPath: 'blueprint.id' })
        }
        if (!db.objectStoreNames.contains('lobbyTables')) {
          db.createObjectStore('lobbyTables', { keyPath: 'tableId' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB game blueprint open failed.'))
    })
  }
}

export function normalizeGameBlueprint(blueprint: GameBlueprint): GameBlueprint {
  const id = blueprint.id.trim()
  const name = blueprint.name.trim()
  if (!id) {
    throw new Error('Game blueprint requires an id.')
  }
  if (!name) {
    throw new Error('Game blueprint requires a name.')
  }
  if (!Number.isInteger(blueprint.version) || blueprint.version < 1) {
    throw new Error('Game blueprint version must be a positive integer.')
  }
  if (!Number.isInteger(blueprint.startingStack) || blueprint.startingStack <= 0) {
    throw new Error('Game blueprint starting stack must be positive.')
  }
  if (!Number.isInteger(blueprint.smallBlind) || blueprint.smallBlind <= 0) {
    throw new Error('Game blueprint small blind must be positive.')
  }
  if (!Number.isInteger(blueprint.bigBlind) || blueprint.bigBlind <= blueprint.smallBlind) {
    throw new Error('Game blueprint big blind must be greater than the small blind.')
  }
  const seedPolicy = blueprint.seedPolicy ?? 'fixed'
  if (seedPolicy !== 'fixed' && seedPolicy !== 'random') {
    throw new Error('Game blueprint seed policy must be fixed or random.')
  }
  if (seedPolicy === 'fixed' && String(blueprint.seed).trim() === '') {
    throw new Error('Game blueprint seed is required.')
  }
  const expectedSeatCount = blueprint.mode === 'heads-up' ? 2 : 6
  if (blueprint.seats.length !== expectedSeatCount) {
    throw new Error(`${blueprint.mode} blueprint requires ${expectedSeatCount} seats.`)
  }
  const seatIds = new Set<string>()
  for (const seat of blueprint.seats) {
    if (seatIds.has(seat.seatId)) {
      throw new Error(`Duplicate blueprint seat: ${seat.seatId}`)
    }
    seatIds.add(seat.seatId)
    if (seat.kind === 'npc' && !seat.npcDefinitionId) {
      throw new Error(`NPC seat requires npcDefinitionId: ${seat.seatId}`)
    }
    if (seat.kind === 'human' && !seat.displayName?.trim()) {
      throw new Error(`Human seat requires displayName: ${seat.seatId}`)
    }
  }
  return clone({
    ...blueprint,
    id,
    name,
    seedPolicy,
    seats: blueprint.seats.map((seat) => ({
      ...seat,
      displayName: seat.displayName?.trim(),
    })),
  })
}

export function resolveGameBlueprintSeed(
  blueprint: GameBlueprint,
  createRandomSeed: () => string = createRandomGameSeed,
): string | number {
  return (blueprint.seedPolicy ?? 'fixed') === 'random' ? createRandomSeed() : blueprint.seed
}

let fallbackSeedSequence = 0

export function createRandomGameSeed(): string {
  if (globalThis.crypto?.randomUUID) {
    return `table-${globalThis.crypto.randomUUID()}`
  }
  if (globalThis.crypto?.getRandomValues) {
    const values = globalThis.crypto.getRandomValues(new Uint32Array(4))
    return `table-${[...values].map((value) => value.toString(16).padStart(8, '0')).join('')}`
  }
  fallbackSeedSequence += 1
  return `table-${Date.now()}-${fallbackSeedSequence}`
}

type StoreName = 'blueprints' | 'lobbyTables'

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
      blueprints: storeNames.includes('blueprints') ? tx.objectStore('blueprints') : undefined,
      lobbyTables: storeNames.includes('lobbyTables') ? tx.objectStore('lobbyTables') : undefined,
    } as Record<StoreName, IDBObjectStore>
    tx.oncomplete = () => resolve(undefined as TResult)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB game blueprint transaction failed.'))
    callback(stores, resolve, reject)
  })
}

function createTableId(blueprint: GameBlueprint, createdAt: string, index: number): string {
  return `${blueprint.id}-table-${createdAt.replace(/[^0-9]/g, '')}-${index + 1}`
}

function compareBlueprintRecords(left: GameBlueprintRecord, right: GameBlueprintRecord): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.blueprint.name.localeCompare(right.blueprint.name)
}

function compareLobbyTables(left: LobbyTableInstance, right: LobbyTableInstance): number {
  return right.createdAt.localeCompare(left.createdAt) || left.tableId.localeCompare(right.tableId)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
