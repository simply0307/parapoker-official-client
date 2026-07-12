import type { MatchConfig, SeatId } from '../../poker-engine'
import {
  InMemoryServerTableAuthority,
  type CommandRejectedMessage,
  type PlayerActionRequest,
  type PlayerActionResult,
  type ProjectionResult,
} from './InMemoryServerTableAuthority'

export type MultiplayerConnectionStatus = 'connected' | 'disconnected' | 'spectating'

export interface MultiplayerSeatAssignment {
  playerId: string
  seatId: SeatId
}

export interface InMemoryMultiplayerTableServiceConfig {
  tableId: string
  config?: Partial<MatchConfig>
  seats: MultiplayerSeatAssignment[]
}

export interface ConnectPlayerRequest {
  playerId: string
  connectionId: string
}

export interface ConnectSpectatorRequest {
  connectionId: string
}

interface ConnectionRecord {
  playerId?: string
  seatId?: SeatId
  status: MultiplayerConnectionStatus
}

export class InMemoryMultiplayerTableService {
  private readonly tableId: string
  private readonly authority: InMemoryServerTableAuthority
  private readonly playerSeats: Map<string, SeatId>
  private readonly connections = new Map<string, ConnectionRecord>()

  constructor({ tableId, config = {}, seats }: InMemoryMultiplayerTableServiceConfig) {
    this.tableId = tableId
    this.playerSeats = new Map(seats.map((seat) => [seat.playerId, seat.seatId]))
    this.authority = new InMemoryServerTableAuthority({ tableId, config })
  }

  startNextHand(): PlayerActionResult {
    return this.authority.startNextHand()
  }

  connectPlayer({ playerId, connectionId }: ConnectPlayerRequest): ProjectionResult {
    const seatId = this.playerSeats.get(playerId)
    if (!seatId) {
      return this.reject(undefined, 'NOT_SEATED', false)
    }

    this.connections.set(connectionId, { playerId, seatId, status: 'connected' })
    this.authority.bindConnectionToSeat(connectionId, seatId)
    return this.authority.getProjectionForConnection(connectionId)
  }

  connectSpectator({ connectionId }: ConnectSpectatorRequest): ProjectionResult {
    this.connections.set(connectionId, { status: 'spectating' })
    return this.authority.getPublicProjection()
  }

  disconnect(connectionId: string): void {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      return
    }
    this.connections.set(connectionId, { ...connection, status: 'disconnected' })
  }

  getConnectionStatus(connectionId: string): MultiplayerConnectionStatus | undefined {
    return this.connections.get(connectionId)?.status
  }

  submitPlayerAction(connectionId: string, request: PlayerActionRequest): PlayerActionResult {
    const connection = this.connections.get(connectionId)
    if (!connection || connection.status === 'disconnected') {
      return this.reject(request.commandId, 'AUTH_REQUIRED', true)
    }
    if (connection.status === 'spectating' || !connection.playerId) {
      return this.reject(request.commandId, 'NOT_SEATED', false)
    }

    return this.authority.submitPlayerAction(connectionId, request, connection.playerId)
  }

  getProjectionForConnection(connectionId: string): ProjectionResult {
    const connection = this.connections.get(connectionId)
    if (!connection || connection.status === 'disconnected') {
      return this.reject(undefined, 'AUTH_REQUIRED', true)
    }
    if (connection.status === 'spectating') {
      return this.authority.getPublicProjection()
    }

    return this.authority.getProjectionForConnection(connectionId)
  }

  private reject(
    commandId: string | undefined,
    reason: CommandRejectedMessage['reason'],
    retryable: boolean,
  ): CommandRejectedMessage {
    const projection = this.authority.getPublicProjection()
    return {
      ok: false,
      tableId: this.tableId,
      ...(commandId ? { commandId } : {}),
      stateVersion: projection.stateVersion,
      reason,
      retryable,
    }
  }
}
