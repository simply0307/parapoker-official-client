import type { MatchConfig, PlayerKind, SeatId } from '../poker-engine'
import type { NpcDefinition, NpcSeatAssignment, NpcStrategyProfile } from '../npc/config'
import {
  DEFAULT_HEADS_UP_NPC_LINEUP,
  DEFAULT_SIX_MAX_NPC_LINEUP,
  LOCAL_NPC_DEFINITIONS,
  LOCAL_NPC_STRATEGY_PROFILES,
  mustNpcDefinition,
  mustNpcStrategyProfile,
} from '../npc/roster'

export type GameBlueprintMode = 'heads-up' | 'six-max'
export type GameVisibility = 'private' | 'unlisted' | 'public'
export type GameSeedPolicy = 'fixed' | 'random'

export interface GameSeatBlueprint {
  seatId: SeatId
  kind: PlayerKind
  displayName?: string
  playerId?: string
  npcDefinitionId?: string
  npcStrategyProfileId?: string
  npcStrategyProfileVersion?: number
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
  seedPolicy: GameSeedPolicy
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
  seed?: string | number
  seedPolicy?: GameSeedPolicy
  visibility?: GameVisibility
  npcLineup?: NpcSeatAssignment[]
  npcDefinitions?: NpcDefinition[]
  npcStrategyProfiles?: NpcStrategyProfile[]
  humanPlayer?: HumanPlayerIdentity
}

export function createGameBlueprint(input: CreateGameBlueprintInput): GameBlueprint {
  const npcLineup = input.npcLineup ?? defaultNpcLineup(input.mode)
  const humanPlayer = normalizeHumanPlayer(input.humanPlayer)
  const seats: GameSeatBlueprint[] = [
    { seatId: 'human', kind: 'human', ...humanPlayer },
    ...npcLineup.map((assignment) => {
      const definition = findNpcDefinition(assignment.npcDefinitionId, input.npcDefinitions)
      const profile = findNpcStrategyProfile(definition.strategyProfileId, input.npcStrategyProfiles)
      return {
        seatId: assignment.seatId,
        kind: 'npc' as const,
        npcDefinitionId: assignment.npcDefinitionId,
        npcStrategyProfileId: profile.id,
        npcStrategyProfileVersion: profile.version,
      }
    }),
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
    seedPolicy: input.seedPolicy ?? 'fixed',
    seed: input.seed ?? '',
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

export function npcDefinitionsForBlueprint(
  blueprint: GameBlueprint,
  availableDefinitions: readonly NpcDefinition[] = LOCAL_NPC_DEFINITIONS,
): NpcDefinition[] {
  return npcLineupForBlueprint(blueprint).map((assignment) =>
    findNpcDefinition(assignment.npcDefinitionId, availableDefinitions))
}

export function npcStrategyProfilesForBlueprint(
  blueprint: GameBlueprint,
  availableDefinitions: readonly NpcDefinition[] = LOCAL_NPC_DEFINITIONS,
  availableProfiles: readonly NpcStrategyProfile[] = LOCAL_NPC_STRATEGY_PROFILES,
): NpcStrategyProfile[] {
  const definitions = npcDefinitionsForBlueprint(blueprint, availableDefinitions)
  return blueprint.seats
    .filter((seat) => seat.kind === 'npc')
    .map((seat) => {
      const definition = definitions.find((candidate) => candidate.id === seat.npcDefinitionId)
      const profileId = seat.npcStrategyProfileId ?? definition?.strategyProfileId
      if (!profileId) {
        throw new Error(`NPC seat has no strategy profile reference: ${seat.seatId}`)
      }
      const profile = findNpcStrategyProfile(profileId, availableProfiles)
      if (seat.npcStrategyProfileVersion && profile.version !== seat.npcStrategyProfileVersion) {
        throw new Error(
          `NPC strategy profile version mismatch for ${seat.seatId}: expected ${seat.npcStrategyProfileVersion}, received ${profile.version}`,
        )
      }
      return profile
    })
}

export function gameBlueprintToControllerConfig(
  blueprint: GameBlueprint,
  npcDefinitions: readonly NpcDefinition[] = [],
  resolvedSeed: string | number = blueprint.seed,
): Partial<MatchConfig> {
  return {
    startingStack: blueprint.startingStack,
    smallBlind: blueprint.smallBlind,
    bigBlind: blueprint.bigBlind,
    seed: resolvedSeed,
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

function findNpcDefinition(
  npcDefinitionId: string,
  definitions: readonly NpcDefinition[] | undefined,
): NpcDefinition {
  return clone(definitions?.find((definition) => definition.id === npcDefinitionId) ?? mustNpcDefinition(npcDefinitionId))
}

function findNpcStrategyProfile(
  strategyProfileId: string,
  profiles: readonly NpcStrategyProfile[] | undefined,
): NpcStrategyProfile {
  return clone(profiles?.find((profile) => profile.id === strategyProfileId) ?? mustNpcStrategyProfile(strategyProfileId))
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
