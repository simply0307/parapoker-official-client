import type { Rng } from '../shared/rng'
import { evaluateBestHand } from '../poker-engine'
import type { Card, EngineCommand, LegalAction, PrivateSeatView, Rank, SeatId } from '../poker-engine'
import type { NpcPostflopStrategy, NpcPreflopStrategy } from './config'
import {
  evaluateProactivePostflopDecision,
  resolvePostflopDefenseConfig,
  type NpcPostflopHandAssessment,
} from './postflopStrategy'
import { choosePostflopDefenseDecision } from './postflopDefense'
import { analyzePreflopSpot, choosePreflopRangeDecision } from './preflopRanges'
import type { NpcRangeState } from './rangeTracking'
import {
  commandAmount,
  type NpcDecisionIdentity,
  type NpcDecisionResult,
  type NpcDecisionSource,
  type NpcDecisionTrace,
} from './npcDecisionTrace'

export interface NpcPolicyConfig {
  preflopAggression: number
  preflopLooseness: number
  postflopAggression: number
  pressureRaiseMultiplier: number
}

export interface NpcTableMemory {
  readonly handsObserved?: number
  readonly rangeState?: NpcRangeState
}

export interface NpcDecisionContext {
  view: PrivateSeatView
  legalActions: LegalAction[]
  config: NpcPolicyConfig
  memory: NpcTableMemory
  rng: Rng
  preflopStrategy?: NpcPreflopStrategy
  postflopStrategy?: NpcPostflopStrategy
  identity: NpcDecisionIdentity
}

export interface NpcPolicy {
  chooseDecision(context: NpcDecisionContext): NpcDecisionResult
}

export const DEFAULT_NPC_POLICY_CONFIG: NpcPolicyConfig = {
  preflopAggression: 0.62,
  preflopLooseness: 0.34,
  postflopAggression: 0.55,
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
  preflopStrategy?: NpcPreflopStrategy,
  postflopStrategy?: NpcPostflopStrategy,
  identity: NpcDecisionIdentity = {
    npcDefinitionId: 'unassigned-npc',
    strategyProfileId: 'legacy-default',
    strategyProfileVersion: 1,
    teachingTags: [],
  },
): NpcDecisionContext {
  return {
    view,
    legalActions: view.legalActions,
    config: { ...DEFAULT_NPC_POLICY_CONFIG, ...config },
    memory,
    rng,
    ...(preflopStrategy ? { preflopStrategy } : {}),
    ...(postflopStrategy ? { postflopStrategy } : {}),
    identity: clone(identity),
  }
}

export class BasicNpcPolicy implements NpcPolicy {
  chooseDecision(context: NpcDecisionContext): NpcDecisionResult {
    const rolls: number[] = []
    const tracedContext: NpcDecisionContext = {
      ...context,
      rng: {
        next: () => {
          const roll = context.rng.next()
          rolls.push(roll)
          return roll
        },
        state: () => context.rng.state(),
      },
    }
    if (context.view.street === 'preflop' && context.view.holeCards.length === 2) {
      if (context.preflopStrategy) {
        const rangeDecision = choosePreflopRangeDecision({
          view: context.view,
          legalActions: context.legalActions,
          strategy: context.preflopStrategy,
          rng: tracedContext.rng,
        })
        if (rangeDecision) {
          return {
            command: rangeDecision.command,
            trace: createTrace(context, rangeDecision.command, 'preflop-range', {
              situationId: rangeDecision.nodeId,
              handClass: rangeDecision.handClass,
              configuredValues: {
                legalFrequencyMix: JSON.stringify(rangeDecision.legalFrequencies),
                selectedFrequency: rangeDecision.legalFrequencies.find((entry) => entry.action === rangeDecision.selectedAction)?.frequency ?? 0,
                sizingProfileId: context.preflopStrategy.id,
              },
              calculatedValues: {
                format: rangeDecision.spot.format,
                position: rangeDecision.spot.position ?? 'unknown',
                stackDepth: rangeDecision.spot.stackDepth,
                situation: rangeDecision.spot.situation,
                raiseSizeBucket: rangeDecision.spot.raiseSizeBucket,
                effectiveStackBigBlinds: rangeDecision.spot.effectiveStackBigBlinds,
              },
              probability: rangeDecision.legalFrequencies.find((entry) => entry.action === rangeDecision.selectedAction)?.frequency,
              rngRoll: rangeDecision.rngRoll,
              reasonCode: `range-${rangeDecision.selectedAction}`,
            }),
          }
        }
      }
      const command = choosePreflopAction(tracedContext)
      const spot = analyzePreflopSpot(context.view)
      return legacyResult(context, command, 'legacy-fallback', `legacy-preflop-${classifyPreflop(context.view.holeCards)}-${command.type}`, rolls, {
        handTier: classifyPreflop(context.view.holeCards),
        effectiveStack: getEffectiveStack(context.view),
        format: spot.format,
        position: spot.position ?? 'unknown',
        situation: spot.situation,
        stackDepth: spot.stackDepth,
      })
    }
    if (context.view.holeCards.length === 2 && context.view.communityCards.length >= 3) {
      const explicit = chooseExplicitPostflopDecision(tracedContext)
      if (explicit) {
        return explicit
      }
      const assessment = assessPostflop(context.view)
      const command = choosePostflopAction(tracedContext)
      return legacyResult(context, command, 'legacy-fallback', `legacy-postflop-${command.type}`, rolls, {
        madeStrength: assessment.madeStrength,
        hasStrongDraw: assessment.hasStrongDraw,
        hasAnyDraw: assessment.hasAnyDraw,
        boardWetness: assessment.boardWetness,
        ...(context.postflopStrategy ? {
          thinValueStrength: context.postflopStrategy.thresholds.thinValueStrength,
          valueBetStrength: context.postflopStrategy.thresholds.valueBetStrength,
        } : {}),
      })
    }

    const command = chooseFallbackAction(tracedContext)
    return legacyResult(context, command, 'safety-fallback', `safety-${command.type}`, rolls, {})
  }

  chooseAction(context: NpcDecisionContext): EngineCommand {
    return this.chooseDecision(context).command
  }
}

interface TraceDetails {
  situationId?: string
  handClass?: string
  configuredValues: Record<string, number | string | boolean>
  calculatedValues: Record<string, number | string | boolean>
  probability?: number
  rngRoll?: number
  reasonCode: string
}

function createTrace(
  context: NpcDecisionContext,
  command: EngineCommand,
  decisionSource: NpcDecisionSource,
  details: TraceDetails,
): NpcDecisionTrace {
  const amount = commandAmount(command)
  return {
    schemaVersion: 'npc-decision-trace-v1',
    npcDefinitionId: context.identity.npcDefinitionId,
    strategyProfileId: context.identity.strategyProfileId,
    strategyProfileVersion: context.identity.strategyProfileVersion,
    handNumber: context.view.handNumber,
    seatId: context.view.heroSeatId,
    street: context.view.street ?? 'between-hands',
    decisionSource,
    ...(details.situationId ? { situationId: details.situationId } : {}),
    ...(details.handClass ? { handClass: details.handClass } : {}),
    consideredActions: context.legalActions.map((action) => action.type),
    selectedAction: command.type,
    ...(amount !== undefined ? { selectedAmount: amount } : {}),
    configuredValues: clone(details.configuredValues),
    calculatedValues: clone(details.calculatedValues),
    ...(details.probability !== undefined ? { probability: details.probability } : {}),
    ...(details.rngRoll !== undefined ? { rngRoll: details.rngRoll } : {}),
    reasonCode: details.reasonCode,
    teachingTags: [...context.identity.teachingTags],
  }
}

function legacyResult(
  context: NpcDecisionContext,
  command: EngineCommand,
  source: Extract<NpcDecisionSource, 'legacy-fallback' | 'safety-fallback'>,
  reasonCode: string,
  rolls: number[],
  calculatedValues: Record<string, number | string | boolean>,
): NpcDecisionResult {
  return {
    command,
    trace: createTrace(context, command, source, {
      configuredValues: { ...context.config },
      calculatedValues,
      ...(rolls.length > 0 ? { rngRoll: rolls.at(-1) } : {}),
      reasonCode,
    }),
  }
}

function proactiveConfiguredValues(
  strategy: NpcPostflopStrategy,
  reason: string,
): Record<string, number | string | boolean> {
  const frequencyKey: Partial<Record<string, keyof NpcPostflopStrategy['frequencies']>> = {
    continuationBet: 'cBetFlop',
    delayedContinuationBet: 'delayedCBetTurn',
    probeBet: 'probeBet',
    turnBarrel: 'turnBarrel',
    riverBarrel: 'riverBarrel',
    semiBluff: 'semiBluff',
    pureBluff: 'pureBluff',
    valueRaise: 'valueRaise',
    checkRaise: 'checkRaise',
  }
  const key = frequencyKey[reason]
  return {
    strategyId: strategy.id,
    reason,
    ...(key ? { baseFrequency: strategy.frequencies[key] } : {}),
    valueBetStrength: strategy.thresholds.valueBetStrength,
    thinValueStrength: strategy.thresholds.thinValueStrength,
    valueRaiseStrength: strategy.thresholds.valueRaiseStrength,
    rangeAdvantageWeight: strategy.modifiers.rangeAdvantageWeight,
    positionBonus: strategy.modifiers.positionBonus,
    multiwayPenalty: strategy.modifiers.multiwayPenalty,
    wetBoardBluffPenalty: strategy.modifiers.wetBoardBluffPenalty,
  }
}

function chooseExplicitPostflopDecision(context: NpcDecisionContext): NpcDecisionResult | undefined {
  if (!context.postflopStrategy || !context.memory.rangeState) {
    return undefined
  }
  const assessment = assessPostflop(context.view)
  const proactiveEvaluation = evaluateProactivePostflopDecision({
    view: context.view,
    legalActions: context.legalActions,
    strategy: context.postflopStrategy,
    rangeState: context.memory.rangeState,
    assessment,
    rng: context.rng,
  })
  const proactive = proactiveEvaluation?.decision
  if (proactive) {
    return {
      command: proactive.command,
      trace: createTrace(context, proactive.command, 'proactive-postflop', {
        situationId: proactive.reason,
        configuredValues: proactiveConfiguredValues(context.postflopStrategy, proactive.reason),
        calculatedValues: {
          madeStrength: assessment.madeStrength,
          hasStrongDraw: assessment.hasStrongDraw,
          hasAnyDraw: assessment.hasAnyDraw,
          boardWetness: assessment.boardWetness,
          rangeAdvantage: proactive.rangeAdvantage,
          effectiveStackToPotRatio: proactive.effectiveStackToPotRatio,
          ...(proactive.potFraction !== undefined ? { potFraction: proactive.potFraction } : {}),
        },
        probability: proactive.probability,
        rngRoll: proactive.roll,
        reasonCode: proactive.reason,
      }),
    }
  }
  const check = findAction(context.legalActions, 'check')
  if (proactiveEvaluation && check && !findAction(context.legalActions, 'call')) {
    const command: EngineCommand = { type: 'check', seatId: context.view.heroSeatId, source: 'npc' }
    return {
      command,
      trace: createTrace(context, command, 'proactive-postflop', {
        situationId: proactiveEvaluation.reason,
        configuredValues: proactiveConfiguredValues(context.postflopStrategy, proactiveEvaluation.reason),
        calculatedValues: {
          madeStrength: assessment.madeStrength,
          hasStrongDraw: assessment.hasStrongDraw,
          hasAnyDraw: assessment.hasAnyDraw,
          boardWetness: assessment.boardWetness,
          rangeAdvantage: proactiveEvaluation.rangeAdvantage,
          effectiveStackToPotRatio: proactiveEvaluation.effectiveStackToPotRatio,
        },
        probability: proactiveEvaluation.probability,
        ...(proactiveEvaluation.roll !== undefined ? { rngRoll: proactiveEvaluation.roll } : {}),
        reasonCode: `${proactiveEvaluation.reason}-declined`,
      }),
    }
  }
  const defense = choosePostflopDefenseDecision({
    view: context.view,
    legalActions: context.legalActions,
    strategy: context.postflopStrategy,
    rangeState: context.memory.rangeState,
    assessment,
    rng: context.rng,
  })
  if (!defense) {
    return undefined
  }
  return {
    command: defense.command,
    trace: createTrace(context, defense.command, 'postflop-defense', {
      situationId: `facing-${defense.metrics.betToPotRatio.toFixed(2)}-pot`,
      configuredValues: { ...resolvePostflopDefenseConfig(context.postflopStrategy) },
      calculatedValues: {
        ...defense.metrics,
        madeStrength: assessment.madeStrength,
        hasStrongDraw: assessment.hasStrongDraw,
        hasAnyDraw: assessment.hasAnyDraw,
        boardWetness: assessment.boardWetness,
        rangeDisadvantage: defense.rangeDisadvantage,
        effectiveStackToPotRatio: defense.effectiveStackToPotRatio,
        activeOpponentCount: defense.activeOpponentCount,
      },
      probability: defense.continueProbability,
      rngRoll: defense.roll,
      reasonCode: defense.reason,
    }),
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

function choosePostflopAction(context: NpcDecisionContext): EngineCommand {
  const { view, legalActions } = context
  const seatId = view.heroSeatId
  const assessment = assessPostflop(view)
  const call = findAction(legalActions, 'call')
  const fold = findAction(legalActions, 'fold')
  const check = findAction(legalActions, 'check')
  const bet = findAction(legalActions, 'bet')
  const raise = findAction(legalActions, 'raise')
  const allIn = findAction(legalActions, 'allIn')

  if (call) {
    const callPrice = call.amount / Math.max(1, view.pot + call.amount)
    const stackPressure = call.amount / getEffectiveStack(view)

    if (assessment.madeStrength >= 0.72) {
      if (raise && callPrice <= 0.34 && context.rng.next() < context.config.postflopAggression) {
        return pressureCommand(raise, seatId, context)
      }
      return { type: 'call', seatId, source: 'npc' }
    }

    if (assessment.hasStrongDraw && callPrice <= 0.36 && stackPressure <= 0.22) {
      return { type: 'call', seatId, source: 'npc' }
    }

    if (assessment.madeStrength >= 0.45 && callPrice <= 0.28 && stackPressure <= 0.16) {
      return { type: 'call', seatId, source: 'npc' }
    }

    if (assessment.hasAnyDraw && callPrice <= 0.22 && stackPressure <= 0.1) {
      return { type: 'call', seatId, source: 'npc' }
    }

    if (fold) {
      return { type: 'fold', seatId, source: 'npc' }
    }
  }

  if (check && bet) {
    if (assessment.madeStrength >= 0.58) {
      return { type: 'bet', seatId, amount: postflopBetAmount(bet, context, assessment), source: 'npc' }
    }
    if (assessment.hasStrongDraw && assessment.boardWetness >= 2 && context.rng.next() < context.config.postflopAggression * 0.35) {
      return { type: 'bet', seatId, amount: postflopBetAmount(bet, context, assessment), source: 'npc' }
    }
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

function assessPostflop(view: PrivateSeatView): NpcPostflopHandAssessment {
  const allCards = [...view.holeCards, ...view.communityCards]
  const handValue = evaluateBestHand(allCards)
  const madeStrength = madeHandStrength(handValue.category, handValue.tiebreakers)
  const flushDraw = hasFlushDraw(allCards) && handValue.category < 5
  const straightDraw = getStraightDrawStrength(allCards)
  const boardWetness = getBoardWetness(view.communityCards)

  return {
    madeStrength,
    hasStrongDraw: flushDraw || straightDraw === 'openEnded',
    hasAnyDraw: flushDraw || straightDraw !== 'none',
    boardWetness,
  }
}

function madeHandStrength(category: number, tiebreakers: number[]): number {
  if (category >= 5) {
    return 0.95
  }
  if (category === 4) {
    return 0.9
  }
  if (category === 3) {
    return 0.82
  }
  if (category === 2) {
    return 0.74
  }
  if (category === 1) {
    const pairRank = tiebreakers[0] ?? 0
    if (pairRank >= RANK_VALUES.Q) {
      return 0.56
    }
    if (pairRank >= RANK_VALUES['8']) {
      return 0.42
    }
    return 0.3
  }
  return 0.12
}

function hasFlushDraw(cards: Card[]): boolean {
  const suitCounts = new Map<Card['suit'], number>()
  for (const card of cards) {
    suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1)
  }
  return Array.from(suitCounts.values()).some((count) => count >= 4)
}

function getStraightDrawStrength(cards: Card[]): 'none' | 'gutshot' | 'openEnded' {
  const ranks = uniqueStraightRanks(cards)
  let gutshot = false

  for (let low = 1; low <= 10; low += 1) {
    const window = [low, low + 1, low + 2, low + 3, low + 4]
    const held = window.filter((rank) => ranks.has(rank)).length
    if (held >= 4) {
      const missing = window.find((rank) => !ranks.has(rank))
      if (missing === low || missing === low + 4) {
        return 'openEnded'
      }
      gutshot = true
    }
  }

  return gutshot ? 'gutshot' : 'none'
}

function getBoardWetness(communityCards: Card[]): number {
  const suitCounts = new Map<Card['suit'], number>()
  for (const card of communityCards) {
    suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1)
  }

  const rankCounts = new Map<number, number>()
  for (const card of communityCards) {
    const value = RANK_VALUES[card.rank]
    rankCounts.set(value, (rankCounts.get(value) ?? 0) + 1)
  }

  const ranks = Array.from(rankCounts.keys()).sort((left, right) => left - right)
  const adjacentLinks = ranks.filter((rank, index) => index > 0 && rank - ranks[index - 1] <= 2).length
  const suitedness = Math.max(0, ...suitCounts.values())
  const paired = Array.from(rankCounts.values()).some((count) => count > 1)

  return (suitedness >= 3 ? 2 : suitedness === 2 ? 1 : 0) + (adjacentLinks >= 2 ? 2 : adjacentLinks) + (paired ? 1 : 0)
}

function postflopBetAmount(
  action: Extract<LegalAction, { type: 'bet' }>,
  context: NpcDecisionContext,
  assessment: NpcPostflopHandAssessment,
): number {
  const potFraction = assessment.boardWetness >= 2 ? 0.72 : 0.62
  const target = Math.max(action.min, Math.ceil(context.view.pot * potFraction))
  const stackAwareCap = Math.max(action.min, Math.round(getEffectiveStack(context.view) * 0.45))
  return Math.min(action.max, stackAwareCap, target)
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

function uniqueStraightRanks(cards: Card[]): Set<number> {
  const ranks = new Set(cards.map((card) => RANK_VALUES[card.rank]))
  if (ranks.has(RANK_VALUES.A)) {
    ranks.add(1)
  }
  return ranks
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

function clone<T>(value: T): T {
  return structuredClone(value)
}
