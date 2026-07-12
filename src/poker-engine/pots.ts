import type { SeatId } from './types'

export interface PotConstructionResult {
  pots: Array<{ amount: number; eligibleSeatIds: SeatId[] }>
  refunds: Array<{ seatId: SeatId; amount: number }>
}

export function constructPots(
  contributions: Record<SeatId, number>,
  eligibleSeatIds: SeatId[],
): PotConstructionResult {
  const remaining = new Map(
    Object.entries(contributions)
      .filter(([, amount]) => amount > 0)
      .map(([seatId, amount]) => [seatId, amount]),
  )
  const eligibleSet = new Set(eligibleSeatIds)
  const pots: PotConstructionResult['pots'] = []
  const refunds: PotConstructionResult['refunds'] = []

  while (remaining.size > 0) {
    const layer = Math.min(...remaining.values())
    const participantIds = Array.from(remaining.keys())
    const eligibleInLayer = participantIds.filter((seatId) => eligibleSet.has(seatId))

    if (eligibleInLayer.length === 1 && participantIds.length === 1) {
      refunds.push({ seatId: eligibleInLayer[0], amount: layer })
    } else if (eligibleInLayer.length > 0) {
      pots.push({ amount: layer * participantIds.length, eligibleSeatIds: eligibleInLayer })
    }

    for (const seatId of participantIds) {
      const nextAmount = (remaining.get(seatId) ?? 0) - layer
      if (nextAmount > 0) {
        remaining.set(seatId, nextAmount)
      } else {
        remaining.delete(seatId)
      }
    }
  }

  return { pots, refunds }
}
