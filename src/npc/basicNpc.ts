import { createRng, type Rng } from '../shared/rng'
import type { EngineCommand, LegalAction, PrivateSeatView } from '../poker-engine'

export interface NpcPolicy {
  chooseAction(view: PrivateSeatView): EngineCommand
}

export class BasicNpcPolicy implements NpcPolicy {
  private rng: Rng

  constructor(seed: string | number = 'basic-npc') {
    this.rng = createRng(seed)
  }

  chooseAction(view: PrivateSeatView): EngineCommand {
    const legal = view.legalActions
    const seatId = view.heroSeatId
    const check = legal.find((action) => action.type === 'check')
    const call = legal.find((action) => action.type === 'call')
    const fold = legal.find((action) => action.type === 'fold')
    const bet = legal.find((action) => action.type === 'bet')
    const raise = legal.find((action) => action.type === 'raise')
    const allIn = legal.find((action) => action.type === 'allIn')

    if (call && shouldContinue(call, view, this.rng.next())) {
      return { type: 'call', seatId, source: 'npc' }
    }

    if (call && fold) {
      return { type: 'fold', seatId, source: 'npc' }
    }

    if (check && bet && this.rng.next() < 0.22) {
      return { type: 'bet', seatId, amount: bet.min, source: 'npc' }
    }

    if (raise && this.rng.next() < 0.12) {
      return { type: 'raise', seatId, amount: raise.min, source: 'npc' }
    }

    if (check) {
      return { type: 'check', seatId, source: 'npc' }
    }

    if (allIn) {
      return { type: 'allIn', seatId, source: 'npc' }
    }

    throw new Error('NPC was asked to act with no legal actions.')
  }
}

function shouldContinue(call: Extract<LegalAction, { type: 'call' }>, view: PrivateSeatView, roll: number): boolean {
  const hero = view.seats.find((seat) => seat.id === view.heroSeatId)
  const stack = hero?.stack ?? 0
  const cheapCall = call.amount <= 2
  const modestCall = stack > 0 && call.amount / stack <= 0.18
  return cheapCall || modestCall || roll < 0.35
}
