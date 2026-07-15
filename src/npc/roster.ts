import type { SeatId } from '../poker-engine'
import type { NpcDefinition, NpcSeatAssignment, NpcStrategyProfile } from './config'
import { createPostflopStrategy } from './postflopStrategy'
import { createMultiFormatPreflopStrategy } from './preflopRanges'

export interface LocalNpcPresentation {
  seatId: SeatId
  npcId: string
  name: string
  archetype: string
  difficulty: 'steady'
}

export const LOCAL_NPC_STRATEGY_PROFILES: NpcStrategyProfile[] = [
  {
    id: 'strategy-balanced-caller-v4',
    version: 4,
    name: 'Balanced Caller',
    status: 'active',
    difficulty: 'steady',
    description: 'A measured baseline strategy that continues with fair prices and avoids thin pressure.',
    modules: [
      { id: 'preflop-range', enabled: true, weight: 0.55 },
      { id: 'draw-selection', enabled: true, weight: 0.45 },
      { id: 'pot-control', enabled: true, weight: 0.65 },
      { id: 'continuation-bet', enabled: true, weight: 0.55 },
      { id: 'probe-bet', enabled: true, weight: 0.35 },
      { id: 'mdf-defense', enabled: true, weight: 0.82 },
    ],
    policyConfig: {
      preflopAggression: 0.52,
      preflopLooseness: 0.36,
      postflopAggression: 0.44,
      pressureRaiseMultiplier: 2.6,
    },
    preflopStrategy: createMultiFormatPreflopStrategy({
      id: 'balanced-caller-preflop-v2',
      version: 2,
      looseness: 0.36,
      aggression: 0.52,
    }),
    postflopStrategy: createPostflopStrategy({
      id: 'balanced-caller-postflop-v2',
      version: 2,
      aggression: 0.44,
      frequencies: { pureBluff: 0.07, valueRaise: 0.66 },
      sizing: {
        dryFlopPotFraction: 0.42,
        dynamicFlopPotFraction: 0.55,
        wetFlopPotFraction: 0.66,
        turnPotFraction: 0.58,
        riverPotFraction: 0.62,
      },
      defense: {
        mdfAdherence: 0.9,
        foldBias: -0.04,
        madeHandWeight: 0.76,
        drawWeight: 0.74,
        potOddsDiscipline: 0.86,
      },
    }),
  },
  {
    id: 'strategy-pressure-raiser-v4',
    version: 4,
    name: 'Pressure Raiser',
    status: 'active',
    difficulty: 'steady',
    description: 'Applies more preflop pressure and uses larger raise targets.',
    modules: [
      { id: 'preflop-pressure', enabled: true, weight: 0.8 },
      { id: 'value-pressure', enabled: true, weight: 0.65 },
      { id: 'preflop-range', enabled: true, weight: 0.45 },
      { id: 'continuation-bet', enabled: true, weight: 0.85 },
      { id: 'barrel-selection', enabled: true, weight: 0.75 },
      { id: 'bluff-selection', enabled: true, weight: 0.65 },
      { id: 'mdf-defense', enabled: true, weight: 0.68 },
    ],
    policyConfig: {
      preflopAggression: 0.78,
      preflopLooseness: 0.31,
      postflopAggression: 0.58,
      pressureRaiseMultiplier: 3.4,
    },
    preflopStrategy: createMultiFormatPreflopStrategy({
      id: 'pressure-raiser-preflop-v2',
      version: 2,
      looseness: 0.31,
      aggression: 0.78,
      sizing: {
        openRaiseBigBlinds: 2.7,
        isolationRaiseBigBlinds: 3.5,
        threeBetOutOfPositionMultiplier: 4,
      },
    }),
    postflopStrategy: createPostflopStrategy({
      id: 'pressure-raiser-postflop-v2',
      version: 2,
      aggression: 0.78,
      frequencies: {
        cBetFlop: 0.82,
        turnBarrel: 0.7,
        riverBarrel: 0.52,
        pureBluff: 0.2,
        checkRaise: 0.38,
      },
      sizing: {
        dynamicFlopPotFraction: 0.68,
        wetFlopPotFraction: 0.78,
        turnPotFraction: 0.74,
        riverPotFraction: 0.82,
        raiseToMultiplier: 2.8,
      },
      defense: {
        mdfAdherence: 0.7,
        foldBias: 0.03,
        madeHandWeight: 0.7,
        drawWeight: 0.82,
        positionBonus: 0.12,
        shortStackCommitmentBonus: 0.16,
      },
    }),
  },
  {
    id: 'strategy-board-watcher-v4',
    version: 4,
    name: 'Board Watcher',
    status: 'active',
    difficulty: 'steady',
    description: 'Weights postflop texture and draws more heavily than preflop initiative.',
    modules: [
      { id: 'postflop-made-hand', enabled: true, weight: 0.7 },
      { id: 'draw-selection', enabled: true, weight: 0.75 },
      { id: 'pot-control', enabled: true, weight: 0.5 },
      { id: 'continuation-bet', enabled: true, weight: 0.6 },
      { id: 'probe-bet', enabled: true, weight: 0.6 },
      { id: 'bluff-selection', enabled: true, weight: 0.55 },
      { id: 'mdf-defense', enabled: true, weight: 0.76 },
    ],
    policyConfig: {
      preflopAggression: 0.46,
      preflopLooseness: 0.42,
      postflopAggression: 0.64,
      pressureRaiseMultiplier: 2.8,
    },
    preflopStrategy: createMultiFormatPreflopStrategy({
      id: 'board-watcher-preflop-v2',
      version: 2,
      looseness: 0.42,
      aggression: 0.46,
    }),
    postflopStrategy: createPostflopStrategy({
      id: 'board-watcher-postflop-v2',
      version: 2,
      aggression: 0.64,
      frequencies: { semiBluff: 0.78, probeBet: 0.46 },
      sizing: { dynamicFlopPotFraction: 0.64, wetFlopPotFraction: 0.74 },
      modifiers: { wetBoardBluffPenalty: 0.05 },
      defense: {
        mdfAdherence: 0.78,
        foldBias: 0,
        drawWeight: 0.92,
        potOddsDiscipline: 0.88,
        rangeDisadvantagePenalty: 0.36,
      },
    }),
  },
  {
    id: 'strategy-pot-controller-v4',
    version: 4,
    name: 'Pot Controller',
    status: 'active',
    difficulty: 'steady',
    description: 'Keeps marginal situations smaller and chooses fewer pressure lines.',
    modules: [
      { id: 'pot-control', enabled: true, weight: 0.85 },
      { id: 'preflop-range', enabled: true, weight: 0.5 },
      { id: 'postflop-made-hand', enabled: true, weight: 0.5 },
      { id: 'continuation-bet', enabled: true, weight: 0.4 },
      { id: 'barrel-selection', enabled: true, weight: 0.25 },
      { id: 'mdf-defense', enabled: true, weight: 0.64 },
    ],
    policyConfig: {
      preflopAggression: 0.4,
      preflopLooseness: 0.28,
      postflopAggression: 0.34,
      pressureRaiseMultiplier: 2.3,
    },
    preflopStrategy: createMultiFormatPreflopStrategy({
      id: 'pot-controller-preflop-v2',
      version: 2,
      looseness: 0.28,
      aggression: 0.4,
      sizing: {
        openRaiseBigBlinds: 2.25,
        isolationRaiseBigBlinds: 2.75,
      },
    }),
    postflopStrategy: createPostflopStrategy({
      id: 'pot-controller-postflop-v2',
      version: 2,
      aggression: 0.3,
      frequencies: {
        cBetFlop: 0.48,
        turnBarrel: 0.3,
        riverBarrel: 0.2,
        semiBluff: 0.28,
        pureBluff: 0.03,
        checkRaise: 0.08,
      },
      sizing: {
        dryFlopPotFraction: 0.36,
        dynamicFlopPotFraction: 0.48,
        wetFlopPotFraction: 0.58,
        turnPotFraction: 0.52,
        riverPotFraction: 0.58,
        raiseToMultiplier: 2.2,
      },
      defense: {
        mdfAdherence: 0.66,
        foldBias: 0.12,
        madeHandWeight: 0.84,
        drawWeight: 0.58,
        potOddsDiscipline: 0.94,
        multiwayPenalty: 0.16,
      },
    }),
  },
  {
    id: 'strategy-value-hunter-v4',
    version: 4,
    name: 'Value Hunter',
    status: 'active',
    difficulty: 'steady',
    description: 'Prioritizes made-hand value and solid calls over speculative pressure.',
    modules: [
      { id: 'postflop-made-hand', enabled: true, weight: 0.78 },
      { id: 'value-pressure', enabled: true, weight: 0.58 },
      { id: 'draw-selection', enabled: true, weight: 0.35 },
      { id: 'continuation-bet', enabled: true, weight: 0.55 },
      { id: 'barrel-selection', enabled: true, weight: 0.5 },
      { id: 'mdf-defense', enabled: true, weight: 0.72 },
    ],
    policyConfig: {
      preflopAggression: 0.58,
      preflopLooseness: 0.3,
      postflopAggression: 0.52,
      pressureRaiseMultiplier: 2.9,
    },
    preflopStrategy: createMultiFormatPreflopStrategy({
      id: 'value-hunter-preflop-v2',
      version: 2,
      looseness: 0.3,
      aggression: 0.58,
    }),
    postflopStrategy: createPostflopStrategy({
      id: 'value-hunter-postflop-v2',
      version: 2,
      aggression: 0.56,
      frequencies: { pureBluff: 0.04, valueRaise: 0.82, checkRaise: 0.2 },
      thresholds: {
        valueBetStrength: 0.56,
        thinValueStrength: 0.42,
        valueRaiseStrength: 0.72,
      },
      sizing: { turnPotFraction: 0.7, riverPotFraction: 0.78 },
      defense: {
        mdfAdherence: 0.74,
        foldBias: 0.02,
        madeHandWeight: 0.96,
        drawWeight: 0.52,
        rangeDisadvantagePenalty: 0.22,
        shortStackCommitmentBonus: 0.2,
      },
    }),
  },
]

export const LOCAL_NPC_DEFINITIONS: NpcDefinition[] = [
  {
    id: 'npc-maven',
    name: 'Maven',
    archetypeLabel: 'Measured caller',
    description: 'A careful regular who prefers clean prices and steady value.',
    avatarKey: 'maven',
    strategyProfileId: 'strategy-balanced-caller-v4',
    status: 'active',
  },
  {
    id: 'npc-rook',
    name: 'Rook',
    archetypeLabel: 'Pressure raiser',
    description: 'A table captain who tests passive lines before and after the flop.',
    avatarKey: 'rook',
    strategyProfileId: 'strategy-pressure-raiser-v4',
    status: 'active',
  },
  {
    id: 'npc-quinn',
    name: 'Quinn',
    archetypeLabel: 'Board watcher',
    description: 'A texture-aware opponent who respects coordinated boards.',
    avatarKey: 'quinn',
    strategyProfileId: 'strategy-board-watcher-v4',
    status: 'active',
  },
  {
    id: 'npc-sol',
    name: 'Sol',
    archetypeLabel: 'Pot controller',
    description: 'A low-variance opponent who keeps marginal spots contained.',
    avatarKey: 'sol',
    strategyProfileId: 'strategy-pot-controller-v4',
    status: 'active',
  },
  {
    id: 'npc-vega',
    name: 'Vega',
    archetypeLabel: 'Value hunter',
    description: 'A value-first opponent who leans into made hands.',
    avatarKey: 'vega',
    strategyProfileId: 'strategy-value-hunter-v4',
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
