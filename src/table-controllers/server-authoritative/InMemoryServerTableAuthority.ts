import {
  applyAction,
  createGame,
  getLegalActions,
  getPublicView,
  getSeatView,
  startNextHand,
  type EngineCommand,
  type GameState,
  type HandHistoryEvent,
  type MatchConfig,
  type PrivateSeatView,
  type PublicTableView,
  type SeatId,
} from '../../poker-engine'
import {
  createCommandRecordDraft,
  createEventRecordDrafts,
  type CommandRecordStore,
  type EventRecordStore,
  type MatchFormat,
  type MatchRecordStore,
} from '../../persistence'

export type MultiplayerProtocolVersion = 'parapoker-multiplayer-v1'

export type RequestedPokerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; amount: number }
  | { type: 'raise'; amount: number }
  | { type: 'allIn' }

export interface PlayerActionRequest {
  protocolVersion: MultiplayerProtocolVersion
  commandId: string
  tableId: string
  expectedStateVersion: number
  requestedAction: RequestedPokerAction
}

export type ProtocolErrorReason =
  | 'AUTH_REQUIRED'
  | 'TABLE_NOT_FOUND'
  | 'NOT_SEATED'
  | 'STATE_VERSION_CONFLICT'
  | 'DUPLICATE_COMMAND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'NOT_PENDING_ACTOR'
  | 'ACTION_NOT_LEGAL'
  | 'INVALID_AMOUNT'
  | 'TABLE_CLOSED'
  | 'MALFORMED_REQUEST'
  | 'SERVER_ERROR'

export interface ServerTableAuthorityConfig {
  tableId: string
  config?: Partial<MatchConfig>
  seatBindings?: Array<{
    connectionId: string
    seatId: SeatId
  }>
  persistence?: ServerAuthorityPersistence
}

export interface ServerAuthorityPersistence {
  matchId: string
  matchStore: MatchRecordStore
  eventStore: EventRecordStore
  commandStore?: CommandRecordStore
  format?: MatchFormat
  rulesContractVersion?: string
}

export type PlayerActionResult = CommandAcceptedMessage | CommandRejectedMessage

export interface CommandAcceptedMessage {
  ok: true
  tableId: string
  commandId: string
  stateVersion: number
  events: HandHistoryEvent[]
  publicView: PublicTableView
}

export interface CommandRejectedMessage {
  ok: false
  tableId: string
  commandId?: string
  stateVersion: number
  reason: ProtocolErrorReason
  retryable: boolean
}

export type ProjectionResult = ProjectionMessage | CommandRejectedMessage

export interface ProjectionMessage {
  ok: true
  type: 'projection'
  tableId: string
  stateVersion: number
  publicView: PublicTableView
  privateSeatView?: PrivateSeatView
}

interface IdempotencyRecord {
  fingerprint: string
  result: PlayerActionResult
}

export class InMemoryServerTableAuthority {
  private state: GameState
  private stateVersion = 0
  private readonly tableId: string
  private readonly connectionSeats: Map<string, SeatId>
  private readonly idempotencyRecords = new Map<string, IdempotencyRecord>()
  private readonly persistence?: ServerAuthorityPersistence

  constructor({ tableId, config = {}, seatBindings = [], persistence }: ServerTableAuthorityConfig) {
    this.tableId = tableId
    this.state = createGame(config)
    this.connectionSeats = new Map(seatBindings.map((binding) => [binding.connectionId, binding.seatId]))
    this.persistence = persistence
    this.createPersistedMatch()
  }

  bindConnectionToSeat(connectionId: string, seatId: SeatId): void {
    this.connectionSeats.set(connectionId, seatId)
  }

  startNextHand(): CommandAcceptedMessage | CommandRejectedMessage {
    const result = startNextHand(this.state)
    if (!result.ok) {
      return this.reject(undefined, toProtocolError(result.error.reason), false)
    }

    this.state = result.state
    this.stateVersion += 1
    this.persistEvents(result.events)
    return {
      ok: true,
      tableId: this.tableId,
      commandId: 'server:start-next-hand',
      stateVersion: this.stateVersion,
      events: result.events,
      publicView: getPublicView(this.state),
    }
  }

  submitPlayerAction(
    connectionId: string,
    request: PlayerActionRequest,
    idempotencyScope = connectionId,
  ): PlayerActionResult {
    if (request.protocolVersion !== 'parapoker-multiplayer-v1' || request.tableId !== this.tableId) {
      return this.reject(request.commandId, 'TABLE_NOT_FOUND', false)
    }

    const trustedSeatId = this.connectionSeats.get(connectionId)
    if (!trustedSeatId) {
      const rejected = this.reject(request.commandId, 'NOT_SEATED', false)
      this.persistRejectedCommand(request, undefined, rejected.reason)
      return rejected
    }

    const idempotencyKey = `${idempotencyScope}:${request.commandId}`
    const fingerprint = fingerprintRequest(request)
    const existingRecord = this.idempotencyRecords.get(idempotencyKey)
    if (existingRecord) {
      if (existingRecord.fingerprint !== fingerprint) {
        const rejected = this.reject(request.commandId, 'IDEMPOTENCY_CONFLICT', false)
        this.persistRejectedCommand(request, trustedSeatId, rejected.reason)
        return rejected
      }
      return existingRecord.result
    }

    if (request.expectedStateVersion !== this.stateVersion) {
      const rejected = this.reject(request.commandId, 'STATE_VERSION_CONFLICT', true)
      this.persistRejectedCommand(request, trustedSeatId, rejected.reason)
      return rejected
    }

    const command = toTrustedCommand(trustedSeatId, request)
    const preflight = this.preflightCommand(command)
    if (preflight) {
      const rejected = this.reject(request.commandId, preflight, true)
      this.persistRejectedCommand(request, trustedSeatId, rejected.reason)
      return rejected
    }

    const result = applyAction(this.state, command)
    if (!result.ok) {
      const rejected = this.reject(request.commandId, toProtocolError(result.error.reason), true)
      this.persistRejectedCommand(request, trustedSeatId, rejected.reason)
      return rejected
    }

    this.state = result.state
    this.stateVersion += 1
    this.persistEvents(result.events)
    this.persistAcceptedCommand(request, trustedSeatId, result.events.map((event) => event.eventId))
    const accepted: CommandAcceptedMessage = {
      ok: true,
      tableId: this.tableId,
      commandId: request.commandId,
      stateVersion: this.stateVersion,
      events: result.events,
      publicView: getPublicView(this.state),
    }
    this.idempotencyRecords.set(idempotencyKey, { fingerprint, result: accepted })
    return accepted
  }

  getProjectionForConnection(connectionId: string): ProjectionResult {
    const trustedSeatId = this.connectionSeats.get(connectionId)
    if (!trustedSeatId) {
      return this.reject(undefined, 'NOT_SEATED', false)
    }

    return {
      ok: true,
      type: 'projection',
      tableId: this.tableId,
      stateVersion: this.stateVersion,
      publicView: getPublicView(this.state),
      privateSeatView: getSeatView(this.state, trustedSeatId),
    }
  }

  getPublicProjection(): ProjectionMessage {
    return {
      ok: true,
      type: 'projection',
      tableId: this.tableId,
      stateVersion: this.stateVersion,
      publicView: getPublicView(this.state),
    }
  }

  getSnapshotForTests(): { stateVersion: number; state: GameState } {
    return clone({
      stateVersion: this.stateVersion,
      state: this.state,
    })
  }

  private preflightCommand(command: EngineCommand): ProtocolErrorReason | undefined {
    const pendingSeatId = this.state.hand?.pendingSeatId
    if (pendingSeatId && pendingSeatId !== command.seatId) {
      return 'NOT_PENDING_ACTOR'
    }

    const legalActions = getLegalActions(this.state, command.seatId)
    if (!legalActions.some((action) => action.type === command.type)) {
      return 'ACTION_NOT_LEGAL'
    }

    if (command.type === 'bet' || command.type === 'raise') {
      const legalAmountAction = legalActions.find((action) => action.type === command.type)
      if (
        !legalAmountAction ||
        !('min' in legalAmountAction) ||
        !Number.isInteger(command.amount) ||
        command.amount < legalAmountAction.min ||
        command.amount > legalAmountAction.max
      ) {
        return 'INVALID_AMOUNT'
      }
    }

    return undefined
  }

  private reject(commandId: string | undefined, reason: ProtocolErrorReason, retryable: boolean): CommandRejectedMessage {
    return {
      ok: false,
      tableId: this.tableId,
      ...(commandId ? { commandId } : {}),
      stateVersion: this.stateVersion,
      reason,
      retryable,
    }
  }

  private createPersistedMatch(): void {
    if (!this.persistence) {
      return
    }

    void this.persistence.matchStore.createMatch({
      matchId: this.persistence.matchId,
      tableId: this.tableId,
      format: this.persistence.format ?? 'freezeout',
      rulesContractVersion: this.persistence.rulesContractVersion ?? 'para-poker-rules-v0',
      eventSchemaVersion: 'poker-event-v1',
      seatAssignments: this.state.config.seats.map((seat) => ({
        seatId: seat.id,
        ...(seat.kind === 'human' ? { playerId: seat.id } : { npcId: seat.id }),
      })),
      startingStacks: Object.fromEntries(this.state.config.seats.map((seat) => [seat.id, this.state.config.startingStack])),
      blinds: {
        smallBlind: this.state.config.smallBlind,
        bigBlind: this.state.config.bigBlind,
      },
    })
  }

  private persistEvents(events: HandHistoryEvent[]): void {
    if (!this.persistence || events.length === 0) {
      return
    }

    void this.persistence.eventStore.appendEvents(createEventRecordDrafts(this.persistence.matchId, this.tableId, events))
  }

  private persistAcceptedCommand(
    request: PlayerActionRequest,
    trustedSeatId: SeatId,
    resultingEventIds: string[],
  ): void {
    if (!this.persistence?.commandStore) {
      return
    }

    void this.persistence.commandStore.appendCommand(
      createCommandRecordDraft({
        matchId: this.persistence.matchId,
        tableId: this.tableId,
        commandId: request.commandId,
        playerId: trustedSeatId,
        trustedSeatId,
        expectedStateVersion: request.expectedStateVersion,
        requestedAction: sanitizeRequestedAction(request.requestedAction),
        status: 'accepted',
        resultingEventIds,
      }),
    )
  }

  private persistRejectedCommand(
    request: PlayerActionRequest,
    trustedSeatId: SeatId | undefined,
    rejectionReason: ProtocolErrorReason,
  ): void {
    if (!this.persistence?.commandStore || !trustedSeatId) {
      return
    }

    void this.persistence.commandStore.appendCommand(
      createCommandRecordDraft({
        matchId: this.persistence.matchId,
        tableId: this.tableId,
        commandId: request.commandId,
        playerId: trustedSeatId,
        trustedSeatId,
        expectedStateVersion: request.expectedStateVersion,
        requestedAction: sanitizeRequestedAction(request.requestedAction),
        status: 'rejected',
        rejectionReason,
      }),
    )
  }
}

function sanitizeRequestedAction(action: RequestedPokerAction): RequestedPokerAction {
  switch (action.type) {
    case 'bet':
      return { type: 'bet', amount: action.amount }
    case 'raise':
      return { type: 'raise', amount: action.amount }
    case 'fold':
      return { type: 'fold' }
    case 'check':
      return { type: 'check' }
    case 'call':
      return { type: 'call' }
    case 'allIn':
      return { type: 'allIn' }
  }
}

function toTrustedCommand(seatId: SeatId, request: PlayerActionRequest): EngineCommand {
  const action = request.requestedAction
  switch (action.type) {
    case 'fold':
      return { type: 'fold', seatId, source: 'human', commandId: request.commandId }
    case 'check':
      return { type: 'check', seatId, source: 'human', commandId: request.commandId }
    case 'call':
      return { type: 'call', seatId, source: 'human', commandId: request.commandId }
    case 'bet':
      return { type: 'bet', seatId, amount: action.amount, source: 'human', commandId: request.commandId }
    case 'raise':
      return { type: 'raise', seatId, amount: action.amount, source: 'human', commandId: request.commandId }
    case 'allIn':
      return { type: 'allIn', seatId, source: 'human', commandId: request.commandId }
  }
}

function toProtocolError(reason: string): ProtocolErrorReason {
  if (reason === 'NOT_PENDING_ACTOR') {
    return 'NOT_PENDING_ACTOR'
  }
  if (reason === 'ACTION_NOT_LEGAL') {
    return 'ACTION_NOT_LEGAL'
  }
  if (reason === 'INVALID_AMOUNT') {
    return 'INVALID_AMOUNT'
  }
  if (reason === 'MATCH_COMPLETE') {
    return 'TABLE_CLOSED'
  }
  return 'SERVER_ERROR'
}

function fingerprintRequest(request: PlayerActionRequest): string {
  return JSON.stringify({
    protocolVersion: request.protocolVersion,
    commandId: request.commandId,
    tableId: request.tableId,
    expectedStateVersion: request.expectedStateVersion,
    requestedAction: request.requestedAction,
  })
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
