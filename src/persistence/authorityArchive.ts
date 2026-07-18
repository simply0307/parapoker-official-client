import type { CompletedSessionPackage } from '../exports/completedSessionPackage'
import type { GameBlueprint } from '../game-config/gameBlueprint'
import type { HandHistoryEvent, SeatId } from '../poker-engine'
import type { NpcStrategyProfile } from '../npc/config'
import type { NpcDecisionTrace } from '../npc/npcDecisionTrace'
import type {
  ArchivedHandRecord,
  ArchivedParticipant,
  SeatPrivateHandArchive,
} from './handHistoryArchive'
import type { CommandRecord, EventRecord, MatchFormat, MatchRecord } from './types'
import { stableArchiveChecksum } from './handHistoryArchive'

export const COMPLETED_TABLE_ARCHIVE_SCHEMA_VERSION = 'para-completed-table-archive-v1' as const

export type AuthorityClass = 'local-browser' | 'local-development' | 'server-exhibition' | 'server-official'
export type TableLifecycleStatus = 'draft' | 'scheduled' | 'open' | 'seating' | 'active' | 'closing' | 'closed' | 'cancelled' | 'aborted'
export type ArchiveLifecycleStatus = 'not-started' | 'journaling' | 'finalizing' | 'ready' | 'failed' | 'quarantined'
export type SubmissionLifecycleStatus = 'not-submitted' | 'csv-generated' | 'submitted' | 'validation-failed' | 'needs-mapping' | 'imported' | 'rejected'
export type TableClosureReason = 'match-complete' | 'operator-closed' | 'cancelled' | 'aborted'

export interface AuthorityEventRecord {
  tableSequence: number
  handNumber: number
  handSequence: number
  matchId: string
  tableId: string
  eventId: string
  visibility: HandHistoryEvent['visibility']
  recordedAt: string
  event: HandHistoryEvent
}

export interface AuthorityCommandRecord {
  commandId: string
  matchId: string
  tableId: string
  trustedSeatId: SeatId
  requestedAction: CommandRecord['requestedAction']
  status: CommandRecord['status']
  receivedAt: string
  stateVersionBefore: number
  stateVersionAfter?: number
  trustedCommand?: CommandRecord['trustedCommand']
  resultingEventIds: string[]
  rejectionReason?: CommandRecord['rejectionReason']
  playerId?: string
  npcId?: string
}

export interface ActiveTableJournal {
  schemaVersion: typeof COMPLETED_TABLE_ARCHIVE_SCHEMA_VERSION
  matchId: string
  tableId: string
  authorityClass: AuthorityClass
  tableLifecycleStatus: TableLifecycleStatus
  archiveLifecycleStatus: ArchiveLifecycleStatus
  submissionLifecycleStatus: SubmissionLifecycleStatus
  createdAt: string
  commands: AuthorityCommandRecord[]
  events: AuthorityEventRecord[]
  completedHands: ArchivedHandRecord[]
  npcDecisionTraces: NpcDecisionTrace[]
  lastPersistedTableSequence: number
}

export interface CompletedTableArchive {
  schemaVersion: typeof COMPLETED_TABLE_ARCHIVE_SCHEMA_VERSION
  archiveId: string
  matchId: string
  tableId: string
  authorityClass: AuthorityClass
  table: {
    format: MatchFormat
    rulesContractVersion: string
    eventSchemaVersion: string
    blueprintId?: string
    blueprintName?: string
    mode?: GameBlueprint['mode']
    visibility?: GameBlueprint['visibility']
    startingStack: number
    blinds: {
      smallBlind: number
      bigBlind: number
    }
    createdAt: string
    completedAt?: string
  }
  participants: ArchivedParticipant[]
  hands: ArchivedHandRecord[]
  seatPrivateHands: SeatPrivateHandArchive[]
  commands: AuthorityCommandRecord[]
  events: AuthorityEventRecord[]
  npcDecisionTraces: NpcDecisionTrace[]
  npcStrategySnapshots: Array<{
    npcDefinitionId: string
    strategyProfile: NpcStrategyProfile
  }>
  result: CompletedSessionPackage['result']
  closure: {
    reason: TableClosureReason
    closedAt: string
  }
  derivatives: {
    publicPackage: CompletedSessionPackage
  }
  integrity: {
    checksumAlgorithm: 'stable-json-fnv1a32'
    checksum: string
    commandCount: number
    eventCount: number
    handCount: number
    npcDecisionCount: number
  }
}

export function createActiveTableJournal(input: {
  matchId: string
  tableId: string
  authorityClass: AuthorityClass
  createdAt?: string
}): ActiveTableJournal {
  return {
    schemaVersion: COMPLETED_TABLE_ARCHIVE_SCHEMA_VERSION,
    matchId: input.matchId,
    tableId: input.tableId,
    authorityClass: input.authorityClass,
    tableLifecycleStatus: 'active',
    archiveLifecycleStatus: 'journaling',
    submissionLifecycleStatus: 'not-submitted',
    createdAt: input.createdAt ?? new Date().toISOString(),
    commands: [],
    events: [],
    completedHands: [],
    npcDecisionTraces: [],
    lastPersistedTableSequence: 0,
  }
}

export function appendNpcDecisionTraces(
  journal: ActiveTableJournal,
  traces: readonly NpcDecisionTrace[],
): ActiveTableJournal {
  const next = clone(journal)
  next.npcDecisionTraces.push(...clone(traces))
  return next
}

export function appendAuthorityEvents(journal: ActiveTableJournal, records: EventRecord[]): ActiveTableJournal {
  const next = clone(journal)
  const existingEventIds = new Set(next.events.map((record) => record.eventId))
  const orderedRecords = [...records].sort(compareEventRecords)
  for (const record of orderedRecords) {
    if (existingEventIds.has(record.eventId)) {
      continue
    }
    next.lastPersistedTableSequence += 1
    next.events.push({
      tableSequence: next.lastPersistedTableSequence,
      handNumber: record.handId,
      handSequence: record.sequenceNumber,
      matchId: record.matchId,
      tableId: record.tableId,
      eventId: record.eventId,
      visibility: record.visibility,
      recordedAt: record.recordedAt,
      event: clone(record.event),
    })
    existingEventIds.add(record.eventId)
  }
  return next
}

export function appendAuthorityCommands(journal: ActiveTableJournal, records: CommandRecord[]): ActiveTableJournal {
  const next = clone(journal)
  const existingCommandIds = new Set(next.commands.map((record) => record.commandId))
  for (const record of records) {
    if (existingCommandIds.has(record.commandId)) {
      continue
    }
    next.commands.push(toAuthorityCommand(record))
    existingCommandIds.add(record.commandId)
  }
  next.commands.sort((left, right) => left.receivedAt.localeCompare(right.receivedAt) || left.commandId.localeCompare(right.commandId))
  return next
}

export function recordCompletedAuthorityHand(journal: ActiveTableJournal, hand: ArchivedHandRecord): ActiveTableJournal {
  const next = clone(journal)
  const withoutExisting = next.completedHands.filter((candidate) => candidate.handNumber !== hand.handNumber)
  next.completedHands = [...withoutExisting, clone(hand)].sort((left, right) => left.handNumber - right.handNumber)
  return next
}

export function finalizeCompletedTableArchive(input: {
  journal: ActiveTableJournal
  match: MatchRecord
  participants: ArchivedParticipant[]
  privateHands?: SeatPrivateHandArchive[]
  publicPackage: CompletedSessionPackage
  blueprint?: Pick<GameBlueprint, 'id' | 'name' | 'mode' | 'visibility'>
  npcStrategySnapshots?: Array<{ npcDefinitionId: string; strategyProfile: NpcStrategyProfile }>
  reason?: TableClosureReason
  closedAt?: string
}): CompletedTableArchive {
  const closedAt = input.closedAt ?? input.match.completedAt ?? new Date().toISOString()
  const archiveWithoutIntegrity = {
    schemaVersion: COMPLETED_TABLE_ARCHIVE_SCHEMA_VERSION,
    archiveId: `${input.match.tableId}:archive:${input.publicPackage.integrity.checksum}`,
    matchId: input.match.matchId,
    tableId: input.match.tableId,
    authorityClass: input.journal.authorityClass,
    table: {
      format: input.match.format,
      rulesContractVersion: input.match.rulesContractVersion,
      eventSchemaVersion: input.match.eventSchemaVersion,
      blueprintId: input.blueprint?.id,
      blueprintName: input.blueprint?.name,
      mode: input.blueprint?.mode,
      visibility: input.blueprint?.visibility,
      startingStack: input.publicPackage.rules.startingStack,
      blinds: input.match.blinds,
      createdAt: input.match.createdAt,
      completedAt: input.match.completedAt,
    },
    participants: clone(input.participants),
    hands: clone(input.journal.completedHands),
    seatPrivateHands: clone(input.privateHands ?? []),
    commands: clone(input.journal.commands),
    events: clone(input.journal.events),
    npcDecisionTraces: clone(input.journal.npcDecisionTraces),
    npcStrategySnapshots: clone(input.npcStrategySnapshots ?? []),
    result: clone(input.publicPackage.result),
    closure: {
      reason: input.reason ?? 'match-complete',
      closedAt,
    },
    derivatives: {
      publicPackage: clone(input.publicPackage),
    },
  }
  return {
    ...archiveWithoutIntegrity,
    integrity: {
      checksumAlgorithm: 'stable-json-fnv1a32',
      checksum: stableArchiveChecksum(archiveWithoutIntegrity),
      commandCount: input.journal.commands.length,
      eventCount: input.journal.events.length,
      handCount: input.journal.completedHands.length,
      npcDecisionCount: input.journal.npcDecisionTraces.length,
    },
  }
}

export function derivePublicPackageFromArchive(archive: CompletedTableArchive): CompletedSessionPackage {
  return clone(archive.derivatives.publicPackage)
}

export function buildAuthorityJournalFromRecords(input: {
  matchId: string
  tableId: string
  authorityClass: AuthorityClass
  events: EventRecord[]
  commands?: CommandRecord[]
  completedHands?: ArchivedHandRecord[]
  npcDecisionTraces?: NpcDecisionTrace[]
  createdAt?: string
}): ActiveTableJournal {
  let journal = createActiveTableJournal({
    matchId: input.matchId,
    tableId: input.tableId,
    authorityClass: input.authorityClass,
    createdAt: input.createdAt,
  })
  journal = appendAuthorityEvents(journal, input.events)
  journal = appendAuthorityCommands(journal, input.commands ?? [])
  journal = appendNpcDecisionTraces(journal, input.npcDecisionTraces ?? [])
  for (const hand of input.completedHands ?? []) {
    journal = recordCompletedAuthorityHand(journal, hand)
  }
  return journal
}

function toAuthorityCommand(record: CommandRecord): AuthorityCommandRecord {
  return {
    commandId: record.commandId,
    matchId: record.matchId,
    tableId: record.tableId,
    trustedSeatId: record.trustedSeatId,
    requestedAction: clone(record.requestedAction),
    status: record.status,
    receivedAt: record.receivedAt ?? new Date().toISOString(),
    stateVersionBefore: record.stateVersionBefore ?? record.expectedStateVersion,
    ...(record.stateVersionAfter !== undefined ? { stateVersionAfter: record.stateVersionAfter } : {}),
    ...(record.trustedCommand ? { trustedCommand: clone(record.trustedCommand) } : {}),
    resultingEventIds: clone(record.resultingEventIds ?? []),
    ...(record.rejectionReason ? { rejectionReason: record.rejectionReason } : {}),
    ...(record.playerId ? { playerId: record.playerId } : {}),
    ...(record.npcId ? { npcId: record.npcId } : {}),
  }
}

function compareEventRecords(left: EventRecord, right: EventRecord): number {
  if (left.handId !== right.handId) {
    return left.handId - right.handId
  }
  if (left.sequenceNumber !== right.sequenceNumber) {
    return left.sequenceNumber - right.sequenceNumber
  }
  return left.eventId.localeCompare(right.eventId)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
