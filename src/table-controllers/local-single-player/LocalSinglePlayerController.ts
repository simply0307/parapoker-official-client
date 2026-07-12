import {
  BasicNpcPolicy,
  createNpcDecisionContext,
  type NpcPolicy,
  type NpcPolicyConfig,
  type NpcTableMemory,
} from '../../npc/basicNpc'
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
import { createRng, type Rng } from '../../shared/rng'

export interface LocalSinglePlayerSnapshot {
  publicView: PublicTableView
  heroView: PrivateSeatView
  canonicalStatus: GameState['status']
  lastError?: string
}

interface NpcSeatController {
  policy: NpcPolicy
  rng: Rng
  config?: Partial<NpcPolicyConfig>
  memory: NpcTableMemory
}

export class LocalSinglePlayerController {
  private state: GameState
  private readonly humanSeatId: SeatId
  private readonly npcControllers: Map<SeatId, NpcSeatController>
  private lastError?: string

  constructor(config: Partial<MatchConfig> = {}, npcPolicy: NpcPolicy = new BasicNpcPolicy()) {
    this.state = createGame(config)
    this.humanSeatId = config.seats?.find((seat) => seat.kind === 'human')?.id ?? 'human'
    this.npcControllers = new Map(
      this.state.seats
        .filter((seat) => seat.kind === 'npc')
        .map((seat) => [
          seat.id,
          {
            policy: npcPolicy,
            rng: createRng(`${this.state.config.seed}:${seat.id}:npc-policy`),
            memory: {},
          },
        ]),
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
      const controller = this.npcControllers.get(pendingSeatId)
      if (!controller) {
        return
      }
      const view = getSeatView(this.state, pendingSeatId)
      const command = controller.policy.chooseAction(
        createNpcDecisionContext(view, controller.rng, controller.config, controller.memory),
      )
      const result = applyAction(this.state, command)
      if (!result.ok) {
        this.lastError = result.error.message
        return
      }
      this.state = result.state
    }
  }
}
