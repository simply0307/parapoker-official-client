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
  hands: Record<string, NpcPreflopActionFrequency[]>
}

export interface NpcPreflopSizingConfig {
  openRaiseBigBlinds: number
  isolationRaiseBigBlinds: number
  threeBetInPositionMultiplier: number
  threeBetOutOfPositionMultiplier: number
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
}

export interface NpcSeatAssignment {
  seatId: SeatId
  npcDefinitionId: string
}
