import type { EngineCommand, MatchConfig, PublicSeatView, SeatId } from '../../poker-engine'
import {
  createEventRecordDrafts,
  InMemoryEventRecordStore,
  InMemoryMatchRecordStore,
  InMemoryStatsStore,
  type DerivedStatsSnapshot,
  type EventRecord,
  type MatchRecord,
} from '../../persistence'
import {
  createSixMaxSoloConfig,
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
  stats: DerivedStatsSnapshot[]
  summary?: LocalSoloSessionSummary
}

type HumanCommand = Omit<EngineCommand, 'seatId' | 'source'>

export class LocalSoloSession {
  private readonly matchId: string
  private readonly tableId: string
  private readonly config: LocalSoloSessionConfig
  private readonly controller: LocalSinglePlayerController
  private readonly matchStore: InMemoryMatchRecordStore
  private readonly eventStore: InMemoryEventRecordStore
  private readonly statsStore: InMemoryStatsStore
  private stats: DerivedStatsSnapshot[] = []
  private completed = false

  private constructor(config: LocalSoloSessionConfig) {
    this.config = clone(config)
    this.matchId = config.matchId ?? createLocalMatchId()
    this.tableId = `${this.matchId}:table`
    this.matchStore = new InMemoryMatchRecordStore()
    this.eventStore = new InMemoryEventRecordStore()
    this.statsStore = new InMemoryStatsStore(this.eventStore)
    this.controller = new LocalSinglePlayerController(createControllerConfig(config))
  }

  static async create(config: LocalSoloSessionConfig): Promise<LocalSoloSession> {
    const session = new LocalSoloSession(config)
    await session.matchStore.createMatch({
      matchId: session.matchId,
      tableId: session.tableId,
      format: 'freezeout',
      rulesContractVersion: 'para-poker-rules-v0',
      eventSchemaVersion: 'poker-event-v1',
      seatAssignments: session.controller.getSnapshot().publicView.seats.map((seat) => toSeatAssignment(seat)),
      startingStacks: Object.fromEntries(
        session.controller.getSnapshot().publicView.seats.map((seat) => [seat.id, config.startingStack]),
      ),
      blinds: {
        smallBlind: config.smallBlind,
        bigBlind: config.bigBlind,
      },
    })
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
      stats: clone(this.stats),
      summary: this.buildSummary(snapshot),
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

  async listPublicSessionEvents(): Promise<EventRecord[]> {
    return this.eventStore.listPublicEvents(this.matchId)
  }

  async getMatchRecord(): Promise<MatchRecord | undefined> {
    return this.matchStore.getMatch(this.matchId)
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
    const publicEvents = transition.events.filter((event) => event.visibility === 'public')
    if (publicEvents.length > 0) {
      await this.eventStore.appendEvents(createEventRecordDrafts(this.matchId, this.tableId, publicEvents))
    }
    this.stats = await this.statsStore.updateFromVerifiedEvents(this.matchId)
    await this.completeMatchIfNeeded()
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

function createControllerConfig(config: LocalSoloSessionConfig): Partial<MatchConfig> {
  const base = {
    startingStack: config.startingStack,
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    seed: config.seed,
  }
  if (config.mode === 'six-max') {
    return createSixMaxSoloConfig(base)
  }
  return base
}

function toSeatAssignment(seat: PublicSeatView) {
  return seat.kind === 'human' ? { seatId: seat.id, playerId: 'local-human' } : { seatId: seat.id, npcId: seat.id }
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
