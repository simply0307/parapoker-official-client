import type { PrivateSeatView } from '../poker-engine'

export function isPostflopInPosition(view: PrivateSeatView): boolean {
  const dealerIndex = view.seats.findIndex((seat) => seat.isDealer)
  if (dealerIndex < 0) {
    return false
  }
  const actionOrder = [
    ...view.seats.slice(dealerIndex + 1),
    ...view.seats.slice(0, dealerIndex + 1),
  ].filter((seat) => seat.status === 'active' && seat.stack > 0)

  return actionOrder.length > 1 && actionOrder.at(-1)?.id === view.heroSeatId
}
