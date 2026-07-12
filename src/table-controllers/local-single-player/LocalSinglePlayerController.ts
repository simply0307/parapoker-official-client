import { BasicNpcPolicy, type NpcPolicy } from '../../npc/basicNpc'
import {
  applyAction,
  createGame,
  getPublicView,
  getSeatView,
  startNextHand,
  type EngineCommand,
  type EngineResult,
  type GameState,
  type MatchConfig,
  type PrivateSeatView,
  type PublicTableView,
  type SeatId,
} from '../../poker-engine'

export interface LocalSinglePlayerSnapshot {
  publicView: PublicTableView
  heroView: PrivateSeatView
  canonicalStatus: GameState['status']
  lastError?: string
}

export class LocalSinglePlayerController {
  private state: GameState
  private readonly humanSeatId: SeatId
  private readonly npcPolicies: Map<SeatId, NpcPolicy>
  private lastError?: string

  constructor(config: Partial<MatchConfig> = {}, npcPolicy: NpcPolicy = new BasicNpcPolicy('npc-policy')) {
    this.state = createGame(config)
    this.humanSeatId = config.seats?.find((seat) => seat.kind === 'human')?.id ?? 'human'
    this.npcPolicies = new Map(
      this.state.seats
        .filter((seat) => seat.kind === 'npc')
        .map((seat) => [seat.id, npcPolicy]),
    )
    this.startNextHand()
  }

  getSnapshot(): LocalSinglePlayerSnapshot {
    return {
      publicView: getPublicView(this.state),
      heroView: getSeatView(this.state, this.humanSeatId),
      canonicalStatus: this.state.status,
      lastError: this.lastError,
    }
  }

  submitHumanAction(command: Omit<EngineCommand, 'seatId' | 'source'>): EngineResult<GameState> {
    const result = applyAction(this.state, {
      ...command,
      seatId: this.humanSeatId,
      source: 'human',
    } as EngineCommand)
    return this.acceptResult(result)
  }

  startNextHand(): EngineResult<GameState> {
    const result = startNextHand(this.state)
    const accepted = this.acceptResult(result)
    if (accepted.ok) {
      this.runNpcTurns()
    }
    return accepted
  }

  getCanonicalStateForTests(): GameState {
    return JSON.parse(JSON.stringify(this.state)) as GameState
  }

  private acceptResult(result: EngineResult<GameState>): EngineResult<GameState> {
    if (result.ok) {
      this.state = result.state
      this.lastError = undefined
      this.runNpcTurns()
    } else {
      this.lastError = result.error.message
    }
    return result
  }

  private runNpcTurns(): void {
    let safety = 0
    while (this.state.status === 'handInProgress' && safety < 50) {
      safety += 1
      const pendingSeatId = this.state.hand?.pendingSeatId
      if (!pendingSeatId || pendingSeatId === this.humanSeatId) {
        return
      }
      const policy = this.npcPolicies.get(pendingSeatId)
      if (!policy) {
        return
      }
      const view = getSeatView(this.state, pendingSeatId)
      const command = policy.chooseAction(view)
      const result = applyAction(this.state, command)
      if (!result.ok) {
        this.lastError = result.error.message
        return
      }
      this.state = result.state
    }
  }
}
