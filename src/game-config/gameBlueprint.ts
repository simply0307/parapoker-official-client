import type { MatchConfig, PlayerKind, SeatId } from '../poker-engine'
import type { NpcDefinition, NpcSeatAssignment, NpcStrategyProfile } from '../npc/config'
import {
  DEFAULT_HEADS_UP_NPC_LINEUP,
  DEFAULT_SIX_MAX_NPC_LINEUP,
  mustNpcDefinition,
  mustNpcStrategyProfile,
} from '../npc/roster'

export type GameBlueprintMode = 'heads-up' | 'six-max'
export type GameVisibility = 'private' | 'unlisted' | 'public'

export interface GameSeatBlueprint {
  seatId: SeatId
  kind: PlayerKind
  displayName?: string
  playerId?: string
  npcDefinitionId?: string
}

export interface GameBlueprint {
  id: string
  name: string
  version: number
  mode: GameBlueprintMode
  visibility: GameVisibility
  startingStack: number
  smallBlind: number
  bigBlind: number
  seed: string | number
  seats: GameSeatBlueprint[]
}

export interface HumanPlayerIdentity {
  playerId: string
  displayName: string
}

export interface CreateGameBlueprintInput {
  mode: GameBlueprintMode
  startingStack: number
  smallBlind: number
  bigBlind: number
  seed: string | number
  visibility?: GameVisibility
  npcLineup?: NpcSeatAssignment[]
  humanPlayer?: HumanPlayerIdentity
}

export function createGameBlueprint(input: CreateGameBlueprintInput): GameBlueprint {
  const npcLineup = input.npcLineup ?? defaultNpcLineup(input.mode)
  const humanPlayer = normalizeHumanPlayer(input.humanPlayer)
  const seats: GameSeatBlueprint[] = [
    { seatId: 'human', kind: 'human', ...humanPlayer },
    ...npcLineup.map((assignment) => ({
      seatId: assignment.seatId,
      kind: 'npc' as const,
      npcDefinitionId: assignment.npcDefinitionId,
    })),
  ]

  return {
    id: `local-${input.mode}-blueprint`,
    name: input.mode === 'six-max' ? 'Local Six-Max Solo' : 'Local Heads-Up Solo',
    version: 1,
    mode: input.mode,
    visibility: input.visibility ?? 'private',
    startingStack: input.startingStack,
    smallBlind: input.smallBlind,
    bigBlind: input.bigBlind,
    seed: input.seed,
    seats,
  }
}

export function assignHumanPlayerIdentity(
  blueprint: GameBlueprint,
  humanPlayer: HumanPlayerIdentity,
): GameBlueprint {
  const identity = normalizeHumanPlayer(humanPlayer)
  return {
    ...clone(blueprint),
    seats: blueprint.seats.map((seat) => seat.kind === 'human'
      ? { ...seat, ...identity }
      : clone(seat)),
  }
}

export function defaultNpcLineup(mode: GameBlueprintMode): NpcSeatAssignment[] {
  return clone(mode === 'six-max' ? DEFAULT_SIX_MAX_NPC_LINEUP : DEFAULT_HEADS_UP_NPC_LINEUP)
}

export function npcLineupForBlueprint(blueprint: GameBlueprint): NpcSeatAssignment[] {
  return blueprint.seats
    .filter((seat): seat is GameSeatBlueprint & { kind: 'npc'; npcDefinitionId: string } => seat.kind === 'npc')
    .map((seat) => ({ seatId: seat.seatId, npcDefinitionId: seat.npcDefinitionId }))
}

export function npcDefinitionsForBlueprint(blueprint: GameBlueprint): NpcDefinition[] {
  return npcLineupForBlueprint(blueprint).map((assignment) => mustNpcDefinition(assignment.npcDefinitionId))
}

export function npcStrategyProfilesForBlueprint(blueprint: GameBlueprint): NpcStrategyProfile[] {
  return npcDefinitionsForBlueprint(blueprint).map((definition) => mustNpcStrategyProfile(definition.strategyProfileId))
}

export function gameBlueprintToControllerConfig(
  blueprint: GameBlueprint,
  npcDefinitions: readonly NpcDefinition[] = [],
): Partial<MatchConfig> {
  return {
    startingStack: blueprint.startingStack,
    smallBlind: blueprint.smallBlind,
    bigBlind: blueprint.bigBlind,
    seed: blueprint.seed,
    seats: blueprint.seats.map((seat) => ({
      id: seat.seatId,
      name: seatName(seat, npcDefinitions),
      kind: seat.kind,
    })),
  }
}

function seatName(seat: GameSeatBlueprint, npcDefinitions: readonly NpcDefinition[]): string {
  if (seat.kind === 'human') {
    return seat.displayName ?? 'You'
  }
  if (!seat.npcDefinitionId) {
    return 'NPC'
  }
  return npcDefinitions.find((definition) => definition.id === seat.npcDefinitionId)?.name ??
    mustNpcDefinition(seat.npcDefinitionId).name
}

function normalizeHumanPlayer(humanPlayer?: HumanPlayerIdentity): HumanPlayerIdentity {
  return {
    playerId: humanPlayer?.playerId.trim() || 'local-human',
    displayName: humanPlayer?.displayName.trim() || 'You',
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
