import type { HandHistoryEvent, SeatId, Street } from '../poker-engine'
import type { ArchivedSessionDetail } from '../persistence'
import type { NpcStrategyCalibrationMetricId } from './config'

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
      }
      accumulator.matchIds.add(archive.session.matchId)
      const hands = archive.hands.filter((hand) => hand.participantSeatIds.includes(participant.seatId))
      accumulator.handCount += hands.length
      for (const hand of hands) analyzeHand(hand.orderedPublicEvents, participant.seatId, accumulator.metrics)
      accumulators.set(key, accumulator)
    }
  }
  return [...accumulators.values()]
    .map((accumulator) => ({
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
    }))
    .sort((left, right) => profileKey(left.profileId, left.profileVersion).localeCompare(profileKey(right.profileId, right.profileVersion)))
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
