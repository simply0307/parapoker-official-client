import type { HandHistoryEvent, SeatId } from '../poker-engine'
import type {
  CommandRecord,
  CommandRecordDraft,
  CommandRecordStore,
  DerivedStatsSnapshot,
  EventPrivacyClass,
  EventRecord,
  EventRecordDraft,
  EventRecordStore,
  HandRecordDraft,
  MatchRecord,
  MatchRecordDraft,
  MatchRecordStore,
  MatchResultDraft,
  NpcProfile,
  PlayerProfile,
  ProfileStore,
  SeatHandHistoryExport,
  StatsStore,
} from './types'

export class InMemoryMatchRecordStore implements MatchRecordStore {
  private readonly matches = new Map<string, MatchRecord>()

  async createMatch(record: MatchRecordDraft): Promise<MatchRecord> {
    const match: MatchRecord = {
      ...clone(record),
      status: 'active',
      hands: [],
    }
    this.matches.set(match.matchId, match)
    return clone(match)
  }

  async appendHand(matchId: string, record: HandRecordDraft): Promise<MatchRecord> {
    const match = this.requireMatch(matchId)
    const updated: MatchRecord = {
      ...match,
      hands: [...match.hands, clone(record)],
    }
    this.matches.set(matchId, updated)
    return clone(updated)
  }

  async completeMatch(matchId: string, result: MatchResultDraft): Promise<MatchRecord> {
    const match = this.requireMatch(matchId)
    const updated: MatchRecord = {
      ...match,
      status: result.status,
      result: clone(result),
    }
    this.matches.set(matchId, updated)
    return clone(updated)
  }

  async getMatch(matchId: string): Promise<MatchRecord | undefined> {
    const match = this.matches.get(matchId)
    return match ? clone(match) : undefined
  }

  private requireMatch(matchId: string): MatchRecord {
    const match = this.matches.get(matchId)
    if (!match) {
      throw new Error(`Unknown match ${matchId}.`)
    }
    return match
  }
}

export class InMemoryEventRecordStore implements EventRecordStore {
  private readonly events: EventRecord[] = []

  async appendEvents(events: EventRecordDraft[]): Promise<void> {
    this.events.push(...events.map(toEventRecord))
    this.events.sort(compareEventRecords)
  }

  async listPublicEvents(matchId: string): Promise<EventRecord[]> {
    return clone(this.eventsForMatch(matchId).filter((record) => record.privacyClass === 'public'))
  }

  async listSeatEvents(matchId: string, seatId: SeatId): Promise<EventRecord[]> {
    return clone(
      this.eventsForMatch(matchId).filter(
        (record) => record.privacyClass === 'public' || record.visibilitySeatId === seatId,
      ),
    )
  }

  async listReplayEvents(matchId: string): Promise<EventRecord[]> {
    return this.listPublicEvents(matchId)
  }

  async exportSeatHandHistory(matchId: string, seatId: SeatId): Promise<SeatHandHistoryExport> {
    const records = await this.listSeatEvents(matchId, seatId)
    return {
      matchId,
      seatId,
      events: records.map((record) => record.event),
    }
  }

  private eventsForMatch(matchId: string): EventRecord[] {
    return this.events.filter((record) => record.matchId === matchId).sort(compareEventRecords)
  }
}

export class InMemoryCommandRecordStore implements CommandRecordStore {
  private readonly commands: CommandRecord[] = []

  async appendCommand(command: CommandRecordDraft): Promise<CommandRecord> {
    const record: CommandRecord = {
      ...clone(command),
      privacyClass: 'tablePrivate',
    }
    this.commands.push(record)
    return clone(record)
  }

  async listCommandsForMatch(matchId: string): Promise<CommandRecord[]> {
    return clone(this.commands.filter((command) => command.matchId === matchId))
  }

  async listRejectedCommands(matchId: string): Promise<CommandRecord[]> {
    return clone(
      this.commands.filter((command) => command.matchId === matchId && command.status === 'rejected'),
    )
  }
}

export class InMemoryProfileStore implements ProfileStore {
  private readonly playerProfiles = new Map<string, PlayerProfile>()
  private readonly npcProfiles = new Map<string, NpcProfile>()

  async upsertPlayerProfile(profile: PlayerProfile): Promise<PlayerProfile> {
    this.playerProfiles.set(profile.playerId, clone(profile))
    return clone(profile)
  }

  async getPlayerProfile(playerId: string): Promise<PlayerProfile | undefined> {
    const profile = this.playerProfiles.get(playerId)
    return profile ? clone(profile) : undefined
  }

  async upsertNpcProfile(profile: NpcProfile): Promise<NpcProfile> {
    this.npcProfiles.set(profile.npcId, clone(profile))
    return clone(profile)
  }

  async getNpcProfile(npcId: string): Promise<NpcProfile | undefined> {
    const profile = this.npcProfiles.get(npcId)
    return profile ? clone(profile) : undefined
  }
}

export class InMemoryStatsStore implements StatsStore {
  private readonly snapshots = new Map<SeatId, DerivedStatsSnapshot>()
  private readonly eventStore: EventRecordStore

  constructor(eventStore: EventRecordStore) {
    this.eventStore = eventStore
  }

  async updateFromVerifiedEvents(matchId: string): Promise<DerivedStatsSnapshot[]> {
    const records = await this.eventStore.listPublicEvents(matchId)
    const snapshots = new Map<SeatId, DerivedStatsSnapshot>()

    function ensureSeat(seatId: SeatId): DerivedStatsSnapshot {
      const existing = snapshots.get(seatId)
      if (existing) {
        return existing
      }
      const created: DerivedStatsSnapshot = {
        matchId,
        seatId,
        handsStarted: 0,
        actions: 0,
        folds: 0,
        checks: 0,
        calls: 0,
        bets: 0,
        raises: 0,
        allIns: 0,
        potsWon: 0,
        chipsWon: 0,
      }
      snapshots.set(seatId, created)
      return created
    }

    for (const record of records) {
      const { event } = record
      if (event.type === 'blindPosted') {
        ensureSeat(event.payload.seatId).handsStarted += 1
      }
      if (event.type === 'actionApplied') {
        const snapshot = ensureSeat(event.payload.seatId)
        snapshot.actions += 1
        switch (event.payload.action) {
          case 'fold':
            snapshot.folds += 1
            break
          case 'check':
            snapshot.checks += 1
            break
          case 'call':
            snapshot.calls += 1
            break
          case 'bet':
            snapshot.bets += 1
            break
          case 'raise':
            snapshot.raises += 1
            break
          case 'allIn':
            snapshot.allIns += 1
            break
        }
      }
      if (event.type === 'potAwarded') {
        for (const winner of event.payload.winners) {
          const snapshot = ensureSeat(winner.seatId)
          snapshot.potsWon += 1
          snapshot.chipsWon += winner.amount
        }
      }
    }

    for (const [seatId, snapshot] of snapshots) {
      this.snapshots.set(seatId, clone(snapshot))
    }

    return clone(Array.from(snapshots.values()).sort((left, right) => left.seatId.localeCompare(right.seatId)))
  }

  async getPlayerStats(seatId: SeatId): Promise<DerivedStatsSnapshot | undefined> {
    const snapshot = this.snapshots.get(seatId)
    return snapshot ? clone(snapshot) : undefined
  }
}

export function createEventRecordDrafts(
  matchId: string,
  tableId: string,
  events: HandHistoryEvent[],
): EventRecordDraft[] {
  return events.map((event) => ({
    matchId,
    tableId,
    event,
  }))
}

export function createCommandRecordDraft(command: CommandRecordDraft): CommandRecordDraft {
  return clone(command)
}

function toEventRecord(draft: EventRecordDraft): EventRecord {
  const event = clone(draft.event)
  const visibilitySeatId = event.visibility === 'public' ? undefined : event.visibility
  return {
    matchId: draft.matchId,
    tableId: draft.tableId,
    event,
    eventId: event.eventId,
    handId: event.handId,
    sequenceNumber: event.sequenceNumber,
    visibility: event.visibility,
    ...(visibilitySeatId ? { visibilitySeatId } : {}),
    privacyClass: privacyClassForEvent(event),
  }
}

function privacyClassForEvent(event: HandHistoryEvent): EventPrivacyClass {
  return event.visibility === 'public' ? 'public' : 'seatPrivate'
}

function compareEventRecords(left: EventRecord, right: EventRecord): number {
  if (left.matchId !== right.matchId) {
    return left.matchId.localeCompare(right.matchId)
  }
  if (left.handId !== right.handId) {
    return left.handId - right.handId
  }
  return left.sequenceNumber - right.sequenceNumber
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
