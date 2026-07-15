import type { EngineCommand, LegalAction, PrivateSeatView, Street } from '../poker-engine'
import type { Rng } from '../shared/rng'
import type {
  NpcPostflopFrequencies,
  NpcPostflopModifiers,
  NpcPostflopSizingConfig,
  NpcPostflopStrategy,
  NpcPostflopThresholds,
} from './config'
import type { NpcRangeState } from './rangeTracking'

export interface NpcPostflopHandAssessment {
  madeStrength: number
  hasStrongDraw: boolean
  hasAnyDraw: boolean
  boardWetness: number
}

export type NpcProactivePostflopReason =
  | 'valueBet'
  | 'thinValueBet'
  | 'continuationBet'
  | 'delayedContinuationBet'
  | 'probeBet'
  | 'turnBarrel'
  | 'riverBarrel'
  | 'semiBluff'
  | 'pureBluff'
  | 'valueRaise'
  | 'checkRaise'

export interface NpcProactivePostflopDecision {
  command: EngineCommand
  reason: NpcProactivePostflopReason
  probability: number
  roll: number
  rangeAdvantage: number
  effectiveStackToPotRatio: number
  potFraction?: number
}

export interface CreatePostflopStrategyInput {
  id: string
  version?: number
  description?: string
  aggression: number
  frequencies?: Partial<NpcPostflopFrequencies>
  sizing?: Partial<NpcPostflopSizingConfig>
  thresholds?: Partial<NpcPostflopThresholds>
  modifiers?: Partial<NpcPostflopModifiers>
}

export interface ProactivePostflopDecisionInput {
  view: PrivateSeatView
  legalActions: LegalAction[]
  strategy: NpcPostflopStrategy
  rangeState: NpcRangeState
  assessment: NpcPostflopHandAssessment
  rng: Rng
}

export function createPostflopStrategy(input: CreatePostflopStrategyInput): NpcPostflopStrategy {
  const aggression = clamp01(input.aggression)
  return {
    schemaVersion: 'npc-postflop-v1',
    id: input.id.trim(),
    version: input.version ?? 1,
    ...(input.description ? { description: input.description } : {}),
    frequencies: {
      cBetFlop: 0.45 + aggression * 0.35,
      delayedCBetTurn: 0.25 + aggression * 0.3,
      probeBet: 0.2 + aggression * 0.28,
      turnBarrel: 0.32 + aggression * 0.38,
      riverBarrel: 0.22 + aggression * 0.3,
      semiBluff: 0.25 + aggression * 0.45,
      pureBluff: 0.04 + aggression * 0.18,
      valueRaise: 0.55 + aggression * 0.35,
      checkRaise: 0.12 + aggression * 0.3,
      ...input.frequencies,
    },
    sizing: {
      dryFlopPotFraction: 0.45,
      dynamicFlopPotFraction: 0.6,
      wetFlopPotFraction: 0.72,
      turnPotFraction: 0.66,
      riverPotFraction: 0.72,
      raiseToMultiplier: 2.5,
      ...input.sizing,
    },
    thresholds: {
      valueBetStrength: 0.62,
      thinValueStrength: 0.48,
      valueRaiseStrength: 0.78,
      ...input.thresholds,
    },
    modifiers: {
      rangeAdvantageWeight: 0.3,
      positionBonus: 0.05,
      multiwayPenalty: 0.1,
      wetBoardBluffPenalty: 0.12,
      shortStackAggressionBonus: 0.08,
      ...input.modifiers,
    },
  }
}

export function validatePostflopStrategy(strategy: NpcPostflopStrategy): void {
  if (strategy.schemaVersion !== 'npc-postflop-v1') {
    throw new Error('NPC postflop strategy schema version is invalid.')
  }
  if (!strategy.id.trim()) {
    throw new Error('NPC postflop strategy requires an id.')
  }
  if (!Number.isInteger(strategy.version) || strategy.version < 1) {
    throw new Error('NPC postflop strategy version must be a positive integer.')
  }
  for (const [name, value] of Object.entries(strategy.frequencies)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`NPC postflop frequency must be between zero and one: ${name}`)
    }
  }
  for (const [name, value] of Object.entries(strategy.sizing)) {
    if (!Number.isFinite(value) || value <= 0 || value > 5) {
      throw new Error(`NPC postflop sizing must be positive and bounded: ${name}`)
    }
  }
  for (const [name, value] of Object.entries(strategy.thresholds)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`NPC postflop threshold must be between zero and one: ${name}`)
    }
  }
  for (const [name, value] of Object.entries(strategy.modifiers)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`NPC postflop modifier must be between zero and one: ${name}`)
    }
  }
}

export function chooseProactivePostflopDecision(
  input: ProactivePostflopDecisionInput,
): NpcProactivePostflopDecision | undefined {
  const { view, legalActions, strategy, rangeState, assessment } = input
  if (!view.street || view.street === 'preflop' || view.street === 'showdown') {
    return undefined
  }
  const heroRange = rangeState.seats[view.heroSeatId]
  if (!heroRange) {
    return undefined
  }
  const rangeAdvantage = calculateRangeAdvantage(rangeState)
  const effectiveStackToPotRatio = calculateEffectiveStackToPotRatio(view)
  const raise = findAction(legalActions, 'raise')
  const call = findAction(legalActions, 'call')

  if (call && raise) {
    if (assessment.madeStrength >= strategy.thresholds.valueRaiseStrength) {
      return maybeRaise(input, 'valueRaise', strategy.frequencies.valueRaise, rangeAdvantage, raise)
    }
    if (assessment.hasStrongDraw && heroRange.lastAction === 'check') {
      return maybeRaise(input, 'checkRaise', strategy.frequencies.checkRaise, rangeAdvantage, raise)
    }
    return undefined
  }

  const check = findAction(legalActions, 'check')
  const bet = findAction(legalActions, 'bet')
  if (!check || !bet) {
    return undefined
  }

  let reason: NpcProactivePostflopReason
  let baseProbability: number
  if (assessment.madeStrength >= strategy.thresholds.valueBetStrength) {
    reason = 'valueBet'
    baseProbability = 0.98
  } else if (assessment.madeStrength >= strategy.thresholds.thinValueStrength) {
    reason = 'thinValueBet'
    baseProbability = 0.68
  } else if (assessment.hasStrongDraw) {
    reason = 'semiBluff'
    baseProbability = strategy.frequencies.semiBluff
  } else {
    const line = proactiveLine(view.street, heroRange, rangeState, strategy)
    reason = line.reason
    baseProbability = line.probability
  }

  if (baseProbability <= 0) {
    return undefined
  }
  const probability = adjustedProbability(
    baseProbability,
    reason,
    rangeAdvantage,
    input,
  )
  const roll = input.rng.next()
  if (roll >= probability) {
    return undefined
  }
  const potFraction = potFractionFor(
    view.street,
    rangeState,
    strategy,
    reason,
    effectiveStackToPotRatio,
  )
  const amount = clampAmount(Math.round(view.pot * potFraction), bet.min, bet.max)
  return {
    command: { type: 'bet', seatId: view.heroSeatId, amount, source: 'npc' },
    reason,
    probability,
    roll,
    rangeAdvantage,
    effectiveStackToPotRatio,
    potFraction,
  }
}

function proactiveLine(
  street: Exclude<Street, 'preflop' | 'showdown'>,
  heroRange: NpcRangeState['seats'][string],
  rangeState: NpcRangeState,
  strategy: NpcPostflopStrategy,
): { reason: NpcProactivePostflopReason; probability: number } {
  if (street === 'flop' && heroRange.initiative && heroRange.lastAggressiveStreet === 'preflop') {
    return { reason: 'continuationBet', probability: strategy.frequencies.cBetFlop }
  }
  if (street === 'turn' && heroRange.lastAggressiveStreet === 'flop') {
    return { reason: 'turnBarrel', probability: strategy.frequencies.turnBarrel }
  }
  if (street === 'river' && heroRange.lastAggressiveStreet === 'turn') {
    return { reason: 'riverBarrel', probability: strategy.frequencies.riverBarrel }
  }
  if (street === 'turn' && heroRange.initiative && heroRange.lastAggressiveStreet === 'preflop') {
    return { reason: 'delayedContinuationBet', probability: strategy.frequencies.delayedCBetTurn }
  }
  const opponentChecked = Object.values(rangeState.seats).some((seat) =>
    seat.seatId !== rangeState.heroSeatId && seat.active && seat.lastAction === 'check')
  if (!heroRange.initiative && opponentChecked) {
    return { reason: 'probeBet', probability: strategy.frequencies.probeBet }
  }
  return { reason: 'pureBluff', probability: strategy.frequencies.pureBluff }
}

function maybeRaise(
  input: ProactivePostflopDecisionInput,
  reason: 'valueRaise' | 'checkRaise',
  baseProbability: number,
  rangeAdvantage: number,
  raise: Extract<LegalAction, { type: 'raise' }>,
): NpcProactivePostflopDecision | undefined {
  if (baseProbability <= 0) {
    return undefined
  }
  const probability = adjustedProbability(baseProbability, reason, rangeAdvantage, input)
  const roll = input.rng.next()
  if (roll >= probability) {
    return undefined
  }
  const amount = clampAmount(
    Math.round(input.view.currentBet * input.strategy.sizing.raiseToMultiplier),
    raise.min,
    raise.max,
  )
  return {
    command: { type: 'raise', seatId: input.view.heroSeatId, amount, source: 'npc' },
    reason,
    probability,
    roll,
    rangeAdvantage,
    effectiveStackToPotRatio: calculateEffectiveStackToPotRatio(input.view),
  }
}

function adjustedProbability(
  base: number,
  reason: NpcProactivePostflopReason,
  rangeAdvantage: number,
  input: ProactivePostflopDecisionInput,
): number {
  const { strategy, rangeState, view } = input
  const hero = view.seats.find((seat) => seat.id === view.heroSeatId)
  const inPosition = hero?.position === 'BTN' || hero?.position === 'BTN/SB' || hero?.position === 'CO'
  const activeOpponents = Object.values(rangeState.seats).filter((seat) =>
    seat.seatId !== view.heroSeatId && seat.active).length
  const bluffing = reason === 'continuationBet' || reason === 'delayedContinuationBet' ||
    reason === 'probeBet' || reason === 'turnBarrel' || reason === 'riverBarrel' ||
    reason === 'semiBluff' || reason === 'pureBluff' || reason === 'checkRaise'
  let probability = base + rangeAdvantage * strategy.modifiers.rangeAdvantageWeight
  if (inPosition) {
    probability += strategy.modifiers.positionBonus
  }
  if (activeOpponents > 1) {
    probability -= strategy.modifiers.multiwayPenalty * (activeOpponents - 1)
  }
  if (bluffing && (rangeState.boardTexture === 'wet' || rangeState.boardTexture === 'dynamic')) {
    probability -= strategy.modifiers.wetBoardBluffPenalty * (rangeState.boardTexture === 'wet' ? 1 : 0.5)
  }
  const stackToPotRatio = calculateEffectiveStackToPotRatio(view)
  if (stackToPotRatio <= 2) {
    if (reason === 'valueBet' || reason === 'valueRaise' || reason === 'semiBluff') {
      probability += strategy.modifiers.shortStackAggressionBonus
    } else if (reason === 'pureBluff') {
      probability -= strategy.modifiers.shortStackAggressionBonus
    }
  }
  return roundProbability(clamp01(probability))
}

function calculateRangeAdvantage(rangeState: NpcRangeState): number {
  const hero = rangeState.seats[rangeState.heroSeatId]
  if (!hero) {
    return 0
  }
  const opponents = Object.values(rangeState.seats).filter((seat) =>
    seat.seatId !== rangeState.heroSeatId && seat.active)
  if (opponents.length === 0) {
    return 0
  }
  const heroTop = hero.weights.premium + hero.weights.strong
  const opponentTop = opponents.reduce(
    (sum, seat) => sum + seat.weights.premium + seat.weights.strong,
    0,
  ) / opponents.length
  return Math.max(-1, Math.min(1, heroTop - opponentTop))
}

function potFractionFor(
  street: Exclude<Street, 'preflop' | 'showdown'>,
  rangeState: NpcRangeState,
  strategy: NpcPostflopStrategy,
  reason: NpcProactivePostflopReason,
  effectiveStackToPotRatio: number,
): number {
  const lowSprCommitment = effectiveStackToPotRatio <= 1.5 &&
    (reason === 'valueBet' || reason === 'semiBluff')
    ? Math.min(1, effectiveStackToPotRatio)
    : 0
  if (street === 'turn') {
    return Math.max(strategy.sizing.turnPotFraction, lowSprCommitment)
  }
  if (street === 'river') {
    return Math.max(strategy.sizing.riverPotFraction, lowSprCommitment)
  }
  if (rangeState.boardTexture === 'wet') {
    return Math.max(strategy.sizing.wetFlopPotFraction, lowSprCommitment)
  }
  if (rangeState.boardTexture === 'dynamic') {
    return Math.max(strategy.sizing.dynamicFlopPotFraction, lowSprCommitment)
  }
  return Math.max(strategy.sizing.dryFlopPotFraction, lowSprCommitment)
}

function calculateEffectiveStackToPotRatio(view: PrivateSeatView): number {
  const heroStack = view.seats.find((seat) => seat.id === view.heroSeatId)?.stack ?? 0
  const opponentStacks = view.seats
    .filter((seat) => seat.id !== view.heroSeatId && seat.status !== 'folded' && seat.status !== 'out')
    .map((seat) => seat.stack)
  const effectiveStack = Math.min(heroStack, Math.max(0, ...opponentStacks))
  return Math.round((effectiveStack / Math.max(1, view.pot)) * 1_000_000) / 1_000_000
}

function findAction<TType extends LegalAction['type']>(
  actions: LegalAction[],
  type: TType,
): Extract<LegalAction, { type: TType }> | undefined {
  return actions.find((action): action is Extract<LegalAction, { type: TType }> => action.type === type)
}

function clampAmount(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function roundProbability(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000
}
