import type { EngineCommand, HandHistoryEvent, PublicSeatView, SeatId } from '../../poker-engine'
import {
  buildCompletedSessionPackage,
  type CompletedSessionPackage,
} from '../../exports/completedSessionPackage'
import {
  createGameBlueprint,
  gameBlueprintToControllerConfig,
  npcDefinitionsForBlueprint,
  npcLineupForBlueprint,
  npcStrategyProfilesForBlueprint,
  type GameBlueprint,
  type GameVisibility,
  type HumanPlayerIdentity,
} from '../../game-config/gameBlueprint'
import type { NpcDefinition, NpcSeatAssignment, NpcStrategyProfile } from '../../npc/config'
import type { NpcDecisionTrace } from '../../npc/npcDecisionTrace'
import {
  createEventRecordDrafts,
  buildAuthorityJournalFromRecords,
  finalizeCompletedTableArchive,
  InMemoryEventRecordStore,
  buildArchivedHandRecord,
  buildArchiveParticipants,
  buildSeatPrivateHandArchive,
  type ArchivedSessionDetail,
  type ArchivedSessionRecord,
  InMemoryMatchRecordStore,
  InMemoryStatsStore,
  type DerivedStatsSnapshot,
  type EventRecord,
  type HandHistoryArchiveStore,
  type MatchRecord,
} from '../../persistence'
import {
  LocalSinglePlayerController,
  type LocalSinglePlayerSnapshot,
  type LocalSinglePlayerTransition,
} from './LocalSinglePlayerController'

export type SoloSessionMode = 'heads-up' | 'six-max'

export interface LocalSoloSessionConfig {
  mode: SoloSessionMode
  startingStack: number
  smallBlind: number
  bigBlind: number
  seed: string | number
  matchId?: string
  visibility?: GameVisibility
  npcLineup?: NpcSeatAssignment[]
  blueprint?: GameBlueprint
  humanPlayer?: HumanPlayerIdentity
}

export interface LocalSoloSessionOptions {
  archiveStore?: HandHistoryArchiveStore
  npcDefinitions?: NpcDefinition[]
  npcStrategyProfiles?: NpcStrategyProfile[]
}

export interface LocalSoloSessionSummary {
  winnerSeatId?: SeatId
  winnerName?: string
  handsPlayed: number
  finalStacks: Record<SeatId, number>
  stats: DerivedStatsSnapshot[]
  mode: SoloSessionMode
  seed: string | number
}

export interface LocalSoloSessionSnapshot extends LocalSinglePlayerSnapshot {
  matchId: string
  tableId: string
  mode: SoloSessionMode
  seed: string | number
  config: LocalSoloSessionConfig
  blueprint: GameBlueprint
  stats: DerivedStatsSnapshot[]
  summary?: LocalSoloSessionSummary
  archive?: {
    status: ArchivedSessionRecord['status']
    packageChecksum?: string
    importStatus?: ArchivedSessionRecord['importStatus']
  }
}

type HumanCommand = Omit<EngineCommand, 'seatId' | 'source'>

export class LocalSoloSession {
  private readonly matchId: string
  private readonly tableId: string
  private readonly config: LocalSoloSessionConfig
  private readonly blueprint: GameBlueprint
  private readonly controller: LocalSinglePlayerController
  private readonly npcDefinitions: NpcDefinition[]
  private readonly npcStrategyProfiles: NpcStrategyProfile[]
  private readonly matchStore: InMemoryMatchRecordStore
  private readonly eventStore: InMemoryEventRecordStore
  private readonly statsStore: InMemoryStatsStore
  private readonly archiveStore?: HandHistoryArchiveStore
  private readonly retainedHandNumbers = new Set<number>()
  private readonly heroPrivateEvents: HandHistoryEvent[] = []
  private readonly npcDecisionTraces: NpcDecisionTrace[] = []
  private stats: DerivedStatsSnapshot[] = []
  private completed = false
  private archiveFinalized = false
  private archiveRecord?: ArchivedSessionRecord

  private constructor(config: LocalSoloSessionConfig, options: LocalSoloSessionOptions = {}) {
    const resolvedBlueprint = config.blueprint ? clone(config.blueprint) : createBlueprintFromSessionConfig(config)
    const resolvedSeed = resolvedBlueprint.seedPolicy === 'random' ? config.seed : resolvedBlueprint.seed
    this.config = {
      ...clone(config),
      mode: resolvedBlueprint.mode,
      startingStack: resolvedBlueprint.startingStack,
      smallBlind: resolvedBlueprint.smallBlind,
      bigBlind: resolvedBlueprint.bigBlind,
      seed: resolvedSeed,
      visibility: resolvedBlueprint.visibility,
      npcLineup: npcLineupForBlueprint(resolvedBlueprint),
      blueprint: clone(resolvedBlueprint),
    }
    this.matchId = config.matchId ?? createLocalMatchId()
    this.tableId = `${this.matchId}:table`
    this.blueprint = resolvedBlueprint
    this.matchStore = new InMemoryMatchRecordStore()
    this.eventStore = new InMemoryEventRecordStore()
    this.statsStore = new InMemoryStatsStore(this.eventStore)
    this.archiveStore = options.archiveStore
    this.npcDefinitions = npcDefinitionsForBlueprint(this.blueprint, options.npcDefinitions)
    this.npcStrategyProfiles = npcStrategyProfilesForBlueprint(
      this.blueprint,
      this.npcDefinitions,
      options.npcStrategyProfiles,
    )
    this.controller = new LocalSinglePlayerController(gameBlueprintToControllerConfig(this.blueprint, this.npcDefinitions, resolvedSeed), {
      npcLineup: npcLineupForBlueprint(this.blueprint),
      npcDefinitions: this.npcDefinitions,
      npcStrategyProfiles: this.npcStrategyProfiles,
    })
  }

  static async create(config: LocalSoloSessionConfig, options: LocalSoloSessionOptions = {}): Promise<LocalSoloSession> {
    const session = new LocalSoloSession(config, options)
    await session.matchStore.createMatch({
      matchId: session.matchId,
      tableId: session.tableId,
      format: 'freezeout',
      rulesContractVersion: 'para-poker-rules-v0',
      eventSchemaVersion: 'poker-event-v1',
      seatAssignments: session.controller
        .getSnapshot()
        .publicView.seats.map((seat) => toSeatAssignment(seat, session.blueprint)),
      startingStacks: Object.fromEntries(
        session.controller.getSnapshot().publicView.seats.map((seat) => [seat.id, session.blueprint.startingStack]),
      ),
      blinds: {
        smallBlind: session.blueprint.smallBlind,
        bigBlind: session.blueprint.bigBlind,
      },
    })
    if (session.archiveStore) {
      session.archiveRecord = await session.archiveStore.createActiveSession({
        matchId: session.matchId,
        tableId: session.tableId,
        blueprint: session.blueprint,
        config: session.config,
        participants: buildArchiveParticipants(
          session.blueprint,
          session.npcDefinitions,
          session.npcStrategyProfiles,
        ),
        rulesContractVersion: 'para-poker-rules-v0',
        eventSchemaVersion: 'poker-event-v1',
        npcStrategyProfiles: session.npcStrategyProfiles,
      })
    }
    await session.recordTransition(session.controller.consumeInitialTransition())
    return session
  }

  getSnapshot(): LocalSoloSessionSnapshot {
    const snapshot = this.controller.getSnapshot()
    return {
      ...snapshot,
      matchId: this.matchId,
      tableId: this.tableId,
      mode: this.config.mode,
      seed: this.config.seed,
      config: clone(this.config),
      blueprint: clone(this.blueprint),
      stats: clone(this.stats),
      summary: this.buildSummary(snapshot),
      archive: this.archiveRecord
        ? {
            status: this.archiveRecord.status,
            packageChecksum: this.archiveRecord.packageChecksum,
            importStatus: this.archiveRecord.importStatus,
          }
        : undefined,
    }
  }

  async submitHumanAction(command: HumanCommand): Promise<LocalSoloSessionSnapshot> {
    await this.recordTransition(this.controller.submitHumanAction(command))
    return this.getSnapshot()
  }

  async startNextHand(): Promise<LocalSoloSessionSnapshot> {
    await this.recordTransition(this.controller.startNextHand())
    return this.getSnapshot()
  }

  async concede(): Promise<void> {
    if (this.completed) {
      return
    }
    const snapshot = this.controller.getSnapshot()
    const completedAt = new Date().toISOString()
    this.completed = true
    await this.matchStore.completeMatch(this.matchId, {
      status: 'cancelled',
      winnerSeatIds: [],
      finalStacks: finalStacks(snapshot.publicView.seats),
      completedAt,
    })
    if (this.archiveStore && this.archiveRecord) {
      this.archiveRecord = await this.archiveStore.abandonSession(this.matchId, completedAt)
    }
  }

  async listPublicSessionEvents(): Promise<EventRecord[]> {
    return this.eventStore.listPublicEvents(this.matchId)
  }

  async getMatchRecord(): Promise<MatchRecord | undefined> {
    return this.matchStore.getMatch(this.matchId)
  }

  async exportCompletedSessionPackage(): Promise<CompletedSessionPackage> {
    const match = await this.matchStore.getMatch(this.matchId)
    const snapshot = this.getSnapshot()
    if (!match || !snapshot.summary) {
      throw new Error('Completed-session export requires a completed local solo match.')
    }

    return buildCompletedSessionPackage({
      match,
      publicEvents: await this.eventStore.listPublicEvents(this.matchId),
      snapshotSeats: snapshot.publicView.seats,
      summary: snapshot.summary,
      config: this.config,
      appVersion: '0.0.0',
    })
  }

  async getArchivedSession(): Promise<ArchivedSessionDetail | undefined> {
    return this.archiveStore?.readArchivedSession(this.matchId)
  }

  getMatchSeatStats(seatId: SeatId): Promise<DerivedStatsSnapshot | undefined> {
    return this.statsStore.getMatchSeatStats(this.matchId, seatId)
  }

  listMatchStats(): Promise<DerivedStatsSnapshot[]> {
    return this.statsStore.listMatchStats(this.matchId)
  }

  getCanonicalStateForTests() {
    return this.controller.getCanonicalStateForTests()
  }

  private async recordTransition(transition: LocalSinglePlayerTransition): Promise<void> {
    this.npcDecisionTraces.push(...structuredClone(transition.npcDecisionTraces))
    const publicEvents = transition.events.filter((event) => event.visibility === 'public')
    const privateHeroEvents = transition.events.filter((event) => event.visibility === transition.heroView.heroSeatId)
    this.heroPrivateEvents.push(...privateHeroEvents)
    if (publicEvents.length > 0) {
      await this.eventStore.appendEvents(createEventRecordDrafts(this.matchId, this.tableId, publicEvents))
    }
    this.stats = await this.statsStore.updateFromVerifiedEvents(this.matchId)
    await this.archiveCompletedHands(publicEvents)
    await this.completeMatchIfNeeded()
    await this.finalizeArchiveIfNeeded()
  }

  private async archiveCompletedHands(publicEvents: HandHistoryEvent[]): Promise<void> {
    if (!this.archiveStore) {
      return
    }
    const completedHandIds = publicEvents
      .filter((event) => event.type === 'potAwarded')
      .map((event) => event.handId)
    if (completedHandIds.length === 0) {
      return
    }
    const allPublicEvents = await this.eventStore.listPublicEvents(this.matchId)
    for (const handNumber of completedHandIds) {
      if (this.retainedHandNumbers.has(handNumber)) {
        continue
      }
      const hand = buildArchivedHandRecord({
        matchId: this.matchId,
        tableId: this.tableId,
        handNumber,
        publicEvents: allPublicEvents.map((record) => record.event),
      })
      await this.archiveStore.upsertCompletedHand(hand)
      const privateHand = buildSeatPrivateHandArchive({
        matchId: this.matchId,
        tableId: this.tableId,
        seatId: this.controller.getSnapshot().heroView.heroSeatId,
        handNumber,
        privateEvents: this.heroPrivateEvents,
      })
      if (privateHand) {
        await this.archiveStore.upsertSeatPrivateHand(privateHand)
      }
      this.retainedHandNumbers.add(handNumber)
    }
  }

  private async completeMatchIfNeeded(): Promise<void> {
    const snapshot = this.controller.getSnapshot()
    if (this.completed || snapshot.publicView.status !== 'complete') {
      return
    }
    this.completed = true
    const fundedSeats = snapshot.publicView.seats.filter((seat) => seat.stack > 0)
    await this.matchStore.completeMatch(this.matchId, {
      status: 'complete',
      winnerSeatIds: fundedSeats.map((seat) => seat.id),
      finalStacks: finalStacks(snapshot.publicView.seats),
    })
  }

  private async finalizeArchiveIfNeeded(): Promise<void> {
    if (!this.archiveStore || this.archiveFinalized) {
      return
    }
    const snapshot = this.getSnapshot()
    if (!snapshot.summary) {
      return
    }
    this.archiveFinalized = true
    const publicPackage = await this.exportCompletedSessionPackage()
    const archiveDetail = await this.archiveStore.readArchivedSession(this.matchId)
    const match = await this.matchStore.getMatch(this.matchId)
    const publicEvents = await this.eventStore.listPublicEvents(this.matchId)
    const privateEventRecords = this.heroPrivateEvents.map((event, index): EventRecord => ({
      matchId: this.matchId,
      tableId: this.tableId,
      event,
      eventId: event.eventId,
      handId: event.handId,
      sequenceNumber: event.sequenceNumber,
      visibility: event.visibility,
      recordedAt: match?.completedAt ?? new Date(Date.now() + index).toISOString(),
      ...(event.visibility === 'public' ? {} : { visibilitySeatId: event.visibility }),
      privacyClass: 'seatPrivate',
    }))
    const authorityArchive = match && archiveDetail
      ? finalizeCompletedTableArchive({
          journal: buildAuthorityJournalFromRecords({
            matchId: this.matchId,
            tableId: this.tableId,
            authorityClass: 'local-browser',
            events: [...publicEvents, ...privateEventRecords],
            completedHands: archiveDetail.hands,
            npcDecisionTraces: this.npcDecisionTraces,
            createdAt: archiveDetail.session.startedAt,
          }),
          match,
          participants: archiveDetail.session.participants,
          privateHands: archiveDetail.privateHands,
          publicPackage,
          blueprint: this.blueprint,
          npcStrategySnapshots: this.npcDefinitions.map((definition) => ({
            npcDefinitionId: definition.id,
            strategyProfile: requirePinnedStrategySnapshot(
              definition.id,
              definition.strategyProfileId,
              this.npcStrategyProfiles,
            ),
          })),
          reason: 'match-complete',
          closedAt: match.completedAt,
        })
      : undefined
    this.archiveRecord = await this.archiveStore.finalizeCompletedSession({
      matchId: this.matchId,
      summary: snapshot.summary,
      publicPackage,
      authorityArchive,
    })
  }

  private buildSummary(snapshot: LocalSinglePlayerSnapshot): LocalSoloSessionSummary | undefined {
    if (snapshot.publicView.status !== 'complete') {
      return undefined
    }
    const winner = snapshot.publicView.seats.find((seat) => seat.stack > 0)
    return {
      winnerSeatId: winner?.id,
      winnerName: winner?.name,
      handsPlayed: Math.max(0, ...this.stats.map((stat) => stat.handsPlayed)),
      finalStacks: finalStacks(snapshot.publicView.seats),
      stats: clone(this.stats),
      mode: this.config.mode,
      seed: this.config.seed,
    }
  }
}

function requirePinnedStrategySnapshot(
  npcDefinitionId: string,
  strategyProfileId: string,
  profiles: readonly NpcStrategyProfile[],
): NpcStrategyProfile {
  const profile = profiles.find((candidate) => candidate.id === strategyProfileId)
  if (!profile) {
    throw new Error(`Missing pinned strategy snapshot for ${npcDefinitionId}.`)
  }
  return clone(profile)
}

export function createRandomLocalSeed(): string {
  return `local-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`}`
}

export function defaultLocalSoloSessionConfig(): LocalSoloSessionConfig {
  return {
    mode: 'heads-up',
    startingStack: 200,
    smallBlind: 1,
    bigBlind: 2,
    seed: 'heads-up-solo',
  }
}

function createBlueprintFromSessionConfig(config: LocalSoloSessionConfig): GameBlueprint {
  return createGameBlueprint({
    mode: config.mode,
    startingStack: config.startingStack,
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    seed: config.seed,
    visibility: config.visibility,
    npcLineup: config.npcLineup,
    humanPlayer: config.humanPlayer,
  })
}

function toSeatAssignment(seat: PublicSeatView, blueprint: GameBlueprint) {
  if (seat.kind === 'human') {
    return {
      seatId: seat.id,
      playerId: blueprint.seats.find((entry) => entry.seatId === seat.id)?.playerId ?? 'local-human',
    }
  }
  const npcDefinitionId = blueprint.seats.find((entry) => entry.seatId === seat.id)?.npcDefinitionId
  return { seatId: seat.id, npcId: npcDefinitionId ?? seat.id }
}

function finalStacks(seats: PublicSeatView[]): Record<SeatId, number> {
  return Object.fromEntries(seats.map((seat) => [seat.id, seat.stack]))
}

function createLocalMatchId(): string {
  return `local-match-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
