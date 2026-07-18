import type { EngineCommand, SeatId, Street } from '../poker-engine'

export type NpcDecisionSource =
  | 'preflop-range'
  | 'proactive-postflop'
  | 'postflop-defense'
  | 'legacy-fallback'
  | 'safety-fallback'

export interface NpcDecisionIdentity {
  npcDefinitionId: string
  strategyProfileId: string
  strategyProfileVersion: number
  teachingTags: string[]
}

export interface NpcDecisionTrace {
  schemaVersion: 'npc-decision-trace-v1'
  npcDefinitionId: string
  strategyProfileId: string
  strategyProfileVersion: number
  handNumber: number
  seatId: SeatId
  street: Street | 'between-hands'
  decisionSource: NpcDecisionSource
  situationId?: string
  handClass?: string
  consideredActions: string[]
  selectedAction: EngineCommand['type']
  selectedAmount?: number
  configuredValues: Record<string, number | string | boolean>
  calculatedValues: Record<string, number | string | boolean>
  probability?: number
  rngRoll?: number
  reasonCode: string
  teachingTags: string[]
}

export interface NpcDecisionResult {
  command: EngineCommand
  trace: NpcDecisionTrace
}

export function commandAmount(command: EngineCommand): number | undefined {
  return 'amount' in command ? command.amount : undefined
}

export function traceContainsRestrictedState(trace: NpcDecisionTrace): boolean {
  const serialized = JSON.stringify(trace).toLowerCase()
  return ['deck', 'rngstate', 'rng_state', 'entropy', 'opponenthole', 'opponent_hole']
    .some((token) => serialized.includes(token))
}
