import type { SeatId } from '../poker-engine'

export interface LocalNpcPresentation {
  seatId: SeatId
  name: string
  archetype: string
  difficulty: 'steady'
}

export const LOCAL_NPC_ROSTER: LocalNpcPresentation[] = [
  { seatId: 'npc-1', name: 'Maven', archetype: 'Measured caller', difficulty: 'steady' },
  { seatId: 'npc-2', name: 'Rook', archetype: 'Pressure raiser', difficulty: 'steady' },
  { seatId: 'npc-3', name: 'Quinn', archetype: 'Board watcher', difficulty: 'steady' },
  { seatId: 'npc-4', name: 'Sol', archetype: 'Pot controller', difficulty: 'steady' },
  { seatId: 'npc-5', name: 'Vega', archetype: 'Value hunter', difficulty: 'steady' },
]

export function localNpcPresentation(seatId: SeatId): LocalNpcPresentation | undefined {
  return LOCAL_NPC_ROSTER.find((npc) => npc.seatId === seatId)
}
