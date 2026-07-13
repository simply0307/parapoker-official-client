import type { SeatId } from '../poker-engine'
import type { NpcDefinition, NpcSeatAssignment, NpcStrategyProfile } from './config'

export interface LocalNpcPresentation {
  seatId: SeatId
  npcId: string
  name: string
  archetype: string
  difficulty: 'steady'
}

export const LOCAL_NPC_STRATEGY_PROFILES: NpcStrategyProfile[] = [
  {
    id: 'strategy-balanced-caller-v1',
    version: 1,
    name: 'Balanced Caller',
    status: 'active',
    difficulty: 'steady',
    description: 'A measured baseline strategy that continues with fair prices and avoids thin pressure.',
    modules: [
      { id: 'preflop-range', enabled: true, weight: 0.55 },
      { id: 'draw-selection', enabled: true, weight: 0.45 },
      { id: 'pot-control', enabled: true, weight: 0.65 },
    ],
    policyConfig: {
      preflopAggression: 0.52,
      preflopLooseness: 0.36,
      postflopAggression: 0.44,
      pressureRaiseMultiplier: 2.6,
    },
  },
  {
    id: 'strategy-pressure-raiser-v1',
    version: 1,
    name: 'Pressure Raiser',
    status: 'active',
    difficulty: 'steady',
    description: 'Applies more preflop pressure and uses larger raise targets.',
    modules: [
      { id: 'preflop-pressure', enabled: true, weight: 0.8 },
      { id: 'value-pressure', enabled: true, weight: 0.65 },
      { id: 'preflop-range', enabled: true, weight: 0.45 },
    ],
    policyConfig: {
      preflopAggression: 0.78,
      preflopLooseness: 0.31,
      postflopAggression: 0.58,
      pressureRaiseMultiplier: 3.4,
    },
  },
  {
    id: 'strategy-board-watcher-v1',
    version: 1,
    name: 'Board Watcher',
    status: 'active',
    difficulty: 'steady',
    description: 'Weights postflop texture and draws more heavily than preflop initiative.',
    modules: [
      { id: 'postflop-made-hand', enabled: true, weight: 0.7 },
      { id: 'draw-selection', enabled: true, weight: 0.75 },
      { id: 'pot-control', enabled: true, weight: 0.5 },
    ],
    policyConfig: {
      preflopAggression: 0.46,
      preflopLooseness: 0.42,
      postflopAggression: 0.64,
      pressureRaiseMultiplier: 2.8,
    },
  },
  {
    id: 'strategy-pot-controller-v1',
    version: 1,
    name: 'Pot Controller',
    status: 'active',
    difficulty: 'steady',
    description: 'Keeps marginal situations smaller and chooses fewer pressure lines.',
    modules: [
      { id: 'pot-control', enabled: true, weight: 0.85 },
      { id: 'preflop-range', enabled: true, weight: 0.5 },
      { id: 'postflop-made-hand', enabled: true, weight: 0.5 },
    ],
    policyConfig: {
      preflopAggression: 0.4,
      preflopLooseness: 0.28,
      postflopAggression: 0.34,
      pressureRaiseMultiplier: 2.3,
    },
  },
  {
    id: 'strategy-value-hunter-v1',
    version: 1,
    name: 'Value Hunter',
    status: 'active',
    difficulty: 'steady',
    description: 'Prioritizes made-hand value and solid calls over speculative pressure.',
    modules: [
      { id: 'postflop-made-hand', enabled: true, weight: 0.78 },
      { id: 'value-pressure', enabled: true, weight: 0.58 },
      { id: 'draw-selection', enabled: true, weight: 0.35 },
    ],
    policyConfig: {
      preflopAggression: 0.58,
      preflopLooseness: 0.3,
      postflopAggression: 0.52,
      pressureRaiseMultiplier: 2.9,
    },
  },
]

export const LOCAL_NPC_DEFINITIONS: NpcDefinition[] = [
  {
    id: 'npc-maven',
    name: 'Maven',
    archetypeLabel: 'Measured caller',
    description: 'A careful regular who prefers clean prices and steady value.',
    avatarKey: 'maven',
    strategyProfileId: 'strategy-balanced-caller-v1',
    status: 'active',
  },
  {
    id: 'npc-rook',
    name: 'Rook',
    archetypeLabel: 'Pressure raiser',
    description: 'A table captain who tests passive lines before and after the flop.',
    avatarKey: 'rook',
    strategyProfileId: 'strategy-pressure-raiser-v1',
    status: 'active',
  },
  {
    id: 'npc-quinn',
    name: 'Quinn',
    archetypeLabel: 'Board watcher',
    description: 'A texture-aware opponent who respects coordinated boards.',
    avatarKey: 'quinn',
    strategyProfileId: 'strategy-board-watcher-v1',
    status: 'active',
  },
  {
    id: 'npc-sol',
    name: 'Sol',
    archetypeLabel: 'Pot controller',
    description: 'A low-variance opponent who keeps marginal spots contained.',
    avatarKey: 'sol',
    strategyProfileId: 'strategy-pot-controller-v1',
    status: 'active',
  },
  {
    id: 'npc-vega',
    name: 'Vega',
    archetypeLabel: 'Value hunter',
    description: 'A value-first opponent who leans into made hands.',
    avatarKey: 'vega',
    strategyProfileId: 'strategy-value-hunter-v1',
    status: 'active',
  },
]

export const DEFAULT_HEADS_UP_NPC_LINEUP: NpcSeatAssignment[] = [{ seatId: 'npc-1', npcDefinitionId: 'npc-maven' }]

export const DEFAULT_SIX_MAX_NPC_LINEUP: NpcSeatAssignment[] = [
  { seatId: 'npc-1', npcDefinitionId: 'npc-maven' },
  { seatId: 'npc-2', npcDefinitionId: 'npc-rook' },
  { seatId: 'npc-3', npcDefinitionId: 'npc-quinn' },
  { seatId: 'npc-4', npcDefinitionId: 'npc-sol' },
  { seatId: 'npc-5', npcDefinitionId: 'npc-vega' },
]

export const LOCAL_NPC_ROSTER = DEFAULT_SIX_MAX_NPC_LINEUP.map((assignment) => {
  const definition = mustNpcDefinition(assignment.npcDefinitionId)
  const profile = mustNpcStrategyProfile(definition.strategyProfileId)
  return toPresentation(assignment.seatId, definition, profile)
})

export function localNpcDefinition(npcDefinitionId: string): NpcDefinition | undefined {
  return LOCAL_NPC_DEFINITIONS.find((npc) => npc.id === npcDefinitionId)
}

export function localNpcStrategyProfile(strategyProfileId: string): NpcStrategyProfile | undefined {
  return LOCAL_NPC_STRATEGY_PROFILES.find((profile) => profile.id === strategyProfileId)
}

export function localNpcDefinitionForSeat(
  seatId: SeatId,
  lineup: readonly NpcSeatAssignment[] = DEFAULT_SIX_MAX_NPC_LINEUP,
): NpcDefinition | undefined {
  const assignment = lineup.find((entry) => entry.seatId === seatId)
  return assignment ? localNpcDefinition(assignment.npcDefinitionId) : undefined
}

export function localNpcPresentation(seatId: SeatId): LocalNpcPresentation | undefined {
  const definition = localNpcDefinitionForSeat(seatId)
  if (!definition) {
    return undefined
  }
  return toPresentation(seatId, definition, mustNpcStrategyProfile(definition.strategyProfileId))
}

export function localNpcPresentationForDefinition(
  seatId: SeatId,
  npcDefinitionId: string,
): LocalNpcPresentation | undefined {
  const definition = localNpcDefinition(npcDefinitionId)
  if (!definition) {
    return undefined
  }
  return toPresentation(seatId, definition, mustNpcStrategyProfile(definition.strategyProfileId))
}

export function mustNpcDefinition(npcDefinitionId: string): NpcDefinition {
  const definition = localNpcDefinition(npcDefinitionId)
  if (!definition) {
    throw new Error(`Unknown NPC definition: ${npcDefinitionId}`)
  }
  return definition
}

export function mustNpcStrategyProfile(strategyProfileId: string): NpcStrategyProfile {
  const profile = localNpcStrategyProfile(strategyProfileId)
  if (!profile) {
    throw new Error(`Unknown NPC strategy profile: ${strategyProfileId}`)
  }
  return profile
}

function toPresentation(
  seatId: SeatId,
  definition: NpcDefinition,
  profile: NpcStrategyProfile,
): LocalNpcPresentation {
  return {
    seatId,
    npcId: definition.id,
    name: definition.name,
    archetype: definition.archetypeLabel,
    difficulty: profile.difficulty,
  }
}
