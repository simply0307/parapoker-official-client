import type {
  ArchivedHandRecord,
  ArchivedSessionDetail,
  ArchivedSessionRecord,
  CreateArchiveSessionInput,
  FinalizeArchiveSessionInput,
  HandHistoryArchiveStatus,
  HandHistoryArchiveStore,
  SeatPrivateHandArchive,
} from './handHistoryArchive'
import {
  createArchivedSessionRecord,
  HAND_HISTORY_ARCHIVE_DB_NAME,
  HAND_HISTORY_ARCHIVE_DB_VERSION,
  sanitizeArchivedSessionForPublicList,
} from './handHistoryArchive'

type ImportStatus = Extract<HandHistoryArchiveStatus, 'export-ready' | 'imported' | 'import-failed'>

export class InMemoryHandHistoryArchiveStore implements HandHistoryArchiveStore {
  private readonly sessions = new Map<string, ArchivedSessionRecord>()
  private readonly hands = new Map<string, ArchivedHandRecord>()
  private readonly privateHands = new Map<string, SeatPrivateHandArchive>()

  async createActiveSession(input: CreateArchiveSessionInput): Promise<ArchivedSessionRecord> {
    const record = createArchivedSessionRecord(input)
    this.sessions.set(record.matchId, clone(record))
    return clone(record)
  }

  async upsertCompletedHand(hand: ArchivedHandRecord): Promise<void> {
    this.hands.set(handKey(hand.matchId, hand.handNumber), clone(hand))
    await this.updateHandCount(hand.matchId)
  }

  async upsertSeatPrivateHand(privateHand: SeatPrivateHandArchive): Promise<void> {
    this.privateHands.set(privateHandKey(privateHand.matchId, privateHand.seatId, privateHand.handNumber), clone(privateHand))
  }

  async finalizeCompletedSession(input: FinalizeArchiveSessionInput): Promise<ArchivedSessionRecord> {
    const session = this.requireSession(input.matchId)
    const updated: ArchivedSessionRecord = {
      ...session,
      status: 'export-ready',
      importStatus: 'export-ready',
      completedAt: input.completedAt ?? new Date().toISOString(),
      packageChecksum: input.publicPackage.integrity.checksum,
      resultSummary: sanitizeSummary(input.summary),
      publicPackage: clone(input.publicPackage),
    }
    this.sessions.set(input.matchId, updated)
    return clone(updated)
  }

  async listArchivedSessions(): Promise<ArchivedSessionRecord[]> {
    return clone(
      Array.from(this.sessions.values())
        .map(sanitizeArchivedSessionForPublicList)
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
    )
  }

  async readArchivedSession(matchId: string): Promise<ArchivedSessionDetail | undefined> {
    const session = this.sessions.get(matchId)
    if (!session) {
      return undefined
    }
    return {
      session: clone(session),
      hands: clone(this.handsForMatch(matchId)),
      privateHands: clone(this.privateHandsForMatch(matchId)),
    }
  }

  async deleteArchivedSession(matchId: string): Promise<void> {
    this.sessions.delete(matchId)
    for (const key of Array.from(this.hands.keys())) {
      if (key.startsWith(`${matchId}:`)) {
        this.hands.delete(key)
      }
    }
    for (const key of Array.from(this.privateHands.keys())) {
      if (key.startsWith(`${matchId}:`)) {
        this.privateHands.delete(key)
      }
    }
  }

  async updateImportStatus(matchId: string, status: ImportStatus): Promise<ArchivedSessionRecord> {
    const session = this.requireSession(matchId)
    const updated = {
      ...session,
      status,
      importStatus: status,
    }
    this.sessions.set(matchId, updated)
    return clone(updated)
  }

  private async updateHandCount(matchId: string): Promise<void> {
    const session = this.sessions.get(matchId)
    if (!session) {
      return
    }
    this.sessions.set(matchId, {
      ...session,
      handCount: this.handsForMatch(matchId).length,
    })
  }

  private handsForMatch(matchId: string): ArchivedHandRecord[] {
    return Array.from(this.hands.values())
      .filter((hand) => hand.matchId === matchId)
      .sort((left, right) => left.handNumber - right.handNumber)
  }

  private privateHandsForMatch(matchId: string): SeatPrivateHandArchive[] {
    return Array.from(this.privateHands.values())
      .filter((hand) => hand.matchId === matchId)
      .sort((left, right) => left.handNumber - right.handNumber || left.seatId.localeCompare(right.seatId))
  }

  private requireSession(matchId: string): ArchivedSessionRecord {
    const session = this.sessions.get(matchId)
    if (!session) {
      throw new Error(`Unknown archived session ${matchId}.`)
    }
    return session
  }
}

const memoryFallbacks = new Map<string, InMemoryHandHistoryArchiveStore>()

export class IndexedDbHandHistoryArchiveStore implements HandHistoryArchiveStore {
  private readonly databaseName: string
  private readonly fallback?: InMemoryHandHistoryArchiveStore

  constructor(databaseName = HAND_HISTORY_ARCHIVE_DB_NAME) {
    this.databaseName = databaseName
    if (!globalThis.indexedDB) {
      const existing = memoryFallbacks.get(databaseName) ?? new InMemoryHandHistoryArchiveStore()
      memoryFallbacks.set(databaseName, existing)
      this.fallback = existing
    }
  }

  async createActiveSession(input: CreateArchiveSessionInput): Promise<ArchivedSessionRecord> {
    if (this.fallback) {
      return this.fallback.createActiveSession(input)
    }
    const record = createArchivedSessionRecord(input)
    await this.put('sessions', record)
    return clone(record)
  }

  async upsertCompletedHand(hand: ArchivedHandRecord): Promise<void> {
    if (this.fallback) {
      return this.fallback.upsertCompletedHand(hand)
    }
    await this.put('hands', hand)
    await this.refreshHandCount(hand.matchId)
  }

  async upsertSeatPrivateHand(privateHand: SeatPrivateHandArchive): Promise<void> {
    if (this.fallback) {
      return this.fallback.upsertSeatPrivateHand(privateHand)
    }
    await this.put('privateHands', privateHand)
  }

  async finalizeCompletedSession(input: FinalizeArchiveSessionInput): Promise<ArchivedSessionRecord> {
    if (this.fallback) {
      return this.fallback.finalizeCompletedSession(input)
    }
    const session = await this.getSession(input.matchId)
    if (!session) {
      throw new Error(`Unknown archived session ${input.matchId}.`)
    }
    const updated: ArchivedSessionRecord = {
      ...session,
      status: 'export-ready',
      importStatus: 'export-ready',
      completedAt: input.completedAt ?? new Date().toISOString(),
      packageChecksum: input.publicPackage.integrity.checksum,
      resultSummary: sanitizeSummary(input.summary),
      publicPackage: clone(input.publicPackage),
    }
    await this.put('sessions', updated)
    return clone(updated)
  }

  async listArchivedSessions(): Promise<ArchivedSessionRecord[]> {
    if (this.fallback) {
      return this.fallback.listArchivedSessions()
    }
    const sessions = await this.getAll<ArchivedSessionRecord>('sessions')
    return clone(sessions.map(sanitizeArchivedSessionForPublicList).sort((left, right) => right.startedAt.localeCompare(left.startedAt)))
  }

  async readArchivedSession(matchId: string): Promise<ArchivedSessionDetail | undefined> {
    if (this.fallback) {
      return this.fallback.readArchivedSession(matchId)
    }
    const session = await this.getSession(matchId)
    if (!session) {
      return undefined
    }
    const [hands, privateHands] = await Promise.all([
      this.getAllByIndex<ArchivedHandRecord>('hands', 'matchId', matchId),
      this.getAllByIndex<SeatPrivateHandArchive>('privateHands', 'matchId', matchId),
    ])
    return {
      session: clone(session),
      hands: clone(hands.sort((left, right) => left.handNumber - right.handNumber)),
      privateHands: clone(privateHands.sort((left, right) => left.handNumber - right.handNumber || left.seatId.localeCompare(right.seatId))),
    }
  }

  async deleteArchivedSession(matchId: string): Promise<void> {
    if (this.fallback) {
      return this.fallback.deleteArchivedSession(matchId)
    }
    const detail = await this.readArchivedSession(matchId)
    if (!detail) {
      return
    }
    const db = await this.open()
    await transaction(db, ['sessions', 'hands', 'privateHands'], 'readwrite', (stores) => {
      stores.sessions.delete(matchId)
      for (const hand of detail.hands) {
        stores.hands.delete(handKey(hand.matchId, hand.handNumber))
      }
      for (const privateHand of detail.privateHands) {
        stores.privateHands.delete(privateHandKey(privateHand.matchId, privateHand.seatId, privateHand.handNumber))
      }
    })
    db.close()
  }

  async updateImportStatus(matchId: string, status: ImportStatus): Promise<ArchivedSessionRecord> {
    if (this.fallback) {
      return this.fallback.updateImportStatus(matchId, status)
    }
    const session = await this.getSession(matchId)
    if (!session) {
      throw new Error(`Unknown archived session ${matchId}.`)
    }
    const updated: ArchivedSessionRecord = {
      ...session,
      status,
      importStatus: status,
    }
    await this.put('sessions', updated)
    return clone(updated)
  }

  private async refreshHandCount(matchId: string): Promise<void> {
    const session = await this.getSession(matchId)
    if (!session) {
      return
    }
    const hands = await this.getAllByIndex<ArchivedHandRecord>('hands', 'matchId', matchId)
    await this.put('sessions', { ...session, handCount: hands.length })
  }

  private async getSession(matchId: string): Promise<ArchivedSessionRecord | undefined> {
    return this.get<ArchivedSessionRecord>('sessions', matchId)
  }

  private async put(storeName: StoreName, value: unknown): Promise<void> {
    const db = await this.open()
    await transaction(db, [storeName], 'readwrite', (stores) => {
      stores[storeName].put(withStoreKey(storeName, value))
    })
    db.close()
  }

  private async get<T>(storeName: StoreName, key: IDBValidKey): Promise<T | undefined> {
    const db = await this.open()
    const value = await transaction<T | undefined>(db, [storeName], 'readonly', (stores, resolve, reject) => {
      const request = stores[storeName].get(key)
      request.onsuccess = () => resolve(request.result as T | undefined)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB get failed.'))
    })
    db.close()
    return value ? clone(value) : undefined
  }

  private async getAll<T>(storeName: StoreName): Promise<T[]> {
    const db = await this.open()
    const values = await transaction<T[]>(db, [storeName], 'readonly', (stores, resolve, reject) => {
      const request = stores[storeName].getAll()
      request.onsuccess = () => resolve(request.result as T[])
      request.onerror = () => reject(request.error ?? new Error('IndexedDB getAll failed.'))
    })
    db.close()
    return clone(values)
  }

  private async getAllByIndex<T>(storeName: StoreName, indexName: string, key: IDBValidKey): Promise<T[]> {
    const db = await this.open()
    const values = await transaction<T[]>(db, [storeName], 'readonly', (stores, resolve, reject) => {
      const request = stores[storeName].index(indexName).getAll(key)
      request.onsuccess = () => resolve(request.result as T[])
      request.onerror = () => reject(request.error ?? new Error('IndexedDB index getAll failed.'))
    })
    db.close()
    return clone(values)
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, HAND_HISTORY_ARCHIVE_DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'matchId' })
        }
        if (!db.objectStoreNames.contains('hands')) {
          const store = db.createObjectStore('hands', { keyPath: 'archiveKey' })
          store.createIndex('matchId', 'matchId', { unique: false })
        }
        if (!db.objectStoreNames.contains('privateHands')) {
          const store = db.createObjectStore('privateHands', { keyPath: 'archiveKey' })
          store.createIndex('matchId', 'matchId', { unique: false })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed.'))
    })
  }
}

type StoreName = 'sessions' | 'hands' | 'privateHands'

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
      sessions: storeNames.includes('sessions') ? tx.objectStore('sessions') : undefined,
      hands: storeNames.includes('hands') ? tx.objectStore('hands') : undefined,
      privateHands: storeNames.includes('privateHands') ? tx.objectStore('privateHands') : undefined,
    } as Record<StoreName, IDBObjectStore>
    tx.oncomplete = () => resolve(undefined as TResult)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'))
    callback(stores, resolve, reject)
  })
}

function withStoreKey(storeName: StoreName, value: unknown): unknown {
  if (storeName === 'hands') {
    const hand = value as ArchivedHandRecord
    return { ...hand, archiveKey: handKey(hand.matchId, hand.handNumber) }
  }
  if (storeName === 'privateHands') {
    const privateHand = value as SeatPrivateHandArchive
    return { ...privateHand, archiveKey: privateHandKey(privateHand.matchId, privateHand.seatId, privateHand.handNumber) }
  }
  return value
}

function handKey(matchId: string, handNumber: number): string {
  return `${matchId}:hand:${handNumber}`
}

function privateHandKey(matchId: string, seatId: string, handNumber: number): string {
  return `${matchId}:seat:${seatId}:hand:${handNumber}`
}

function sanitizeSummary(summary: FinalizeArchiveSessionInput['summary']): ArchivedSessionRecord['resultSummary'] {
  const { seed: _seed, ...publicSummary } = summary
  return clone(publicSummary)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
