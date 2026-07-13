import type { PlayerStatus, SeatId } from './types'

export type PositionLabel = 'BTN/SB' | 'BTN' | 'SB' | 'BB' | 'UTG' | 'HJ' | 'CO'

export interface PositionSeat {
  id: SeatId
  stack: number
  status: PlayerStatus
}

export interface SeatPositionAssignment {
  seatId: SeatId
  position: PositionLabel
}

const POSITION_LABELS: Record<number, PositionLabel[]> = {
  2: ['BTN/SB', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'UTG'],
  5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
}

export function assignSeatPositions(seats: PositionSeat[], dealerSeatId: SeatId): SeatPositionAssignment[] {
  const fundedSeats = seats.filter((seat) => seat.stack > 0 && seat.status !== 'out')
  const labels = POSITION_LABELS[fundedSeats.length]
  if (!labels) {
    return []
  }

  const orderedSeats = orderFromSeat(fundedSeats, dealerSeatId)
  if (orderedSeats.length !== fundedSeats.length) {
    return []
  }

  return orderedSeats.map((seat, index) => ({
    seatId: seat.id,
    position: labels[index],
  }))
}

export function positionForSeat(
  seats: PositionSeat[],
  dealerSeatId: SeatId | undefined,
  seatId: SeatId,
): PositionLabel | undefined {
  if (!dealerSeatId) {
    return undefined
  }
  return assignSeatPositions(seats, dealerSeatId).find((assignment) => assignment.seatId === seatId)?.position
}

function orderFromSeat<TSeat extends { id: SeatId }>(seats: TSeat[], fromSeatId: SeatId): TSeat[] {
  const startIndex = seats.findIndex((seat) => seat.id === fromSeatId)
  if (startIndex < 0) {
    return []
  }
  return [...seats.slice(startIndex), ...seats.slice(0, startIndex)]
}
