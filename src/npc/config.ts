import type { PositionLabel, SeatId } from '../poker-engine'
import type { NpcPolicyConfig } from './basicNpc'

export type NpcDefinitionStatus = 'draft' | 'active' | 'retired'
export type NpcStrategyModuleId =
  | 'preflop-range'
  | 'preflop-pressure'
  | 'postflop-made-hand'
  | 'draw-selection'
  | 'pot-control'
  | 'value-pressure'
  | 'continuation-bet'
  | 'probe-bet'
  | 'barrel-selection'
  | 'bluff-selection'
  | 'mdf-defense'

export interface NpcDefinition {
  id: string
  name: string
  archetypeLabel: string
  description?: string
  avatarKey?: string
  strategyProfileId: string
  status: NpcDefinitionStatus
}

export interface NpcStrategyModule {
  id: NpcStrategyModuleId
  enabled: boolean
  weight: number
  settings?: Record<string, number | string | boolean>
}

export type NpcPreflopFormat = 'heads-up' | 'six-max'
export type NpcPreflopStackDepth = 'short' | 'medium' | 'deep'
export type NpcPreflopSituation =
  | 'unopened'
  | 'facingLimp'
  | 'facingOpen'
  | 'facingOpenWithCallers'
  | 'facingRaiseAfterLimp'
  | 'facingThreeBet'
  | 'facingFourBet'
export type NpcPreflopRaiseSizeBucket = 'none' | 'small' | 'medium' | 'large' | 'allIn'
export type NpcPreflopAction = 'fold' | 'check' | 'call' | 'raise' | 'allIn'

export interface NpcPreflopActionFrequency {
  action: NpcPreflopAction
  frequency: number
}

export interface NpcPreflopRangeNode {
  id: string
  formats: NpcPreflopFormat[]
  positions: PositionLabel[]
  stackDepths: NpcPreflopStackDepth[]
  situations: NpcPreflopSituation[]
  raiseSizeBuckets?: NpcPreflopRaiseSizeBucket[]
  aggressorPositions?: PositionLabel[]
  minimumLimpers?: number
  minimumCallers?: number
  hands: Record<string, NpcPreflopActionFrequency[]>
}

export interface NpcPreflopSizingConfig {
  openRaiseBigBlinds: number
  isolationRaiseBigBlinds: number
  threeBetInPositionMultiplier: number
  threeBetOutOfPositionMultiplier: number
  squeezeInPositionMultiplier: number
  squeezeOutOfPositionMultiplier: number
  fourBetMultiplier: number
}

export interface NpcPreflopStrategy {
  schemaVersion: 'npc-preflop-v1'
  id: string
  version: number
  description?: string
  nodes: NpcPreflopRangeNode[]
  sizing: NpcPreflopSizingConfig
}

export interface NpcPostflopFrequencies {
  cBetFlop: number
  delayedCBetTurn: number
  probeBet: number
  turnBarrel: number
  riverBarrel: number
  semiBluff: number
  pureBluff: number
  valueRaise: number
  checkRaise: number
}

export interface NpcPostflopSizingConfig {
  dryFlopPotFraction: number
  dynamicFlopPotFraction: number
  wetFlopPotFraction: number
  turnPotFraction: number
  riverPotFraction: number
  raiseToMultiplier: number
}

export interface NpcPostflopThresholds {
  valueBetStrength: number
  thinValueStrength: number
  valueRaiseStrength: number
}

export interface NpcPostflopModifiers {
  rangeAdvantageWeight: number
  positionBonus: number
  multiwayPenalty: number
  wetBoardBluffPenalty: number
  shortStackAggressionBonus: number
}

export interface NpcPostflopDefenseConfig {
  mdfAdherence: number
  foldBias: number
  madeHandWeight: number
  drawWeight: number
  potOddsDiscipline: number
  positionBonus: number
  rangeDisadvantagePenalty: number
  multiwayPenalty: number
  shortStackCommitmentBonus: number
}

export interface NpcPostflopStrategy {
  schemaVersion: 'npc-postflop-v1'
  id: string
  version: number
  description?: string
  frequencies: NpcPostflopFrequencies
  sizing: NpcPostflopSizingConfig
  thresholds: NpcPostflopThresholds
  modifiers: NpcPostflopModifiers
  defense?: NpcPostflopDefenseConfig
}

export interface NpcStrategyProfile {
  id: string
  version: number
  name: string
  description?: string
  status: NpcDefinitionStatus
  difficulty: 'steady'
  modules: NpcStrategyModule[]
  policyConfig: NpcPolicyConfig
  preflopStrategy?: NpcPreflopStrategy
  postflopStrategy?: NpcPostflopStrategy
}

export interface NpcSeatAssignment {
  seatId: SeatId
  npcDefinitionId: string
}
