import type { EngineCommand, LegalAction, PrivateSeatView } from '../poker-engine'
import type { Rng } from '../shared/rng'
import type { NpcPostflopStrategy } from './config'
import {
  resolvePostflopDefenseConfig,
  type NpcPostflopHandAssessment,
} from './postflopStrategy'
import type { NpcRangeState } from './rangeTracking'

export interface NpcPostflopDefenseMetrics {
  potBeforeWager: number
  wagerAmount: number
  continueCost: number
  betToPotRatio: number
  minimumDefenseFrequency: number
  potOdds: number
}

export type NpcPostflopDefenseReason =
  | 'madeHandCall'
  | 'strongDrawCall'
  | 'drawCall'
  | 'mdfBluffCatch'
  | 'fold'

export interface NpcPostflopDefenseDecision {
  command: EngineCommand
  reason: NpcPostflopDefenseReason
  metrics: NpcPostflopDefenseMetrics
  continueProbability: number
  roll: number
  rangeDisadvantage: number
  effectiveStackToPotRatio: number
  activeOpponentCount: number
}

export interface PostflopDefenseDecisionInput {
  view: PrivateSeatView
  legalActions: LegalAction[]
  strategy: NpcPostflopStrategy
  rangeState: NpcRangeState
  assessment: NpcPostflopHandAssessment
  rng: Rng
}

export function calculatePostflopDefenseMetrics(
  view: PrivateSeatView,
  continueCost: number,
): NpcPostflopDefenseMetrics {
  const wagerAmount = latestAggressiveCommitment(view) ?? continueCost
  const potBeforeWager = Math.max(0, view.pot - wagerAmount)
  return {
    potBeforeWager,
    wagerAmount,
    continueCost,
    betToPotRatio: wagerAmount / Math.max(1, potBeforeWager),
    minimumDefenseFrequency: potBeforeWager / Math.max(1, potBeforeWager + wagerAmount),
    potOdds: continueCost / Math.max(1, view.pot + continueCost),
  }
}

export function choosePostflopDefenseDecision(
  input: PostflopDefenseDecisionInput,
): NpcPostflopDefenseDecision | undefined {
  const { view, legalActions, strategy, rangeState, assessment } = input
  if (!view.street || view.street === 'preflop' || view.street === 'showdown') {
    return undefined
  }
  const fold = findAction(legalActions, 'fold')
  const call = findAction(legalActions, 'call')
  const allIn = findPassiveAllIn(view, legalActions)
  const continueCost = call?.amount ?? allIn?.amount
  if (!fold || continueCost === undefined) {
    return undefined
  }

  const metrics = calculatePostflopDefenseMetrics(view, continueCost)
  const activeOpponentCount = Object.values(rangeState.seats).filter((seat) =>
    seat.seatId !== view.heroSeatId && seat.active).length
  const rangeDisadvantage = calculateRangeDisadvantage(rangeState)
  const effectiveStackToPotRatio = calculateEffectiveStackToPotRatio(view)
  const equityProxy = assessment.hasStrongDraw
    ? Math.max(assessment.madeStrength, 0.48)
    : assessment.hasAnyDraw
      ? Math.max(assessment.madeStrength, 0.34)
      : assessment.madeStrength
  const handDrivenFrequency = clamp01(0.5 + (equityProxy - metrics.potOdds) * 1.5)
  const defense = resolvePostflopDefenseConfig(strategy)
  let continueProbability =
    metrics.minimumDefenseFrequency * defense.mdfAdherence +
    handDrivenFrequency * (1 - defense.mdfAdherence)

  continueProbability += (assessment.madeStrength - 0.45) * defense.madeHandWeight * 0.6
  if (assessment.hasAnyDraw) {
    const drawTextureMultiplier = rangeState.boardTexture === 'wet'
      ? 1.2
      : rangeState.boardTexture === 'dynamic'
        ? 1.1
        : rangeState.boardTexture === 'paired'
          ? 0.85
          : 1
    continueProbability += Math.max(0, equityProxy - metrics.potOdds) *
      defense.drawWeight * 0.8 * drawTextureMultiplier
  }
  continueProbability -= Math.max(0, metrics.potOdds - equityProxy) * defense.potOddsDiscipline

  if (isInPosition(view)) {
    continueProbability += defense.positionBonus
  }
  continueProbability -= rangeDisadvantage * defense.rangeDisadvantagePenalty
  if (activeOpponentCount > 1) {
    continueProbability -= defense.multiwayPenalty * (activeOpponentCount - 1)
  }
  if (effectiveStackToPotRatio <= 1.5) {
    const commitmentScale = 1 - effectiveStackToPotRatio / 1.5
    continueProbability += defense.shortStackCommitmentBonus * commitmentScale
  }
  continueProbability -= defense.foldBias

  if (assessment.madeStrength >= strategy.thresholds.valueRaiseStrength) {
    continueProbability = 1
  }
  continueProbability = roundProbability(clamp01(continueProbability))
  const roll = input.rng.next()
  const continuing = roll < continueProbability
  const command: EngineCommand = continuing
    ? call
      ? { type: 'call', seatId: view.heroSeatId, source: 'npc' }
      : { type: 'allIn', seatId: view.heroSeatId, source: 'npc' }
    : { type: 'fold', seatId: view.heroSeatId, source: 'npc' }

  return {
    command,
    reason: continuing ? continueReason(assessment) : 'fold',
    metrics,
    continueProbability,
    roll,
    rangeDisadvantage,
    effectiveStackToPotRatio,
    activeOpponentCount,
  }
}

function latestAggressiveCommitment(view: PrivateSeatView): number | undefined {
  let highestTargetContribution = 0
  let latest: number | undefined
  for (const event of [...view.events].sort((left, right) => left.sequenceNumber - right.sequenceNumber)) {
    if (event.type === 'streetAdvanced') {
      highestTargetContribution = 0
      latest = undefined
      continue
    }
    if (event.type !== 'actionApplied') {
      continue
    }
    if (event.payload.targetContribution > highestTargetContribution) {
      if (event.payload.action === 'bet' || event.payload.action === 'raise' || event.payload.action === 'allIn') {
        latest = event.payload.amount
      }
      highestTargetContribution = event.payload.targetContribution
    }
  }
  return latest && latest > 0 ? latest : undefined
}

function findPassiveAllIn(
  view: PrivateSeatView,
  actions: LegalAction[],
): Extract<LegalAction, { type: 'allIn' }> | undefined {
  const heroContribution = view.seats.find((seat) => seat.id === view.heroSeatId)?.streetContribution ?? 0
  return actions.find((action): action is Extract<LegalAction, { type: 'allIn' }> =>
    action.type === 'allIn' && action.targetContribution <= view.currentBet &&
    action.amount <= Math.max(0, view.currentBet - heroContribution))
}

function calculateRangeDisadvantage(rangeState: NpcRangeState): number {
  const hero = rangeState.seats[rangeState.heroSeatId]
  const opponents = Object.values(rangeState.seats).filter((seat) =>
    seat.seatId !== rangeState.heroSeatId && seat.active)
  if (!hero || opponents.length === 0) {
    return 0
  }
  const opponentStrength = opponents.reduce((total, seat) => total + rangeStrength(seat.weights), 0) /
    opponents.length
  return clamp01(opponentStrength - rangeStrength(hero.weights))
}

function rangeStrength(weights: NpcRangeState['seats'][string]['weights']): number {
  return weights.premium + weights.strong + weights.medium * 0.45 + weights.draw * 0.2
}

function calculateEffectiveStackToPotRatio(view: PrivateSeatView): number {
  const heroStack = view.seats.find((seat) => seat.id === view.heroSeatId)?.stack ?? 0
  const opponentStacks = view.seats
    .filter((seat) => seat.id !== view.heroSeatId && seat.status !== 'folded' && seat.status !== 'out')
    .map((seat) => seat.stack)
  const effectiveStack = Math.min(heroStack, Math.max(0, ...opponentStacks))
  return roundProbability(effectiveStack / Math.max(1, view.pot))
}

function isInPosition(view: PrivateSeatView): boolean {
  const dealerIndex = view.seats.findIndex((seat) => seat.isDealer)
  if (dealerIndex < 0) {
    const position = view.seats.find((seat) => seat.id === view.heroSeatId)?.position
    return position === 'BTN' || position === 'BTN/SB'
  }
  const postflopOrder = [
    ...view.seats.slice(dealerIndex + 1),
    ...view.seats.slice(0, dealerIndex + 1),
  ].filter((seat) => seat.status === 'active' && seat.stack > 0)
  return postflopOrder.length > 1 && postflopOrder.at(-1)?.id === view.heroSeatId
}

function continueReason(assessment: NpcPostflopHandAssessment): NpcPostflopDefenseReason {
  if (assessment.madeStrength >= 0.45) {
    return 'madeHandCall'
  }
  if (assessment.hasStrongDraw) {
    return 'strongDrawCall'
  }
  if (assessment.hasAnyDraw) {
    return 'drawCall'
  }
  return 'mdfBluffCatch'
}

function findAction<TType extends LegalAction['type']>(
  actions: LegalAction[],
  type: TType,
): Extract<LegalAction, { type: TType }> | undefined {
  return actions.find((action): action is Extract<LegalAction, { type: TType }> => action.type === type)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function roundProbability(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000
}
