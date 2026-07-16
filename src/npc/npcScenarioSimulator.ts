import type { Card, PositionLabel, PrivateSeatView } from '../poker-engine'
import type { Rng } from '../shared/rng'
import type { NpcStrategyProfile } from './config'
import {
  choosePostflopDefenseDecision,
  type NpcPostflopDefenseDecision,
} from './postflopDefense'
import type { NpcRangeBucketWeights, NpcRangeState } from './rangeTracking'

export interface NpcPostflopDefenseScenario {
  potBeforeWager: number
  wager: number
  heroStack: number
  madeStrength: number
  draw: 'none' | 'draw' | 'strongDraw'
  boardTexture: NpcRangeState['boardTexture']
  heroPosition: 'BTN' | 'CO' | 'BB'
  opponentCount: number
  heroRangeTop: number
  opponentRangeTop: number
  roll: number
}

export type NpcPostflopDefenseSimulationResult =
  | { ok: true; decision: NpcPostflopDefenseDecision }
  | { ok: false; error: string }

export function simulatePostflopDefenseScenario(
  profile: NpcStrategyProfile,
  scenario: NpcPostflopDefenseScenario,
): NpcPostflopDefenseSimulationResult {
  if (!profile.postflopStrategy) {
    return { ok: false, error: 'The selected profile has no postflop strategy.' }
  }
  const normalized = normalizeScenario(scenario)
  const view = scenarioView(normalized)
  const decision = choosePostflopDefenseDecision({
    view,
    legalActions: view.legalActions,
    strategy: profile.postflopStrategy,
    rangeState: scenarioRangeState(normalized),
    assessment: {
      madeStrength: normalized.madeStrength,
      hasStrongDraw: normalized.draw === 'strongDraw',
      hasAnyDraw: normalized.draw !== 'none',
      boardWetness: normalized.boardTexture === 'wet' ? 3 : normalized.boardTexture === 'dynamic' ? 2 : 0,
    },
    rng: fixedRng(normalized.roll),
  })
  return decision
    ? { ok: true, decision }
    : { ok: false, error: 'The scenario does not produce a legal defensive decision.' }
}

function normalizeScenario(scenario: NpcPostflopDefenseScenario): NpcPostflopDefenseScenario {
  return {
    ...scenario,
    potBeforeWager: positive(scenario.potBeforeWager),
    wager: positive(scenario.wager),
    heroStack: positive(scenario.heroStack),
    madeStrength: clamp01(scenario.madeStrength),
    opponentCount: Math.max(1, Math.min(5, Math.round(scenario.opponentCount))),
    heroRangeTop: clamp01(scenario.heroRangeTop),
    opponentRangeTop: clamp01(scenario.opponentRangeTop),
    roll: clamp01(scenario.roll),
  }
}

function scenarioView(scenario: NpcPostflopDefenseScenario): PrivateSeatView {
  const continueCost = Math.min(scenario.wager, scenario.heroStack)
  const opponentSeats = Array.from({ length: scenario.opponentCount }, (_, index) => {
    const position: PositionLabel = index === 0 ? 'BTN' : index === 1 ? 'SB' : index === 2 ? 'UTG' : 'HJ'
    return seat(`villain-${index + 1}`, position, 200, scenario.heroPosition !== 'BTN' && index === 0)
  })
  return {
    status: 'handInProgress',
    handNumber: 1,
    street: 'flop',
    communityCards: boardFor(scenario.boardTexture),
    pot: scenario.potBeforeWager + scenario.wager,
    currentBet: scenario.wager,
    minRaise: Math.max(1, scenario.wager),
    pendingSeatId: 'hero',
    seats: [
      seat('hero', scenario.heroPosition, scenario.heroStack, scenario.heroPosition === 'BTN'),
      ...opponentSeats,
    ],
    events: [{
      schemaVersion: 'poker-event-v1',
      eventId: 'scenario-event-1',
      sequenceNumber: 1,
      handId: 1,
      visibility: 'public',
      type: 'actionApplied',
      payload: {
        seatId: 'villain-1',
        action: 'bet',
        amount: scenario.wager,
        targetContribution: scenario.wager,
      },
    }],
    heroSeatId: 'hero',
    holeCards: [card('K', 'clubs'), card('Q', 'clubs')],
    legalActions: [
      { type: 'fold' },
      { type: 'call', amount: continueCost },
      ...(scenario.heroStack > scenario.wager * 2
        ? [{ type: 'raise', min: scenario.wager * 2, max: scenario.heroStack } as const]
        : []),
      { type: 'allIn', amount: scenario.heroStack, targetContribution: scenario.heroStack },
    ],
  }
}

function scenarioRangeState(scenario: NpcPostflopDefenseScenario): NpcRangeState {
  return {
    schemaVersion: 'npc-range-state-v1',
    handNumber: 1,
    street: 'flop',
    heroSeatId: 'hero',
    boardTexture: scenario.boardTexture,
    communityCardCount: 3,
    processedThroughSequenceNumber: 1,
    seats: {
      hero: rangeSeat('hero', scenario.heroPosition, scenario.heroRangeTop, true),
      ...Object.fromEntries(Array.from({ length: scenario.opponentCount }, (_, index) => {
        const id = `villain-${index + 1}`
        return [id, rangeSeat(id, index === 0 ? 'BTN' : 'SB', scenario.opponentRangeTop, false)]
      })),
    },
  }
}

function rangeSeat(
  seatId: string,
  position: PositionLabel,
  top: number,
  hero: boolean,
): NpcRangeState['seats'][string] {
  const premium = top * 0.35
  const strong = top - premium
  const remainder = 1 - top
  return {
    seatId,
    position,
    source: hero ? 'hero-private' : 'public-inference',
    active: true,
    rangeWidth: 0.45,
    weights: weights(premium, strong, remainder * 0.35, remainder * 0.25, remainder * 0.4),
    initiative: !hero,
    actionsObserved: 1,
    ...(hero ? { knownHandClass: 'KQo' } : {}),
  }
}

function weights(
  premium: number,
  strong: number,
  medium: number,
  draw: number,
  weak: number,
): NpcRangeBucketWeights {
  return { premium, strong, medium, draw, weak }
}

function seat(
  id: string,
  position: PositionLabel,
  stack: number,
  isDealer: boolean,
): PrivateSeatView['seats'][number] {
  return {
    id,
    name: id,
    kind: 'npc',
    position,
    stack,
    status: 'active',
    streetContribution: id === 'hero' ? 0 : 1,
    totalContribution: id === 'hero' ? 0 : 1,
    isDealer,
    isSmallBlind: position === 'SB',
    isBigBlind: position === 'BB',
  }
}

function boardFor(texture: NpcRangeState['boardTexture']): Card[] {
  if (texture === 'wet') {
    return [card('9', 'hearts'), card('8', 'hearts'), card('7', 'clubs')]
  }
  if (texture === 'dynamic') {
    return [card('J', 'spades'), card('T', 'spades'), card('4', 'diamonds')]
  }
  if (texture === 'paired') {
    return [card('8', 'spades'), card('8', 'diamonds'), card('2', 'clubs')]
  }
  return [card('A', 'spades'), card('7', 'diamonds'), card('2', 'clubs')]
}

function fixedRng(value: number): Rng {
  return { next: () => value, state: () => Math.round(value * 1_000_000) }
}

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit }
}

function positive(value: number): number {
  return Math.max(1, Number.isFinite(value) ? value : 1)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}
