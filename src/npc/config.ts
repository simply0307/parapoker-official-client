import type { SeatId } from '../poker-engine'
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

export interface NpcStrategyProfile {
  id: string
  version: number
  name: string
  description?: string
  status: NpcDefinitionStatus
  difficulty: 'steady'
  modules: NpcStrategyModule[]
  policyConfig: NpcPolicyConfig
}

export interface NpcSeatAssignment {
  seatId: SeatId
  npcDefinitionId: string
}
