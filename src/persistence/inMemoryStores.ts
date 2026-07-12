import type { HandHistoryEvent, SeatId } from '../poker-engine'
import type {
  EventPrivacyClass,
  EventRecord,
  EventRecordDraft,
  EventRecordStore,
  HandRecordDraft,
  MatchRecord,
  MatchRecordDraft,
  MatchRecordStore,
  MatchResultDraft,
  SeatHandHistoryExport,
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
