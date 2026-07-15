import type {
  EngineCommand,
  PositionLabel,
  PrivateSeatView,
  SeatId,
  Street,
} from '../poker-engine'
import { toPreflopHandClass } from './preflopRanges'

export type NpcBoardTexture = 'none' | 'dry' | 'dynamic' | 'wet' | 'paired'

export interface NpcRangeBucketWeights {
  readonly premium: number
  readonly strong: number
  readonly medium: number
  readonly draw: number
  readonly weak: number
}

export interface NpcSeatRangeEstimate {
  readonly seatId: SeatId
  readonly position?: PositionLabel
  readonly source: 'hero-private' | 'public-inference'
  readonly active: boolean
  readonly rangeWidth: number
  readonly weights: NpcRangeBucketWeights
  readonly initiative: boolean
  readonly actionsObserved: number
  readonly lastAction?: EngineCommand['type']
  readonly lastAggressiveStreet?: Street
  readonly knownHandClass?: string
}

export interface NpcRangeState {
  readonly schemaVersion: 'npc-range-state-v1'
  readonly handNumber: number
  readonly street: Street
  readonly heroSeatId: SeatId
  readonly boardTexture: NpcBoardTexture
  readonly communityCardCount: number
  readonly processedThroughSequenceNumber: number
  readonly seats: Readonly<Record<SeatId, NpcSeatRangeEstimate>>
}

export interface NpcRangeMemory {
  readonly handsObserved?: number
  readonly rangeState?: NpcRangeState
}

interface MutableSeatRangeEstimate {
  seatId: SeatId
  position?: PositionLabel
  source: 'hero-private' | 'public-inference'
  active: boolean
  rangeWidth: number
  weights: NpcRangeBucketWeights
  initiative: boolean
  actionsObserved: number
  lastAction?: EngineCommand['type']
  lastAggressiveStreet?: Street
  knownHandClass?: string
}

const POSITION_WIDTHS: Partial<Record<PositionLabel, number>> = {
  'BTN/SB': 0.85,
  BTN: 0.48,
  SB: 0.52,
  BB: 1,
  UTG: 0.18,
  HJ: 0.23,
  CO: 0.32,
}

export function deriveNpcRangeState(view: PrivateSeatView): NpcRangeState {
  const seats: Record<SeatId, MutableSeatRangeEstimate> = Object.fromEntries(view.seats.map((seat) => {
    const rangeWidth = POSITION_WIDTHS[seat.position ?? 'BB'] ?? 0.5
    const isHero = seat.id === view.heroSeatId
    return [seat.id, {
      seatId: seat.id,
      ...(seat.position ? { position: seat.position } : {}),
      source: isHero ? 'hero-private' : 'public-inference',
      active: seat.status !== 'folded' && seat.status !== 'out',
      rangeWidth,
      weights: initialWeights(rangeWidth),
      initiative: false,
      actionsObserved: 0,
      ...(isHero && view.holeCards.length === 2
        ? { knownHandClass: toPreflopHandClass(view.holeCards) }
        : {}),
    }]
  }))

  let street: Street = 'preflop'
  let boardTexture: NpcBoardTexture = 'none'
  let processedThroughSequenceNumber = 0
  const bigBlind = postedBigBlind(view)
  let highestTargetContribution = bigBlind

  for (const event of [...view.events].sort((left, right) => left.sequenceNumber - right.sequenceNumber)) {
    processedThroughSequenceNumber = Math.max(processedThroughSequenceNumber, event.sequenceNumber)
    if (event.type === 'streetAdvanced') {
      street = event.payload.street
      highestTargetContribution = 0
      boardTexture = classifyBoardTexture(event.payload.communityCards)
      for (const estimate of Object.values(seats)) {
        if (estimate.active) {
          estimate.weights = applyBoardTexture(estimate.weights, boardTexture)
        }
      }
      continue
    }
    if (event.type !== 'actionApplied') {
      continue
    }
    const estimate = seats[event.payload.seatId]
    if (!estimate) {
      continue
    }
    const inferredAction = event.payload.action === 'allIn' && event.payload.targetContribution <= highestTargetContribution
      ? 'call'
      : event.payload.action
    if (isAggressive(inferredAction)) {
      for (const candidate of Object.values(seats)) {
        candidate.initiative = false
      }
      highestTargetContribution = event.payload.targetContribution
    }
    updateEstimateForAction(
      estimate,
      event.payload.action,
      inferredAction,
      event.payload.targetContribution,
      street,
      bigBlind,
    )
  }

  return deepFreeze({
    schemaVersion: 'npc-range-state-v1',
    handNumber: view.handNumber,
    street: view.street ?? street,
    heroSeatId: view.heroSeatId,
    boardTexture: view.communityCards.length > 0 ? classifyBoardTexture(view.communityCards) : boardTexture,
    communityCardCount: view.communityCards.length,
    processedThroughSequenceNumber,
    seats,
  })
}

export function updateNpcRangeMemory<TMemory extends NpcRangeMemory>(
  memory: TMemory,
  view: PrivateSeatView,
): TMemory & { readonly rangeState: NpcRangeState } {
  return deepFreeze({ ...memory, rangeState: deriveNpcRangeState(view) })
}

function updateEstimateForAction(
  estimate: MutableSeatRangeEstimate,
  observedAction: EngineCommand['type'],
  inferredAction: EngineCommand['type'],
  targetContribution: number,
  street: Street,
  bigBlind: number,
): void {
  estimate.actionsObserved += 1
  estimate.lastAction = observedAction

  if (inferredAction === 'fold') {
    estimate.active = false
    estimate.rangeWidth = 0
    return
  }

  if (street === 'preflop') {
    const widthMultiplier = preflopWidthMultiplier(inferredAction, targetContribution, bigBlind)
    estimate.rangeWidth = roundProbability(estimate.rangeWidth * widthMultiplier)
  } else {
    estimate.rangeWidth = roundProbability(estimate.rangeWidth * postflopWidthMultiplier(inferredAction))
  }

  estimate.weights = updateWeights(estimate.weights, inferredAction, street)
  if (isAggressive(inferredAction)) {
    estimate.initiative = true
    estimate.lastAggressiveStreet = street
  }
}

function preflopWidthMultiplier(
  action: EngineCommand['type'],
  targetContribution: number,
  bigBlind: number,
): number {
  if (action === 'check') {
    return 1
  }
  if (action === 'call') {
    return targetContribution <= bigBlind ? 0.88 : 0.68
  }
  if (action === 'bet' || action === 'raise') {
    return 0.48
  }
  if (action === 'allIn') {
    return 0.25
  }
  return 1
}

function postflopWidthMultiplier(action: EngineCommand['type']): number {
  if (action === 'check') {
    return 0.96
  }
  if (action === 'call') {
    return 0.72
  }
  if (action === 'bet') {
    return 0.62
  }
  if (action === 'raise') {
    return 0.48
  }
  if (action === 'allIn') {
    return 0.3
  }
  return 1
}

function updateWeights(
  weights: NpcRangeBucketWeights,
  action: EngineCommand['type'],
  street: Street,
): NpcRangeBucketWeights {
  if (street === 'preflop') {
    if (action === 'raise' || action === 'bet') {
      return weighted(weights, { premium: 1.65, strong: 1.4, medium: 0.95, draw: 0.72, weak: 0.5 })
    }
    if (action === 'allIn') {
      return weighted(weights, { premium: 2.1, strong: 1.55, medium: 0.7, draw: 0.55, weak: 0.25 })
    }
    if (action === 'call') {
      return weighted(weights, { premium: 0.9, strong: 1.08, medium: 1.25, draw: 1.22, weak: 0.72 })
    }
    return weights
  }

  if (action === 'bet' || action === 'raise') {
    return weighted(weights, { premium: 1.55, strong: 1.42, medium: 0.88, draw: 1.24, weak: 0.58 })
  }
  if (action === 'allIn') {
    return weighted(weights, { premium: 2, strong: 1.6, medium: 0.72, draw: 1.08, weak: 0.24 })
  }
  if (action === 'call') {
    return weighted(weights, { premium: 0.92, strong: 1.12, medium: 1.28, draw: 1.22, weak: 0.55 })
  }
  if (action === 'check') {
    return weighted(weights, { premium: 0.88, strong: 0.92, medium: 1.08, draw: 1.1, weak: 1.16 })
  }
  return weights
}

function initialWeights(rangeWidth: number): NpcRangeBucketWeights {
  return normalizeWeights({
    premium: 0.06 + (1 - rangeWidth) * 0.11,
    strong: 0.12 + (1 - rangeWidth) * 0.12,
    medium: 0.22,
    draw: 0.2 + rangeWidth * 0.06,
    weak: 0.4 * rangeWidth + 0.08,
  })
}

function applyBoardTexture(
  weights: NpcRangeBucketWeights,
  texture: NpcBoardTexture,
): NpcRangeBucketWeights {
  if (texture === 'wet') {
    return weighted(weights, { premium: 1, strong: 1.04, medium: 0.88, draw: 1.5, weak: 0.82 })
  }
  if (texture === 'dynamic') {
    return weighted(weights, { premium: 1, strong: 1.03, medium: 0.94, draw: 1.32, weak: 0.88 })
  }
  if (texture === 'paired') {
    return weighted(weights, { premium: 1.15, strong: 1.04, medium: 1.05, draw: 0.72, weak: 1.02 })
  }
  return weights
}

function classifyBoardTexture(cards: PrivateSeatView['communityCards']): NpcBoardTexture {
  if (cards.length === 0) {
    return 'none'
  }
  const rankCounts = new Map<string, number>()
  const suitCounts = new Map<string, number>()
  for (const card of cards) {
    rankCounts.set(card.rank, (rankCounts.get(card.rank) ?? 0) + 1)
    suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1)
  }
  if ([...rankCounts.values()].some((count) => count > 1)) {
    return 'paired'
  }
  const rankValues = [...new Set(cards.map((card) => rankValue(card.rank)))].sort((left, right) => left - right)
  const connectedLinks = rankValues.filter((rank, index) => index > 0 && rank - rankValues[index - 1] <= 2).length
  const maxSuitCount = Math.max(...suitCounts.values())
  if (maxSuitCount >= 3 || connectedLinks >= 3) {
    return 'wet'
  }
  if (maxSuitCount >= 2 && connectedLinks >= 2) {
    return 'dynamic'
  }
  return 'dry'
}

function rankValue(rank: string): number {
  return '23456789TJQKA'.indexOf(rank) + 2
}

function postedBigBlind(view: PrivateSeatView): number {
  const event = [...view.events].reverse().find((candidate) =>
    candidate.type === 'blindPosted' && candidate.payload.blind === 'big')
  return event?.type === 'blindPosted' ? Math.max(1, event.payload.amount) : Math.max(1, view.minRaise)
}

function isAggressive(action: EngineCommand['type']): boolean {
  return action === 'bet' || action === 'raise' || action === 'allIn'
}

function weighted(
  weights: NpcRangeBucketWeights,
  factors: Record<keyof NpcRangeBucketWeights, number>,
): NpcRangeBucketWeights {
  return normalizeWeights({
    premium: weights.premium * factors.premium,
    strong: weights.strong * factors.strong,
    medium: weights.medium * factors.medium,
    draw: weights.draw * factors.draw,
    weak: weights.weak * factors.weak,
  })
}

function normalizeWeights(weights: NpcRangeBucketWeights): NpcRangeBucketWeights {
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0)
  return {
    premium: roundProbability(weights.premium / total),
    strong: roundProbability(weights.strong / total),
    medium: roundProbability(weights.medium / total),
    draw: roundProbability(weights.draw / total),
    weak: roundProbability(weights.weak / total),
  }
}

function roundProbability(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1_000_000_000) / 1_000_000_000
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child)
    }
    Object.freeze(value)
  }
  return value
}
