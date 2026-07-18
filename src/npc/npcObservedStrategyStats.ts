import type { HandHistoryEvent, SeatId, Street } from '../poker-engine'
import type { ArchivedSessionDetail } from '../persistence'
import type { NpcStrategyCalibrationMetricId } from './config'
import type { NpcDecisionSource, NpcDecisionTrace } from './npcDecisionTrace'

export type NpcTeachingObservedMetricId =
  | 'teaching.blindFold'
  | 'teaching.flopCbetTurnGiveUp'
  | 'teaching.drawContinue'
  | 'teaching.largeBetContinue'
  | 'teaching.riverAggression'
  | 'teaching.thinValueAttempt'
  | 'teaching.fallbackDecision'

export interface NpcDecisionCoverageEvidence {
  totalDecisions: number
  sourceCounts: Record<NpcDecisionSource, number>
  sourceRates: Record<NpcDecisionSource, number>
  fallbackRate: number
  mostCommonFallbackSituations: Array<{ situationId: string; count: number }>
}

export interface NpcObservedStrategyMetric {
  value: number
  opportunities: number
  successes: number
}

export interface NpcObservedStrategyEvidence {
  schemaVersion: 'npc-observed-strategy-v1'
  profileId: string
  profileVersion: number
  matchIds: string[]
  handCount: number
  metrics: Partial<Record<NpcStrategyCalibrationMetricId, NpcObservedStrategyMetric>>
  teachingMetrics: Partial<Record<NpcTeachingObservedMetricId, NpcObservedStrategyMetric>>
  decisionCoverage: NpcDecisionCoverageEvidence
}

interface MetricCounter {
  opportunities: number
  successes: number
}

interface EvidenceAccumulator {
  profileId: string
  profileVersion: number
  matchIds: Set<string>
  handCount: number
  metrics: Partial<Record<NpcStrategyCalibrationMetricId, MetricCounter>>
  teachingMetrics: Partial<Record<NpcTeachingObservedMetricId, MetricCounter>>
  traces: NpcDecisionTrace[]
}

export function deriveNpcStrategyEvidence(
  archives: readonly ArchivedSessionDetail[],
): NpcObservedStrategyEvidence[] {
  const accumulators = new Map<string, EvidenceAccumulator>()
  for (const archive of archives) {
    for (const participant of archive.session.participants) {
      if (participant.kind !== 'npc' || !participant.npcStrategyProfileId || !participant.npcStrategyProfileVersion) continue
      const key = profileKey(participant.npcStrategyProfileId, participant.npcStrategyProfileVersion)
      const accumulator = accumulators.get(key) ?? {
        profileId: participant.npcStrategyProfileId,
        profileVersion: participant.npcStrategyProfileVersion,
        matchIds: new Set<string>(),
        handCount: 0,
        metrics: {},
        teachingMetrics: {},
        traces: [],
      }
      accumulator.matchIds.add(archive.session.matchId)
      const hands = archive.hands.filter((hand) => hand.participantSeatIds.includes(participant.seatId))
      accumulator.handCount += hands.length
      for (const hand of hands) analyzeHand(hand.orderedPublicEvents, participant.seatId, accumulator.metrics)
      accumulator.traces.push(...(archive.session.authorityArchive?.npcDecisionTraces ?? []).filter((trace) =>
        trace.seatId === participant.seatId &&
        trace.strategyProfileId === participant.npcStrategyProfileId &&
        trace.strategyProfileVersion === participant.npcStrategyProfileVersion))
      accumulators.set(key, accumulator)
    }
  }
  return [...accumulators.values()]
    .map((accumulator) => {
      analyzeTeachingTraces(accumulator.traces, accumulator.teachingMetrics)
      return {
      schemaVersion: 'npc-observed-strategy-v1' as const,
      profileId: accumulator.profileId,
      profileVersion: accumulator.profileVersion,
      matchIds: [...accumulator.matchIds].sort(),
      handCount: accumulator.handCount,
      metrics: Object.fromEntries(Object.entries(accumulator.metrics).map(([id, counter]) => [
        id,
        {
          value: counter.opportunities > 0 ? round(counter.successes / counter.opportunities) : 0,
          opportunities: counter.opportunities,
          successes: counter.successes,
        },
      ])),
      teachingMetrics: metricsFromCounters(accumulator.teachingMetrics),
      decisionCoverage: coverageFromTraces(accumulator.traces),
    }})
    .sort((left, right) => profileKey(left.profileId, left.profileVersion).localeCompare(profileKey(right.profileId, right.profileVersion)))
}

function analyzeTeachingTraces(
  traces: readonly NpcDecisionTrace[],
  metrics: EvidenceAccumulator['teachingMetrics'],
): void {
  const ordered = [...traces].sort((left, right) =>
    left.handNumber - right.handNumber || left.seatId.localeCompare(right.seatId))
  for (const trace of ordered) {
    const aggressive = trace.selectedAction === 'bet' || trace.selectedAction === 'raise' || trace.selectedAction === 'allIn'
    const continued = trace.selectedAction !== 'fold'
    const position = String(trace.calculatedValues.position ?? '')
    const situation = String(trace.calculatedValues.situation ?? trace.situationId ?? '')
    if (trace.street === 'preflop' && position === 'BB' && situation.startsWith('facing')) {
      addTeachingOpportunity(metrics, 'teaching.blindFold', trace.selectedAction === 'fold')
    }
    if (trace.decisionSource === 'postflop-defense' && trace.calculatedValues.hasAnyDraw === true) {
      addTeachingOpportunity(metrics, 'teaching.drawContinue', continued)
    }
    if (trace.decisionSource === 'postflop-defense' && Number(trace.calculatedValues.betToPotRatio ?? 0) >= 0.75) {
      addTeachingOpportunity(metrics, 'teaching.largeBetContinue', continued)
    }
    if (trace.street === 'river') {
      addTeachingOpportunity(metrics, 'teaching.riverAggression', aggressive)
    }
    const madeStrength = Number(trace.calculatedValues.madeStrength ?? -1)
    const thinValueStrength = Number(trace.calculatedValues.thinValueStrength ?? trace.configuredValues.thinValueStrength ?? -1)
    const valueBetStrength = Number(trace.calculatedValues.valueBetStrength ?? trace.configuredValues.valueBetStrength ?? -1)
    if (madeStrength >= thinValueStrength && madeStrength < valueBetStrength && thinValueStrength >= 0) {
      addTeachingOpportunity(metrics, 'teaching.thinValueAttempt', trace.reasonCode === 'thinValueBet')
    }
    addTeachingOpportunity(
      metrics,
      'teaching.fallbackDecision',
      trace.decisionSource === 'legacy-fallback' || trace.decisionSource === 'safety-fallback',
    )
  }

  const byHandSeat = new Map<string, NpcDecisionTrace[]>()
  for (const trace of ordered) {
    const key = `${trace.handNumber}:${trace.seatId}`
    byHandSeat.set(key, [...(byHandSeat.get(key) ?? []), trace])
  }
  for (const decisions of byHandSeat.values()) {
    const cbet = decisions.find((trace) => trace.reasonCode === 'continuationBet')
    const turn = decisions.find((trace) => trace.street === 'turn')
    if (cbet && turn) {
      const turnAggressive = turn.selectedAction === 'bet' || turn.selectedAction === 'raise' || turn.selectedAction === 'allIn'
      addTeachingOpportunity(metrics, 'teaching.flopCbetTurnGiveUp', !turnAggressive)
    }
  }
}

function coverageFromTraces(traces: readonly NpcDecisionTrace[]): NpcDecisionCoverageEvidence {
  const sources: NpcDecisionSource[] = [
    'preflop-range',
    'proactive-postflop',
    'postflop-defense',
    'legacy-fallback',
    'safety-fallback',
  ]
  const sourceCounts = Object.fromEntries(sources.map((source) => [source, 0])) as Record<NpcDecisionSource, number>
  const fallbackSituations = new Map<string, number>()
  for (const trace of traces) {
    sourceCounts[trace.decisionSource] += 1
    if (trace.decisionSource === 'legacy-fallback' || trace.decisionSource === 'safety-fallback') {
      const situationId = trace.situationId ?? trace.reasonCode
      fallbackSituations.set(situationId, (fallbackSituations.get(situationId) ?? 0) + 1)
    }
  }
  const totalDecisions = traces.length
  const sourceRates = Object.fromEntries(sources.map((source) => [
    source,
    totalDecisions > 0 ? round(sourceCounts[source] / totalDecisions) : 0,
  ])) as Record<NpcDecisionSource, number>
  return {
    totalDecisions,
    sourceCounts,
    sourceRates,
    fallbackRate: round(sourceRates['legacy-fallback'] + sourceRates['safety-fallback']),
    mostCommonFallbackSituations: [...fallbackSituations.entries()]
      .map(([situationId, count]) => ({ situationId, count }))
      .sort((left, right) => right.count - left.count || left.situationId.localeCompare(right.situationId))
      .slice(0, 5),
  }
}

function metricsFromCounters<TId extends string>(
  counters: Partial<Record<TId, MetricCounter>>,
): Partial<Record<TId, NpcObservedStrategyMetric>> {
  return Object.fromEntries(Object.entries(counters).map(([id, value]) => {
    const counter = value as MetricCounter
    return [id, {
      value: counter.opportunities > 0 ? round(counter.successes / counter.opportunities) : 0,
      opportunities: counter.opportunities,
      successes: counter.successes,
    }]
  })) as Partial<Record<TId, NpcObservedStrategyMetric>>
}

function addTeachingOpportunity(
  metrics: EvidenceAccumulator['teachingMetrics'],
  id: NpcTeachingObservedMetricId,
  success: boolean,
): void {
  const counter = metrics[id] ?? { opportunities: 0, successes: 0 }
  counter.opportunities += 1
  if (success) counter.successes += 1
  metrics[id] = counter
}

function analyzeHand(
  events: readonly HandHistoryEvent[],
  seatId: SeatId,
  metrics: EvidenceAccumulator['metrics'],
): void {
  const ordered = [...events]
    .filter((event) => event.visibility === 'public')
    .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
  let street: Street = 'preflop'
  let totalCommitted = 0
  let currentBet = 0
  let streetAggressor: SeatId | undefined
  let priorStreetAggressor: SeatId | undefined
  let preflopAggressor: SeatId | undefined
  let preflopVoluntarySeen = false
  let preflopRaiseCount = 0
  let openerSeatId: SeatId | undefined
  let openerFacedThreeBet = false
  let lastAggressionBetToPot = 0
  const streetContributions = new Map<SeatId, number>()
  const firstPreflopActions = new Set<SeatId>()
  const actedThisStreet = new Set<SeatId>()
  let vpip = false

  for (const event of ordered) {
    if (event.type === 'blindPosted') {
      totalCommitted += event.payload.amount
      streetContributions.set(event.payload.seatId, event.payload.amount)
      currentBet = Math.max(currentBet, event.payload.amount)
      continue
    }
    if (event.type === 'streetAdvanced') {
      priorStreetAggressor = street === 'preflop' ? preflopAggressor : streetAggressor
      street = event.payload.street
      currentBet = 0
      streetAggressor = undefined
      lastAggressionBetToPot = 0
      streetContributions.clear()
      actedThisStreet.clear()
      continue
    }
    if (event.type !== 'actionApplied') continue

    const action = event.payload.action
    const actor = event.payload.seatId
    const previousContribution = streetContributions.get(actor) ?? 0
    const facingWager = currentBet > previousContribution
    const aggressive = action === 'bet' || action === 'raise' ||
      (action === 'allIn' && event.payload.targetContribution > currentBet)
    const firstActionOnStreet = !actedThisStreet.has(actor)
    const potBeforeAction = totalCommitted

    if (street === 'preflop') {
      if (actor === seatId && !firstPreflopActions.has(actor)) {
        if (!preflopVoluntarySeen) addOpportunity(metrics, 'preflop.openRaise', aggressive)
        if (preflopRaiseCount === 1 && actor !== openerSeatId) addOpportunity(metrics, 'preflop.threeBet', aggressive)
        firstPreflopActions.add(actor)
      }
      if (actor === seatId && (action === 'call' || aggressive)) vpip = true
      if (actor === seatId && openerFacedThreeBet && actor === openerSeatId) {
        addOpportunity(metrics, 'preflop.foldToThreeBet', action === 'fold')
        openerFacedThreeBet = false
      }
      if (aggressive) {
        preflopRaiseCount += 1
        preflopAggressor = actor
        if (preflopRaiseCount === 1) openerSeatId = actor
        if (preflopRaiseCount === 2 && openerSeatId) openerFacedThreeBet = true
      }
      if (action === 'call' || aggressive) preflopVoluntarySeen = true
    } else if (actor === seatId) {
      if (facingWager) {
        const continued = action !== 'fold'
        addOpportunity(metrics, 'defense.continue', continued)
        if (lastAggressionBetToPot >= 0.75) addOpportunity(metrics, 'defense.largeBetContinue', continued)
      } else if (action === 'check' || aggressive) {
        addOpportunity(metrics, 'proactive.bet', aggressive)
      }
      if (street === 'flop' && actor === preflopAggressor && firstActionOnStreet && !facingWager) {
        addOpportunity(metrics, 'proactive.continuationBet', aggressive)
      }
      if ((street === 'turn' || street === 'river') && actor === priorStreetAggressor && firstActionOnStreet && !facingWager) {
        addOpportunity(metrics, 'proactive.barrel', aggressive)
      }
      if (aggressive && !facingWager && potBeforeAction > 0) {
        addAverage(metrics, 'proactive.averagePotFraction', event.payload.amount / potBeforeAction)
      }
    }

    if (aggressive) {
      const wager = Math.max(0, event.payload.targetContribution - currentBet)
      lastAggressionBetToPot = potBeforeAction > 0 ? wager / potBeforeAction : 0
      streetAggressor = actor
    }
    totalCommitted += event.payload.amount
    streetContributions.set(actor, event.payload.targetContribution)
    currentBet = Math.max(currentBet, event.payload.targetContribution)
    actedThisStreet.add(actor)
  }

  addOpportunity(metrics, 'preflop.vpip', vpip)
}

function addOpportunity(
  metrics: EvidenceAccumulator['metrics'],
  id: NpcStrategyCalibrationMetricId,
  success: boolean,
): void {
  const counter = metrics[id] ?? { opportunities: 0, successes: 0 }
  counter.opportunities += 1
  if (success) counter.successes += 1
  metrics[id] = counter
}

function addAverage(
  metrics: EvidenceAccumulator['metrics'],
  id: NpcStrategyCalibrationMetricId,
  value: number,
): void {
  const counter = metrics[id] ?? { opportunities: 0, successes: 0 }
  counter.opportunities += 1
  counter.successes += value
  metrics[id] = counter
}

function profileKey(profileId: string, version: number): string {
  return `${profileId}:v${version}`
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
