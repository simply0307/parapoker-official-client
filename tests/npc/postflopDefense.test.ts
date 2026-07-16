import { describe, expect, it } from 'vitest'
import {
  calculatePostflopDefenseMetrics,
  choosePostflopDefenseDecision,
} from '../../src/npc/postflopDefense'
import { createPostflopStrategy, type NpcPostflopHandAssessment } from '../../src/npc/postflopStrategy'
import type { NpcRangeBucketWeights, NpcRangeState } from '../../src/npc/rangeTracking'
import type { Card, LegalAction, PositionLabel, PrivateSeatView } from '../../src/poker-engine'
import type { Rng } from '../../src/shared/rng'

const AIR: NpcPostflopHandAssessment = {
  madeStrength: 0.12,
  hasStrongDraw: false,
  hasAnyDraw: false,
  boardWetness: 0,
}

describe('NPC MDF-informed postflop defense', () => {
  it('calculates MDF and pot odds from the pot before a half-pot wager', () => {
    const metrics = calculatePostflopDefenseMetrics(facingBetView({ potBeforeBet: 100, bet: 50 }), 50)

    expect(metrics).toEqual({
      potBeforeWager: 100,
      wagerAmount: 50,
      continueCost: 50,
      betToPotRatio: 0.5,
      minimumDefenseFrequency: 2 / 3,
      potOdds: 0.25,
    })
  })

  it('calculates the standard fifty-percent MDF against a pot-sized wager', () => {
    const metrics = calculatePostflopDefenseMetrics(facingBetView({ potBeforeBet: 100, bet: 100 }), 100)

    expect(metrics.minimumDefenseFrequency).toBe(0.5)
    expect(metrics.potOdds).toBeCloseTo(1 / 3)
    expect(metrics.betToPotRatio).toBe(1)
  })

  it('keeps a strong draw against a fair price but releases air to an overbet', () => {
    const strategy = createPostflopStrategy({
      id: 'defense-baseline',
      aggression: 0.5,
      defense: { mdfAdherence: 0.8, foldBias: 0 },
    })
    const fairView = facingBetView({ potBeforeBet: 100, bet: 50, texture: 'wet' })
    const draw = choosePostflopDefenseDecision({
      view: fairView,
      legalActions: fairView.legalActions,
      strategy,
      rangeState: rangeState({ texture: 'wet' }),
      assessment: { ...AIR, hasStrongDraw: true, hasAnyDraw: true, boardWetness: 3 },
      rng: fixedRng(0.7),
    })
    const overbetView = facingBetView({ potBeforeBet: 100, bet: 200 })
    const overbet = choosePostflopDefenseDecision({
      view: overbetView,
      legalActions: overbetView.legalActions,
      strategy,
      rangeState: rangeState(),
      assessment: AIR,
      rng: fixedRng(0.25),
    })

    expect(draw?.command).toEqual({ type: 'call', seatId: 'hero', source: 'npc' })
    expect(draw?.reason).toBe('strongDrawCall')
    expect(overbet?.command).toEqual({ type: 'fold', seatId: 'hero', source: 'npc' })
    expect(overbet?.reason).toBe('fold')
  })

  it('adjusts marginal defense for position and inferred range disadvantage', () => {
    const strategy = createPostflopStrategy({
      id: 'contextual-defense',
      aggression: 0.5,
      defense: {
        mdfAdherence: 0.85,
        foldBias: 0,
        positionBonus: 0.12,
        rangeDisadvantagePenalty: 0.4,
      },
    })
    const assessment = { ...AIR, madeStrength: 0.45 }
    const inPositionView = facingBetView({ potBeforeBet: 100, bet: 50, heroPosition: 'BTN' })
    const outOfPositionView = facingBetView({ potBeforeBet: 100, bet: 50, heroPosition: 'BB' })
    const favorable = rangeState({ heroTop: 0.42, opponentTop: 0.18 })
    const disadvantaged = rangeState({ heroTop: 0.18, opponentTop: 0.52 })

    const inPosition = choosePostflopDefenseDecision({
      view: inPositionView,
      legalActions: inPositionView.legalActions,
      strategy,
      rangeState: favorable,
      assessment,
      rng: fixedRng(0.6),
    })
    const outOfPosition = choosePostflopDefenseDecision({
      view: outOfPositionView,
      legalActions: outOfPositionView.legalActions,
      strategy,
      rangeState: disadvantaged,
      assessment,
      rng: fixedRng(0.6),
    })

    expect(inPosition?.command.type).toBe('call')
    expect(outOfPosition?.command.type).toBe('fold')
    expect(inPosition?.continueProbability).toBeGreaterThan(outOfPosition?.continueProbability ?? 1)
    expect(outOfPosition?.rangeDisadvantage).toBeGreaterThan(0)
  })

  it('derives postflop position from active seat order instead of treating the cutoff as always in position', () => {
    const strategy = createPostflopStrategy({
      id: 'action-order-position',
      aggression: 0.5,
      defense: { positionBonus: 0.2, rangeDisadvantagePenalty: 0 },
    })
    const cutoffView = facingBetView({ potBeforeBet: 100, bet: 50, heroPosition: 'CO' })
    const bigBlindView = facingBetView({ potBeforeBet: 100, bet: 50, heroPosition: 'BB' })
    const assessment = { ...AIR, madeStrength: 0.4 }

    const cutoff = decide(cutoffView, strategy, rangeState(), assessment, 0.99)
    const bigBlind = decide(bigBlindView, strategy, rangeState(), assessment, 0.99)

    expect(cutoff?.continueProbability).toBe(bigBlind?.continueProbability)
  })

  it('reduces defense in multiway pots and increases commitment at low SPR', () => {
    const strategy = createPostflopStrategy({
      id: 'table-context-defense',
      aggression: 0.5,
      defense: {
        mdfAdherence: 0.8,
        foldBias: 0,
        multiwayPenalty: 0.14,
        shortStackCommitmentBonus: 0.16,
      },
    })
    const assessment = { ...AIR, madeStrength: 0.42 }
    const headsUp = facingBetView({ potBeforeBet: 100, bet: 50, heroStack: 200 })
    const multiway = facingBetView({ potBeforeBet: 100, bet: 50, heroStack: 200, opponentCount: 3 })
    const shortStacked = facingBetView({ potBeforeBet: 100, bet: 50, heroStack: 45 })

    const headsUpDecision = decide(headsUp, strategy, rangeState(), assessment, 0.99)
    const multiwayDecision = decide(multiway, strategy, rangeState({ opponentCount: 3 }), assessment, 0.99)
    const shortDecision = decide(shortStacked, strategy, rangeState(), assessment, 0.99)

    expect(headsUpDecision?.continueProbability).toBeGreaterThan(multiwayDecision?.continueProbability ?? 1)
    expect(shortDecision?.continueProbability).toBeGreaterThan(headsUpDecision?.continueProbability ?? 1)
    expect(shortDecision?.effectiveStackToPotRatio).toBeLessThan(1)
  })

  it('makes NPC skill deviations deterministic and profile configurable', () => {
    const view = facingBetView({ potBeforeBet: 100, bet: 50 })
    const assessment = { ...AIR, madeStrength: 0.4 }
    const sticky = createPostflopStrategy({
      id: 'sticky-defense',
      aggression: 0.5,
      defense: { mdfAdherence: 1, foldBias: -0.18 },
    })
    const overfolder = createPostflopStrategy({
      id: 'overfolding-defense',
      aggression: 0.5,
      defense: { mdfAdherence: 1, foldBias: 0.18 },
    })

    const stickyDecision = decide(view, sticky, rangeState(), assessment, 0.55)
    const overfoldDecision = decide(view, overfolder, rangeState(), assessment, 0.55)

    expect(stickyDecision?.command.type).toBe('call')
    expect(overfoldDecision?.command.type).toBe('fold')
    expect(stickyDecision?.roll).toBe(overfoldDecision?.roll)
    expect(stickyDecision?.continueProbability).toBeGreaterThan(overfoldDecision?.continueProbability ?? 1)
  })

  it('uses a passive all-in through the shared command gateway for a short call', () => {
    const view = facingBetView({ potBeforeBet: 100, bet: 50, heroStack: 20 })
    view.legalActions = [
      { type: 'fold' },
      { type: 'allIn', amount: 20, targetContribution: 20 },
    ]
    const strategy = createPostflopStrategy({
      id: 'short-call-defense',
      aggression: 0.5,
      defense: { mdfAdherence: 1, foldBias: -0.3 },
    })
    const decision = choosePostflopDefenseDecision({
      view,
      legalActions: view.legalActions,
      strategy,
      rangeState: rangeState(),
      assessment: { ...AIR, madeStrength: 0.74 },
      rng: fixedRng(0.99),
    })

    expect(decision?.command).toEqual({ type: 'allIn', seatId: 'hero', source: 'npc' })
    expect(decision?.metrics.continueCost).toBe(20)
  })
})

function decide(
  view: PrivateSeatView,
  strategy: ReturnType<typeof createPostflopStrategy>,
  ranges: NpcRangeState,
  assessment: NpcPostflopHandAssessment,
  roll: number,
) {
  return choosePostflopDefenseDecision({
    view,
    legalActions: view.legalActions,
    strategy,
    rangeState: ranges,
    assessment,
    rng: fixedRng(roll),
  })
}

function facingBetView(options: {
  potBeforeBet: number
  bet: number
  heroStack?: number
  heroPosition?: PositionLabel
  opponentCount?: number
  texture?: NpcRangeState['boardTexture']
}): PrivateSeatView {
  const heroStack = options.heroStack ?? 200
  const opponentCount = options.opponentCount ?? 1
  const legalActions: LegalAction[] = [
    { type: 'fold' },
    { type: 'call', amount: Math.min(options.bet, heroStack) },
    ...(heroStack > options.bet ? [{ type: 'raise', min: options.bet * 2, max: heroStack } as const] : []),
    { type: 'allIn', amount: heroStack, targetContribution: heroStack },
  ]
  return {
    status: 'handInProgress',
    handNumber: 1,
    street: 'flop',
    communityCards: [card('A', 'spades'), card('7', 'diamonds'), card('2', 'clubs')],
    pot: options.potBeforeBet + options.bet,
    currentBet: options.bet,
    minRaise: options.bet,
    pendingSeatId: 'hero',
    seats: [
      seat('hero', options.heroPosition ?? 'BB', heroStack),
      ...Array.from({ length: opponentCount }, (_, index) =>
        seat(`villain-${index + 1}`, index === 0 ? 'BTN' : 'CO', 200)),
    ],
    events: [],
    heroSeatId: 'hero',
    holeCards: [card('K', 'clubs'), card('Q', 'clubs')],
    legalActions,
  }
}

function rangeState(options: {
  texture?: NpcRangeState['boardTexture']
  heroTop?: number
  opponentTop?: number
  opponentCount?: number
} = {}): NpcRangeState {
  const heroTop = options.heroTop ?? 0.3
  const opponentTop = options.opponentTop ?? 0.3
  const opponentCount = options.opponentCount ?? 1
  return {
    schemaVersion: 'npc-range-state-v1',
    handNumber: 1,
    street: 'flop',
    heroSeatId: 'hero',
    boardTexture: options.texture ?? 'dry',
    communityCardCount: 3,
    processedThroughSequenceNumber: 0,
    seats: {
      hero: rangeSeat('hero', heroTop, true),
      ...Object.fromEntries(Array.from({ length: opponentCount }, (_, index) => {
        const id = `villain-${index + 1}`
        return [id, rangeSeat(id, opponentTop, false)]
      })),
    },
  }
}

function rangeSeat(seatId: string, top: number, hero: boolean): NpcRangeState['seats'][string] {
  const premium = top * 0.35
  const strong = top - premium
  const remainder = 1 - top
  return {
    seatId,
    position: hero ? 'BB' : 'BTN',
    source: hero ? 'hero-private' : 'public-inference',
    active: true,
    rangeWidth: 0.45,
    weights: weights(premium, strong, remainder * 0.35, remainder * 0.25, remainder * 0.4),
    initiative: !hero,
    actionsObserved: 2,
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

function seat(id: string, position: PositionLabel, stack: number): PrivateSeatView['seats'][number] {
  return {
    id,
    name: id,
    kind: 'npc',
    position,
    stack,
    status: 'active',
    streetContribution: 0,
    totalContribution: 0,
    isDealer: position === 'BTN',
    isSmallBlind: false,
    isBigBlind: position === 'BB',
  }
}

function fixedRng(value: number): Rng {
  return { next: () => value, state: () => Math.round(value * 1_000_000) }
}

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit }
}
