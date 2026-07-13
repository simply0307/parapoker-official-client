import {
  BasicNpcPolicy,
  createNpcDecisionContext,
  type NpcPolicy,
  type NpcPolicyConfig,
  type NpcTableMemory,
} from '../../npc/basicNpc'
import { LOCAL_NPC_ROSTER } from '../../npc/roster'
import {
  applyAction,
  createGame,
  getPublicView,
  getSeatView,
  startNextHand,
  type EngineCommand,
  type EngineError,
  type EngineResult,
  type GameState,
  type HandHistoryEvent,
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

export interface LocalSinglePlayerTransition extends LocalSinglePlayerSnapshot {
  ok: boolean
  events: HandHistoryEvent[]
  error?: EngineError
}

interface NpcSeatController {
  policy: NpcPolicy
  rng: Rng
  config?: Partial<NpcPolicyConfig>
  memory: NpcTableMemory
}

export function createSixMaxSoloConfig(config: Partial<MatchConfig> = {}): Partial<MatchConfig> {
  return {
    ...config,
    seats: config.seats ?? [
      { id: 'human', name: 'You', kind: 'human' },
      ...LOCAL_NPC_ROSTER.map((npc) => ({ id: npc.seatId, name: npc.name, kind: 'npc' as const })),
    ],
  }
}

export class LocalSinglePlayerController {
  private state: GameState
  private readonly humanSeatId: SeatId
  private readonly npcControllers: Map<SeatId, NpcSeatController>
  private lastError?: string
  private initialTransition: LocalSinglePlayerTransition

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
    this.initialTransition = this.startNextHand()
  }

  getSnapshot(): LocalSinglePlayerSnapshot {
    return {
      publicView: getPublicView(this.state),
      heroView: getSeatView(this.state, this.humanSeatId),
      canonicalStatus: this.state.status,
      lastError: this.lastError,
    }
  }

  consumeInitialTransition(): LocalSinglePlayerTransition {
    const transition = this.initialTransition
    this.initialTransition = {
      ...this.getSnapshot(),
      ok: true,
      events: [],
    }
    return transition
  }

  submitHumanAction(command: Omit<EngineCommand, 'seatId' | 'source'>): LocalSinglePlayerTransition {
    const eventCursor = this.visibleHeroEventCount()
    const result = applyAction(this.state, {
      ...command,
      seatId: this.humanSeatId,
      source: 'human',
    } as EngineCommand)
    return this.acceptResult(result, eventCursor)
  }

  startNextHand(): LocalSinglePlayerTransition {
    const result = startNextHand(this.state)
    return this.acceptResult(result, 0)
  }

  getCanonicalStateForTests(): GameState {
    return JSON.parse(JSON.stringify(this.state)) as GameState
  }

  private acceptResult(result: EngineResult<GameState>, eventCursor: number): LocalSinglePlayerTransition {
    if (result.ok) {
      this.state = result.state
      this.lastError = undefined
      this.runNpcTurns()
    } else {
      this.lastError = result.error.message
    }
    return this.transition(result.ok, eventCursor, result.ok ? undefined : result.error)
  }

  private runNpcTurns(): void {
    let safety = 0
    while (this.state.status === 'handInProgress' && safety < 200) {
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

  private transition(ok: boolean, eventCursor: number, error?: EngineError): LocalSinglePlayerTransition {
    const snapshot = this.getSnapshot()
    return {
      ...snapshot,
      ok,
      events: snapshot.heroView.events.slice(eventCursor),
      ...(error ? { error } : {}),
    }
  }

  private visibleHeroEventCount(): number {
    return getSeatView(this.state, this.humanSeatId).events.length
  }
}
