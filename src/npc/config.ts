import type { PositionLabel, SeatId } from '../poker-engine'
import type { NpcPolicyConfig } from './basicNpc'

export type NpcDefinitionStatus = 'draft' | 'active' | 'retired'
export type NpcTeachingTendencyId =
  | 'overfolds-blinds'
  | 'calls-too-wide'
  | 'raises-too-often'
  | 'cbet-one-and-done'
  | 'barrels-too-often'
  | 'barrels-too-rarely'
  | 'chases-draws'
  | 'overvalues-top-pair'
  | 'underbluffs-river'
  | 'overbluffs-river'
  | 'uses-small-sizing'
  | 'uses-large-sizing'
  | 'avoids-thin-value'
  | 'traps-strong-hands'

export const NPC_TEACHING_TENDENCY_IDS: NpcTeachingTendencyId[] = [
  'overfolds-blinds',
  'calls-too-wide',
  'raises-too-often',
  'cbet-one-and-done',
  'barrels-too-often',
  'barrels-too-rarely',
  'chases-draws',
  'overvalues-top-pair',
  'underbluffs-river',
  'overbluffs-river',
  'uses-small-sizing',
  'uses-large-sizing',
  'avoids-thin-value',
  'traps-strong-hands',
]

export interface NpcTeachingTendency {
  id: NpcTeachingTendencyId
  note?: string
}

export interface NpcTeachingProfile {
  teachingObjective: string
  conceptTags: string[]
  intendedTendencies: NpcTeachingTendency[]
  intentionallyExploitable: boolean
  playerLesson?: string
  fallbackWarningThreshold?: number
}
export type NpcStrategyTargetPresetId =
  | 'balanced'
  | 'pressure'
  | 'pot-control'
  | 'value-first'
  | 'draw-pressure'
  | 'custom'
export type NpcStrategyCalibrationMetricId =
  | 'preflop.vpip'
  | 'preflop.openRaise'
  | 'preflop.threeBet'
  | 'preflop.foldToThreeBet'
  | 'defense.continue'
  | 'defense.largeBetContinue'
  | 'defense.drawContinue'
  | 'proactive.bet'
  | 'proactive.continuationBet'
  | 'proactive.barrel'
  | 'proactive.semiBluff'
  | 'proactive.valueBet'
  | 'proactive.bluffBet'
  | 'proactive.averagePotFraction'

export interface NpcStrategyCalibrationBand {
  min: number
  max: number
}

export interface NpcStrategyCalibrationTarget {
  schemaVersion: 'npc-strategy-target-v1'
  presetId: NpcStrategyTargetPresetId
  bands: Partial<Record<NpcStrategyCalibrationMetricId, NpcStrategyCalibrationBand>>
}

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
  teaching?: NpcTeachingProfile
  modules: NpcStrategyModule[]
  calibrationTarget?: NpcStrategyCalibrationTarget
  policyConfig: NpcPolicyConfig
  preflopStrategy?: NpcPreflopStrategy
  postflopStrategy?: NpcPostflopStrategy
}

export interface NpcSeatAssignment {
  seatId: SeatId
  npcDefinitionId: string
}
