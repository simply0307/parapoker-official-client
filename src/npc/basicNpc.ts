import type { Rng } from '../shared/rng'
import type { Card, EngineCommand, LegalAction, PrivateSeatView, Rank, SeatId } from '../poker-engine'

export interface NpcPolicyConfig {
  preflopAggression: number
  preflopLooseness: number
  pressureRaiseMultiplier: number
}

export interface NpcTableMemory {
  readonly handsObserved?: number
}

export interface NpcDecisionContext {
  view: PrivateSeatView
  legalActions: LegalAction[]
  config: NpcPolicyConfig
  memory: NpcTableMemory
  rng: Rng
}

export interface NpcPolicy {
  chooseAction(context: NpcDecisionContext): EngineCommand
}

export const DEFAULT_NPC_POLICY_CONFIG: NpcPolicyConfig = {
  preflopAggression: 0.62,
  preflopLooseness: 0.34,
  pressureRaiseMultiplier: 3,
}

const RANK_VALUES: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
}

type PreflopTier = 'premium' | 'strong' | 'playable' | 'speculative' | 'trash'

export function createNpcDecisionContext(
  view: PrivateSeatView,
  rng: Rng,
  config: Partial<NpcPolicyConfig> = {},
  memory: NpcTableMemory = {},
): NpcDecisionContext {
  return {
    view,
    legalActions: view.legalActions,
    config: { ...DEFAULT_NPC_POLICY_CONFIG, ...config },
    memory,
    rng,
  }
}

export class BasicNpcPolicy implements NpcPolicy {
  chooseAction(context: NpcDecisionContext): EngineCommand {
    if (context.view.street === 'preflop' && context.view.holeCards.length === 2) {
      return choosePreflopAction(context)
    }

    return chooseFallbackAction(context)
  }
}

function choosePreflopAction(context: NpcDecisionContext): EngineCommand {
  const { view, legalActions } = context
  const seatId = view.heroSeatId
  const tier = classifyPreflop(view.holeCards)
  const call = findAction(legalActions, 'call')
  const fold = findAction(legalActions, 'fold')
  const check = findAction(legalActions, 'check')
  const pressure = findAction(legalActions, 'raise') ?? findAction(legalActions, 'bet')
  const allIn = findAction(legalActions, 'allIn')
  const callPrice = call ? call.amount / Math.max(1, view.pot + call.amount) : 0
  const effectiveStack = getEffectiveStack(view)

  if (tier === 'premium') {
    if (pressure) {
      return pressureCommand(pressure, seatId, context)
    }
    if (call) {
      return { type: 'call', seatId, source: 'npc' }
    }
    if (allIn) {
      return { type: 'allIn', seatId, source: 'npc' }
    }
  }

  if (tier === 'strong') {
    if (!call && pressure && context.rng.next() < context.config.preflopAggression) {
      return pressureCommand(pressure, seatId, context)
    }
    if (call && (callPrice <= 0.36 || call.amount / effectiveStack <= 0.12 || call.amount <= view.minRaise * 3)) {
      return { type: 'call', seatId, source: 'npc' }
    }
  }

  if (tier === 'playable') {
    if (call && (callPrice <= 0.26 || call.amount / effectiveStack <= 0.06 || call.amount <= view.minRaise)) {
      return { type: 'call', seatId, source: 'npc' }
    }
    if (!call && pressure && context.rng.next() < context.config.preflopAggression * 0.28) {
      return pressureCommand(pressure, seatId, context)
    }
  }

  if (tier === 'speculative') {
    if (call && callPrice <= 0.18 && call.amount / effectiveStack <= 0.05 && context.rng.next() < context.config.preflopLooseness) {
      return { type: 'call', seatId, source: 'npc' }
    }
    if (!call && check) {
      return { type: 'check', seatId, source: 'npc' }
    }
  }

  if (call && fold) {
    return { type: 'fold', seatId, source: 'npc' }
  }
  if (check) {
    return { type: 'check', seatId, source: 'npc' }
  }
  if (allIn) {
    return { type: 'allIn', seatId, source: 'npc' }
  }

  throw new Error('NPC was asked to act with no legal actions.')
}

function chooseFallbackAction(context: NpcDecisionContext): EngineCommand {
  const legal = context.legalActions
  const seatId = context.view.heroSeatId
  const check = findAction(legal, 'check')
  const call = findAction(legal, 'call')
  const fold = findAction(legal, 'fold')
  const bet = findAction(legal, 'bet')
  const raise = findAction(legal, 'raise')
  const allIn = findAction(legal, 'allIn')

  if (call && shouldContinue(call, context)) {
    return { type: 'call', seatId, source: 'npc' }
  }

  if (call && fold) {
    return { type: 'fold', seatId, source: 'npc' }
  }

  if (check && bet && context.rng.next() < 0.18) {
    return { type: 'bet', seatId, amount: bet.min, source: 'npc' }
  }

  if (raise && context.rng.next() < 0.08) {
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

function classifyPreflop(cards: Card[]): PreflopTier {
  const [first, second] = cards
  const high = Math.max(RANK_VALUES[first.rank], RANK_VALUES[second.rank])
  const low = Math.min(RANK_VALUES[first.rank], RANK_VALUES[second.rank])
  const pair = first.rank === second.rank
  const suited = first.suit === second.suit
  const gap = high - low

  if (pair && high >= RANK_VALUES.J) {
    return 'premium'
  }
  if (high === RANK_VALUES.A && low >= RANK_VALUES.K) {
    return 'premium'
  }
  if (pair && high >= RANK_VALUES['8']) {
    return 'strong'
  }
  if (high === RANK_VALUES.A && (low >= RANK_VALUES.T || suited)) {
    return 'strong'
  }
  if (high >= RANK_VALUES.K && low >= RANK_VALUES.J) {
    return suited ? 'strong' : 'playable'
  }
  if (pair) {
    return 'playable'
  }
  if (suited && high >= RANK_VALUES.T && gap <= 2) {
    return 'playable'
  }
  if (suited && gap <= 2 && high >= RANK_VALUES['8']) {
    return 'speculative'
  }
  if (high >= RANK_VALUES.Q && low >= RANK_VALUES.T) {
    return 'speculative'
  }

  return 'trash'
}

function pressureCommand(
  action: Extract<LegalAction, { type: 'bet' | 'raise' }>,
  seatId: SeatId,
  context: NpcDecisionContext,
): EngineCommand {
  const amount = pressureAmount(action, context)
  if (action.type === 'bet') {
    return { type: 'bet', seatId, amount, source: 'npc' }
  }
  return { type: 'raise', seatId, amount, source: 'npc' }
}

function pressureAmount(action: Extract<LegalAction, { type: 'bet' | 'raise' }>, context: NpcDecisionContext): number {
  const target = Math.max(action.min, Math.round(context.view.currentBet * context.config.pressureRaiseMultiplier))
  const stackAwareCap = Math.max(action.min, Math.round(getEffectiveStack(context.view) * 0.35))
  return Math.min(action.max, stackAwareCap, target)
}

function shouldContinue(call: Extract<LegalAction, { type: 'call' }>, context: NpcDecisionContext): boolean {
  const hero = context.view.seats.find((seat) => seat.id === context.view.heroSeatId)
  const stack = hero?.stack ?? 0
  const cheapCall = call.amount <= context.view.minRaise
  const modestCall = stack > 0 && call.amount / stack <= 0.16
  return cheapCall || modestCall || context.rng.next() < 0.22
}

function getEffectiveStack(view: PrivateSeatView): number {
  const hero = view.seats.find((seat) => seat.id === view.heroSeatId)
  const opponentStacks = view.seats
    .filter((seat) => seat.id !== view.heroSeatId && seat.status !== 'out')
    .map((seat) => seat.stack)
  return Math.max(1, Math.min(hero?.stack ?? 1, Math.max(1, ...opponentStacks)))
}

function findAction<TType extends LegalAction['type']>(
  actions: LegalAction[],
  type: TType,
): Extract<LegalAction, { type: TType }> | undefined {
  return actions.find((action): action is Extract<LegalAction, { type: TType }> => action.type === type)
}
