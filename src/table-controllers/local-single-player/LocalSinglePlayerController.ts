import {
  BasicNpcPolicy,
  createNpcDecisionContext,
  type NpcPolicy,
  type NpcPolicyConfig,
  type NpcTableMemory,
} from '../../npc/basicNpc'
import type { NpcDefinition, NpcSeatAssignment, NpcStrategyProfile } from '../../npc/config'
import { updateNpcRangeMemory } from '../../npc/rangeTracking'
import {
  DEFAULT_SIX_MAX_NPC_LINEUP,
  localNpcDefinition,
  localNpcDefinitionForSeat,
  localNpcStrategyProfile,
} from '../../npc/roster'
import { createGameBlueprint, gameBlueprintToControllerConfig } from '../../game-config/gameBlueprint'
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
  definition: NpcDefinition
  strategyProfile: NpcStrategyProfile
  policy: NpcPolicy
  rng: Rng
  config: Partial<NpcPolicyConfig>
  memory: NpcTableMemory
}

export interface LocalNpcRuntime {
  seatId: SeatId
  definition: NpcDefinition
  strategyProfile: NpcStrategyProfile
}

export interface LocalSinglePlayerControllerOptions {
  npcLineup?: NpcSeatAssignment[]
  npcDefinitions?: NpcDefinition[]
  npcStrategyProfiles?: NpcStrategyProfile[]
  npcPolicyFactory?: (runtime: LocalNpcRuntime) => NpcPolicy
}

export function createSixMaxSoloConfig(config: Partial<MatchConfig> = {}): Partial<MatchConfig> {
  if (config.seats) {
    return config
  }
  const blueprint = createGameBlueprint({
    mode: 'six-max',
    startingStack: config.startingStack ?? 200,
    smallBlind: config.smallBlind ?? 1,
    bigBlind: config.bigBlind ?? 2,
    seed: config.seed ?? 'six-max-solo',
    npcLineup: DEFAULT_SIX_MAX_NPC_LINEUP,
  })
  return { ...config, ...gameBlueprintToControllerConfig(blueprint) }
}

export class LocalSinglePlayerController {
  private state: GameState
  private readonly humanSeatId: SeatId
  private readonly npcControllers: Map<SeatId, NpcSeatController>
  private lastError?: string
  private initialTransition: LocalSinglePlayerTransition

  constructor(config: Partial<MatchConfig> = {}, options: LocalSinglePlayerControllerOptions = {}) {
    this.state = createGame(config)
    this.humanSeatId = config.seats?.find((seat) => seat.kind === 'human')?.id ?? 'human'
    this.npcControllers = new Map(
      this.state.seats
        .filter((seat) => seat.kind === 'npc')
        .map((seat) => {
          const runtime = resolveNpcRuntime(seat.id, options)
          return [
            seat.id,
            {
              definition: runtime.definition,
              strategyProfile: runtime.strategyProfile,
              policy: options.npcPolicyFactory?.(runtime) ?? new BasicNpcPolicy(),
              rng: createRng(`${this.state.config.seed}:${seat.id}:${runtime.definition.id}:npc-policy`),
              config: runtime.strategyProfile.policyConfig,
              memory: {},
            },
          ]
        }),
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
      controller.memory = updateNpcRangeMemory(controller.memory, view)
      const command = controller.policy.chooseAction(
        createNpcDecisionContext(
          view,
          controller.rng,
          controller.config,
          controller.memory,
          controller.strategyProfile.preflopStrategy,
        ),
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

function resolveNpcRuntime(seatId: SeatId, options: LocalSinglePlayerControllerOptions): LocalNpcRuntime {
  const assignedNpcId = options.npcLineup?.find((assignment) => assignment.seatId === seatId)?.npcDefinitionId
  const definition =
    findNpcDefinition(assignedNpcId, options.npcDefinitions) ??
    localNpcDefinitionForSeat(seatId, options.npcLineup)
  if (!definition) {
    throw new Error(`No NPC definition configured for seat ${seatId}.`)
  }

  const strategyProfile =
    options.npcStrategyProfiles?.find((profile) => profile.id === definition.strategyProfileId) ??
    localNpcStrategyProfile(definition.strategyProfileId)
  if (!strategyProfile) {
    throw new Error(`No NPC strategy profile configured for ${definition.id}.`)
  }

  return { seatId, definition, strategyProfile }
}

function findNpcDefinition(
  npcDefinitionId: string | undefined,
  definitions: readonly NpcDefinition[] | undefined,
): NpcDefinition | undefined {
  if (!npcDefinitionId) {
    return undefined
  }
  return definitions?.find((definition) => definition.id === npcDefinitionId) ?? localNpcDefinition(npcDefinitionId)
}
