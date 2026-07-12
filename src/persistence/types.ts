import type { Card, EventSchemaVersion, HandHistoryEvent, SeatId } from '../poker-engine'
import type { ProtocolErrorReason, RequestedPokerAction } from '../table-controllers/server-authoritative/InMemoryServerTableAuthority'

export type MatchFormat = 'freezeout' | 'sitAndGo' | 'cash' | 'league'
export type MatchRecordStatus = 'active' | 'complete' | 'cancelled'
export type EventPrivacyClass = 'public' | 'seatPrivate' | 'tablePrivate' | 'serverAudit'

export interface SeatAssignmentRecord {
  seatId: SeatId
  playerId?: string
  npcId?: string
}

export interface MatchRecordDraft {
  matchId: string
  tableId: string
  format: MatchFormat
  rulesContractVersion: string
  eventSchemaVersion: EventSchemaVersion
  seatAssignments: SeatAssignmentRecord[]
  startingStacks: Record<SeatId, number>
  blinds: {
    smallBlind: number
    bigBlind: number
  }
}

export interface HandRecordDraft {
  handId: string
  handNumber: number
  dealerSeatId: SeatId
  smallBlindSeatId: SeatId
  bigBlindSeatId: SeatId
  initialStacks: Record<SeatId, number>
  finalStacks: Record<SeatId, number>
  publicBoard: Card[]
  potAwards: Array<{
    seatId: SeatId
    amount: number
  }>
}

export interface MatchResultDraft {
  status: Extract<MatchRecordStatus, 'complete' | 'cancelled'>
  winnerSeatIds: SeatId[]
  finalStacks: Record<SeatId, number>
}

export interface MatchRecord extends MatchRecordDraft {
  status: MatchRecordStatus
  hands: HandRecordDraft[]
  result?: MatchResultDraft
}

export interface EventRecordDraft {
  matchId: string
  tableId: string
  event: HandHistoryEvent
}

export interface EventRecord extends EventRecordDraft {
  eventId: string
  handId: number
  sequenceNumber: number
  visibility: HandHistoryEvent['visibility']
  visibilitySeatId?: SeatId
  privacyClass: EventPrivacyClass
}

export interface SeatHandHistoryExport {
  matchId: string
  seatId: SeatId
  events: HandHistoryEvent[]
}

export interface MatchRecordStore {
  createMatch(record: MatchRecordDraft): Promise<MatchRecord>
  appendHand(matchId: string, record: HandRecordDraft): Promise<MatchRecord>
  completeMatch(matchId: string, result: MatchResultDraft): Promise<MatchRecord>
  getMatch(matchId: string): Promise<MatchRecord | undefined>
}

export interface EventRecordStore {
  appendEvents(events: EventRecordDraft[]): Promise<void>
  listPublicEvents(matchId: string): Promise<EventRecord[]>
  listSeatEvents(matchId: string, seatId: SeatId): Promise<EventRecord[]>
  listReplayEvents(matchId: string): Promise<EventRecord[]>
  exportSeatHandHistory(matchId: string, seatId: SeatId): Promise<SeatHandHistoryExport>
}

export type CommandRecordStatus = 'accepted' | 'rejected'

export interface CommandRecordDraft {
  matchId: string
  tableId: string
  commandId: string
  playerId?: string
  npcId?: string
  trustedSeatId: SeatId
  expectedStateVersion: number
  requestedAction: RequestedPokerAction
  status: CommandRecordStatus
  resultingEventIds?: string[]
  rejectionReason?: ProtocolErrorReason
}

export interface CommandRecord extends CommandRecordDraft {
  privacyClass: Extract<EventPrivacyClass, 'tablePrivate'>
}

export interface CommandRecordStore {
  appendCommand(command: CommandRecordDraft): Promise<CommandRecord>
  listCommandsForMatch(matchId: string): Promise<CommandRecord[]>
  listRejectedCommands(matchId: string): Promise<CommandRecord[]>
}
