import { cardToString, type HandHistoryEvent, type SeatId } from '../poker-engine'
import type { CompletedSessionPackage } from '../exports/completedSessionPackage'
import type { GameBlueprint } from '../game-config/gameBlueprint'
import { npcDefinitionsForBlueprint, npcStrategyProfilesForBlueprint } from '../game-config/gameBlueprint'
import type { NpcDefinition, NpcStrategyProfile } from '../npc/config'
import type { LocalSoloSessionConfig, LocalSoloSessionSummary, SoloSessionMode } from '../table-controllers/local-single-player/LocalSoloSession'
import type { CompletedTableArchive } from './authorityArchive'

export const HAND_HISTORY_ARCHIVE_SCHEMA_VERSION = 'para-hand-history-archive-v1' as const
export const HAND_HISTORY_ARCHIVE_DB_NAME = 'parapoker-hand-history-archive'
export const HAND_HISTORY_ARCHIVE_DB_VERSION = 1

export type HandHistoryArchiveStatus =
  | 'active'
  | 'abandoned'
  | 'complete'
  | 'export-ready'
  | 'csv-generated'
  | 'submitted'
  | 'imported'
  | 'import-failed'

export type SourceAuthority = 'local-browser' | 'server-authoritative'

export interface ArchivedParticipant {
  seatId: SeatId
  displayName: string
  kind: 'human' | 'npc'
  playerId?: string
  npcDefinitionId?: string
  npcStrategyProfileId?: string
  npcStrategyProfileVersion?: number
}

export interface ArchivedHandRecord {
  schemaVersion: typeof HAND_HISTORY_ARCHIVE_SCHEMA_VERSION
  matchId: string
  tableId: string
  handId: string
  handNumber: number
  dealerSeatId: SeatId
  participantSeatIds: SeatId[]
  orderedPublicEvents: HandHistoryEvent[]
  board: string[]
  actions: Array<{
    sequenceNumber: number
    seatId: SeatId
    action: string
    amount: number
    street: string
  }>
  potAwards: Array<{
    seatId: SeatId
    amount: number
    handName?: string
    cards?: string[]
  }>
  revealedCards: Record<SeatId, string[]>
  completedAt: string
}

export interface SeatPrivateHandArchive {
  schemaVersion: typeof HAND_HISTORY_ARCHIVE_SCHEMA_VERSION
  matchId: string
  tableId: string
  seatId: SeatId
  handId: string
  handNumber: number
  privateEvents: HandHistoryEvent[]
  holeCards: string[]
  retainedAt: string
}

export interface ArchivedSessionRecord {
  schemaVersion: typeof HAND_HISTORY_ARCHIVE_SCHEMA_VERSION
  matchId: string
  tableId: string
  status: HandHistoryArchiveStatus
  mode: SoloSessionMode
  visibility: GameBlueprint['visibility']
  sourceAuthority: SourceAuthority
  blueprintId: string
  blueprintName: string
  rulesContractVersion: string
  eventSchemaVersion: string
  startingStack: number
  blinds: {
    smallBlind: number
    bigBlind: number
  }
  participants: ArchivedParticipant[]
  handCount: number
  startedAt: string
  completedAt?: string
  packageChecksum?: string
  importStatus?: Extract<HandHistoryArchiveStatus, 'export-ready' | 'csv-generated' | 'submitted' | 'imported' | 'import-failed'>
  resultSummary?: Omit<LocalSoloSessionSummary, 'seed'>
  privateMetadata?: {
    localSeed: string | number
    npcConfigurations: Array<{
      npcDefinitionId: string
      strategyProfileId: string
      strategyProfileVersion: number
    }>
  }
  publicPackage?: CompletedSessionPackage
  authorityArchive?: CompletedTableArchive
}

export interface ArchivedSessionDetail {
  session: ArchivedSessionRecord
  hands: ArchivedHandRecord[]
  privateHands: SeatPrivateHandArchive[]
}

export interface CreateArchiveSessionInput {
  matchId: string
  tableId: string
  blueprint: GameBlueprint
  config: LocalSoloSessionConfig
  participants: ArchivedParticipant[]
  rulesContractVersion: string
  eventSchemaVersion: string
  startedAt?: string
}

export interface FinalizeArchiveSessionInput {
  matchId: string
  summary: LocalSoloSessionSummary
  publicPackage: CompletedSessionPackage
  authorityArchive?: CompletedTableArchive
  completedAt?: string
}

export interface HandHistoryArchiveStore {
  createActiveSession(input: CreateArchiveSessionInput): Promise<ArchivedSessionRecord>
  abandonSession(matchId: string, completedAt?: string): Promise<ArchivedSessionRecord>
  upsertCompletedHand(hand: ArchivedHandRecord): Promise<void>
  upsertSeatPrivateHand(privateHand: SeatPrivateHandArchive): Promise<void>
  finalizeCompletedSession(input: FinalizeArchiveSessionInput): Promise<ArchivedSessionRecord>
  listArchivedSessions(): Promise<ArchivedSessionRecord[]>
  readArchivedSession(matchId: string): Promise<ArchivedSessionDetail | undefined>
  deleteArchivedSession(matchId: string): Promise<void>
  updateImportStatus(matchId: string, status: Extract<HandHistoryArchiveStatus, 'export-ready' | 'csv-generated' | 'submitted' | 'imported' | 'import-failed'>): Promise<ArchivedSessionRecord>
}

export function buildArchiveParticipants(
  blueprint: GameBlueprint,
  availableDefinitions?: NpcDefinition[],
  availableProfiles?: NpcStrategyProfile[],
): ArchivedParticipant[] {
  const definitions = npcDefinitionsForBlueprint(blueprint, availableDefinitions)
  const profiles = npcStrategyProfilesForBlueprint(blueprint, definitions, availableProfiles)
  return blueprint.seats.map((seat) => {
    if (seat.kind === 'human') {
      return {
        seatId: seat.seatId,
        displayName: seat.displayName ?? 'You',
        kind: 'human' as const,
        playerId: seat.playerId,
      }
    }
    const definition = definitions.find((candidate) => candidate.id === seat.npcDefinitionId)
    const profile = profiles.find((candidate) => candidate.id === seat.npcStrategyProfileId) ??
      profiles.find((candidate) => candidate.id === definition?.strategyProfileId)
    return {
      seatId: seat.seatId,
      displayName: definition?.name ?? seat.npcDefinitionId ?? seat.seatId,
      kind: 'npc' as const,
      npcDefinitionId: definition?.id ?? seat.npcDefinitionId,
      npcStrategyProfileId: profile?.id ?? seat.npcStrategyProfileId ?? definition?.strategyProfileId,
      npcStrategyProfileVersion: profile?.version ?? seat.npcStrategyProfileVersion,
    }
  })
}

export function createArchivedSessionRecord(input: CreateArchiveSessionInput): ArchivedSessionRecord {
  const npcConfigurations = input.participants
    .filter((participant) => participant.kind === 'npc' && participant.npcDefinitionId && participant.npcStrategyProfileId)
    .map((participant) => ({
      npcDefinitionId: participant.npcDefinitionId ?? '',
      strategyProfileId: participant.npcStrategyProfileId ?? '',
      strategyProfileVersion: participant.npcStrategyProfileVersion ?? 1,
    }))

  return {
    schemaVersion: HAND_HISTORY_ARCHIVE_SCHEMA_VERSION,
    matchId: input.matchId,
    tableId: input.tableId,
    status: 'active',
    mode: input.blueprint.mode,
    visibility: input.blueprint.visibility,
    sourceAuthority: 'local-browser',
    blueprintId: input.blueprint.id,
    blueprintName: input.blueprint.name,
    rulesContractVersion: input.rulesContractVersion,
    eventSchemaVersion: input.eventSchemaVersion,
    startingStack: input.blueprint.startingStack,
    blinds: {
      smallBlind: input.blueprint.smallBlind,
      bigBlind: input.blueprint.bigBlind,
    },
    participants: clone(input.participants),
    handCount: 0,
    startedAt: input.startedAt ?? new Date().toISOString(),
    privateMetadata: {
      localSeed: input.config.seed,
      npcConfigurations,
    },
  }
}

export function buildArchivedHandRecord(input: {
  matchId: string
  tableId: string
  handNumber: number
  publicEvents: HandHistoryEvent[]
  completedAt?: string
}): ArchivedHandRecord {
  const handEvents = input.publicEvents
    .filter((event) => event.handId === input.handNumber && event.visibility === 'public')
    .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
  const started = handEvents.find((event) => event.type === 'handStarted')
  const streetEvents = handEvents.filter((event) => event.type === 'streetAdvanced')
  const lastStreet = streetEvents.at(-1)
  const showdown = handEvents.find((event) => event.type === 'showdown')
  const awarded = handEvents.find((event) => event.type === 'potAwarded')

  return {
    schemaVersion: HAND_HISTORY_ARCHIVE_SCHEMA_VERSION,
    matchId: input.matchId,
    tableId: input.tableId,
    handId: `hand-${input.handNumber}`,
    handNumber: input.handNumber,
    dealerSeatId: started?.type === 'handStarted' ? started.payload.dealerSeatId : '',
    participantSeatIds: started?.type === 'handStarted' ? started.payload.participantSeatIds : [],
    orderedPublicEvents: clone(handEvents),
    board: lastStreet?.type === 'streetAdvanced'
      ? lastStreet.payload.communityCards.map(cardToString)
      : [],
    actions: toArchivedActions(handEvents),
    potAwards: awarded?.type === 'potAwarded'
      ? awarded.payload.winners.map((winner) => ({
          seatId: winner.seatId,
          amount: winner.amount,
          ...(winner.handName ? { handName: winner.handName } : {}),
          ...(winner.cards ? { cards: winner.cards.map(cardToString) } : {}),
        }))
      : [],
    revealedCards: showdown?.type === 'showdown'
      ? Object.fromEntries(
          Object.entries(showdown.payload.revealedCards).map(([seatId, cards]) => [
            seatId,
            cards.map(cardToString),
          ]),
        )
      : {},
    completedAt: input.completedAt ?? new Date().toISOString(),
  }
}

export function buildSeatPrivateHandArchive(input: {
  matchId: string
  tableId: string
  seatId: SeatId
  handNumber: number
  privateEvents: HandHistoryEvent[]
  retainedAt?: string
}): SeatPrivateHandArchive | undefined {
  const privateEvents = input.privateEvents
    .filter((event) => event.handId === input.handNumber && event.visibility === input.seatId)
    .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
  if (privateEvents.length === 0) {
    return undefined
  }
  const holeCards = privateEvents
    .filter((event) => event.type === 'holeCardsDealt')
    .flatMap((event) => event.type === 'holeCardsDealt' ? event.payload.cards.map(cardToString) : [])

  return {
    schemaVersion: HAND_HISTORY_ARCHIVE_SCHEMA_VERSION,
    matchId: input.matchId,
    tableId: input.tableId,
    seatId: input.seatId,
    handId: `hand-${input.handNumber}`,
    handNumber: input.handNumber,
    privateEvents: clone(privateEvents),
    holeCards,
    retainedAt: input.retainedAt ?? new Date().toISOString(),
  }
}

export function sanitizeArchivedSessionForPublicList(session: ArchivedSessionRecord): ArchivedSessionRecord {
  const { privateMetadata: _privateMetadata, authorityArchive: _authorityArchive, ...publicRecord } = session
  return clone(publicRecord)
}

export function stableArchiveChecksum(value: unknown): string {
  const json = stableStringify(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function toArchivedActions(events: HandHistoryEvent[]): ArchivedHandRecord['actions'] {
  const actions: ArchivedHandRecord['actions'] = []
  let street = 'preflop'
  for (const event of events) {
    if (event.type === 'streetAdvanced') {
      street = event.payload.street
    }
    if (event.type === 'blindPosted') {
      actions.push({
        sequenceNumber: event.sequenceNumber,
        seatId: event.payload.seatId,
        action: `post-${event.payload.blind}-blind`,
        amount: event.payload.amount,
        street,
      })
    }
    if (event.type === 'actionApplied') {
      actions.push({
        sequenceNumber: event.sequenceNumber,
        seatId: event.payload.seatId,
        action: event.payload.action,
        amount: event.payload.amount,
        street,
      })
    }
  }
  return actions
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
