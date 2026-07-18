import { describe, expect, it } from 'vitest'
import {
  chooseProactivePostflopDecision,
  createPostflopStrategy,
  evaluateProactivePostflopDecision,
  validatePostflopStrategy,
  type NpcPostflopHandAssessment,
} from '../../src/npc/postflopStrategy'
import type { NpcRangeBucketWeights, NpcRangeState } from '../../src/npc/rangeTracking'
import type { Card, LegalAction, PrivateSeatView, Street } from '../../src/poker-engine'
import type { Rng } from '../../src/shared/rng'

const AIR: NpcPostflopHandAssessment = {
  madeStrength: 0.12,
  hasStrongDraw: false,
  hasAnyDraw: false,
  boardWetness: 0,
}

describe('NPC proactive postflop strategy', () => {
  it('creates a serializable, versioned, validated strategy contract', () => {
    const strategy = createPostflopStrategy({ id: 'postflop-contract', version: 4, aggression: 0.6 })

    expect(strategy).toEqual(expect.objectContaining({
      schemaVersion: 'npc-postflop-v1',
      id: 'postflop-contract',
      version: 4,
    }))
    expect(() => validatePostflopStrategy(strategy)).not.toThrow()
    expect(() => JSON.stringify(strategy)).not.toThrow()

    const invalid = structuredClone(strategy)
    invalid.frequencies.cBetFlop = 1.1
    expect(() => validatePostflopStrategy(invalid)).toThrow(/frequency/i)

    const unsafeDefense = structuredClone(strategy)
    if (!unsafeDefense.defense) {
      throw new Error('Expected a generated defense configuration.')
    }
    unsafeDefense.defense.foldBias = 0.75
    expect(() => validatePostflopStrategy(unsafeDefense)).toThrow(/defense/i)

    const legacy = structuredClone(strategy)
    delete legacy.defense
    expect(() => validatePostflopStrategy(legacy)).not.toThrow()
  })

  it('continuation-bets as the preflop aggressor with profile-owned sizing', () => {
    const strategy = createPostflopStrategy({
      id: 'always-cbet',
      aggression: 0.5,
      frequencies: { cBetFlop: 1, pureBluff: 0 },
      sizing: { dryFlopPotFraction: 0.45 },
    })
    const view = postflopView('flop')
    const ranges = rangeState('flop', { heroInitiative: true, heroLastAggressiveStreet: 'preflop' })
    const decision = chooseProactivePostflopDecision({
      view,
      legalActions: view.legalActions,
      strategy,
      rangeState: ranges,
      assessment: AIR,
      rng: fixedRng(0.8),
    })

    expect(decision).toEqual(expect.objectContaining({
      reason: 'continuationBet',
      probability: 1,
      command: { type: 'bet', seatId: 'hero', amount: 9, source: 'npc' },
    }))
  })

  it('semi-bluffs strong draws on dynamic boards independently of made-hand value', () => {
    const strategy = createPostflopStrategy({
      id: 'draw-pressure',
      aggression: 0.5,
      frequencies: { semiBluff: 1, cBetFlop: 0 },
      sizing: { dynamicFlopPotFraction: 0.6 },
    })
    const view = postflopView('flop')
    const ranges = rangeState('flop', { heroInitiative: false, boardTexture: 'dynamic' })
    const decision = chooseProactivePostflopDecision({
      view,
      legalActions: view.legalActions,
      strategy,
      rangeState: ranges,
      assessment: { ...AIR, hasStrongDraw: true, hasAnyDraw: true, boardWetness: 3 },
      rng: fixedRng(0.99),
    })

    expect(decision?.reason).toBe('semiBluff')
    expect(decision?.command).toEqual({ type: 'bet', seatId: 'hero', amount: 12, source: 'npc' })
  })

  it('distinguishes probes from turn barrels using public range memory', () => {
    const strategy = createPostflopStrategy({
      id: 'line-selection',
      aggression: 0.5,
      frequencies: { probeBet: 1, turnBarrel: 1, pureBluff: 0 },
    })
    const flopView = postflopView('flop')
    const probe = chooseProactivePostflopDecision({
      view: flopView,
      legalActions: flopView.legalActions,
      strategy,
      rangeState: rangeState('flop', { heroInitiative: false, opponentLastAction: 'check' }),
      assessment: AIR,
      rng: fixedRng(0.5),
    })
    const turnView = postflopView('turn')
    const barrel = chooseProactivePostflopDecision({
      view: turnView,
      legalActions: turnView.legalActions,
      strategy,
      rangeState: rangeState('turn', { heroInitiative: true, heroLastAggressiveStreet: 'flop' }),
      assessment: AIR,
      rng: fixedRng(0.5),
    })

    expect(probe?.reason).toBe('probeBet')
    expect(barrel?.reason).toBe('turnBarrel')
  })

  it('applies the position bonus from active six-max action order', () => {
    const strategy = createPostflopStrategy({
      id: 'six-max-position-order',
      aggression: 0.5,
      frequencies: { cBetFlop: 0.4 },
      modifiers: { positionBonus: 0.2 },
    })
    const outOfPosition = sixMaxCutoffView('active')
    const inPosition = sixMaxCutoffView('folded')
    const ranges = rangeState('flop', { heroInitiative: true, heroLastAggressiveStreet: 'preflop' })
    const oopEvaluation = evaluateProactivePostflopDecision({
      view: outOfPosition,
      legalActions: outOfPosition.legalActions,
      strategy,
      rangeState: ranges,
      assessment: AIR,
      rng: fixedRng(0.99),
    })
    const ipEvaluation = evaluateProactivePostflopDecision({
      view: inPosition,
      legalActions: inPosition.legalActions,
      strategy,
      rangeState: ranges,
      assessment: AIR,
      rng: fixedRng(0.99),
    })

    expect((ipEvaluation?.probability ?? 0) - (oopEvaluation?.probability ?? 0)).toBeCloseTo(0.2)
  })

  it('raises strong value hands but leaves non-proactive defense to the fallback policy', () => {
    const strategy = createPostflopStrategy({
      id: 'value-raise',
      aggression: 0.5,
      frequencies: { valueRaise: 1, checkRaise: 0 },
      sizing: { raiseToMultiplier: 2.5 },
    })
    const facingBet = postflopView('flop', [
      { type: 'fold' },
      { type: 'call', amount: 10 },
      { type: 'raise', min: 20, max: 100 },
      { type: 'allIn', amount: 100, targetContribution: 100 },
    ])
    const ranges = rangeState('flop', { heroInitiative: false, opponentLastAction: 'bet' })
    const value = chooseProactivePostflopDecision({
      view: facingBet,
      legalActions: facingBet.legalActions,
      strategy,
      rangeState: ranges,
      assessment: { ...AIR, madeStrength: 0.9 },
      rng: fixedRng(0.5),
    })
    const air = chooseProactivePostflopDecision({
      view: facingBet,
      legalActions: facingBet.legalActions,
      strategy,
      rangeState: ranges,
      assessment: AIR,
      rng: fixedRng(0.5),
    })

    expect(value?.reason).toBe('valueRaise')
    expect(value?.command).toEqual({ type: 'raise', seatId: 'hero', amount: 25, source: 'npc' })
    expect(air).toBeUndefined()
  })

  it('uses effective stacks to choose a committed low-SPR value size', () => {
    const strategy = createPostflopStrategy({
      id: 'low-spr-value',
      aggression: 0.5,
      sizing: { dryFlopPotFraction: 0.4 },
      modifiers: { shortStackAggressionBonus: 0.1 },
    })
    const view = postflopView('flop', [
      { type: 'check' },
      { type: 'bet', min: 2, max: 15 },
      { type: 'allIn', amount: 15, targetContribution: 15 },
    ])
    view.seats[0].stack = 15
    const decision = chooseProactivePostflopDecision({
      view,
      legalActions: view.legalActions,
      strategy,
      rangeState: rangeState('flop', { heroInitiative: true, heroLastAggressiveStreet: 'preflop' }),
      assessment: { ...AIR, madeStrength: 0.9 },
      rng: fixedRng(0.5),
    })

    expect(decision?.command).toEqual({ type: 'bet', seatId: 'hero', amount: 15, source: 'npc' })
    expect(decision?.effectiveStackToPotRatio).toBe(0.75)
  })

  it('checks weak ranges when every configured proactive frequency declines', () => {
    const strategy = createPostflopStrategy({
      id: 'no-bluff',
      aggression: 0,
      frequencies: {
        cBetFlop: 0,
        probeBet: 0,
        delayedCBetTurn: 0,
        turnBarrel: 0,
        riverBarrel: 0,
        semiBluff: 0,
        pureBluff: 0,
      },
    })
    const view = postflopView('flop')
    const decision = chooseProactivePostflopDecision({
      view,
      legalActions: view.legalActions,
      strategy,
      rangeState: rangeState('flop', { heroInitiative: true, heroLastAggressiveStreet: 'preflop' }),
      assessment: AIR,
      rng: fixedRng(0),
    })

    expect(decision).toBeUndefined()
  })
})

function postflopView(street: Street, legalActions: LegalAction[] = [
  { type: 'check' },
  { type: 'bet', min: 2, max: 100 },
  { type: 'allIn', amount: 100, targetContribution: 100 },
]): PrivateSeatView {
  const communityCards: Card[] = street === 'flop'
    ? [card('A', 'spades'), card('7', 'diamonds'), card('2', 'clubs')]
    : street === 'turn'
      ? [card('A', 'spades'), card('7', 'diamonds'), card('2', 'clubs'), card('T', 'hearts')]
      : [card('A', 'spades'), card('7', 'diamonds'), card('2', 'clubs'), card('T', 'hearts'), card('3', 'spades')]
  return {
    status: 'handInProgress',
    handNumber: 1,
    street,
    communityCards,
    pot: 20,
    currentBet: legalActions.some((action) => action.type === 'call') ? 10 : 0,
    minRaise: 2,
    pendingSeatId: 'hero',
    seats: [
      seat('hero', 'BTN'),
      seat('villain', 'BB'),
    ],
    events: [],
    heroSeatId: 'hero',
    holeCards: [card('K', 'clubs'), card('Q', 'clubs')],
    legalActions,
  }
}

function sixMaxCutoffView(buttonStatus: 'active' | 'folded'): PrivateSeatView {
  const view = postflopView('flop')
  view.heroSeatId = 'hero'
  view.pendingSeatId = 'hero'
  view.seats = [
    multiSeat('sb', 'SB'),
    multiSeat('bb', 'BB'),
    multiSeat('utg', 'UTG'),
    multiSeat('hj', 'HJ'),
    multiSeat('hero', 'CO'),
    { ...multiSeat('button', 'BTN', true), status: buttonStatus },
  ]
  return view
}

function rangeState(
  street: Street,
  options: {
    heroInitiative: boolean
    heroLastAggressiveStreet?: Street
    opponentLastAction?: 'check' | 'bet'
    boardTexture?: NpcRangeState['boardTexture']
  },
): NpcRangeState {
  return {
    schemaVersion: 'npc-range-state-v1',
    handNumber: 1,
    street,
    heroSeatId: 'hero',
    boardTexture: options.boardTexture ?? 'dry',
    communityCardCount: street === 'flop' ? 3 : street === 'turn' ? 4 : 5,
    processedThroughSequenceNumber: 0,
    seats: {
      hero: {
        seatId: 'hero',
        position: 'BTN',
        source: 'hero-private',
        active: true,
        rangeWidth: 0.3,
        weights: weights(0.12, 0.24, 0.24, 0.2, 0.2),
        initiative: options.heroInitiative,
        actionsObserved: 2,
        ...(options.heroLastAggressiveStreet ? { lastAggressiveStreet: options.heroLastAggressiveStreet } : {}),
        knownHandClass: 'KQs',
      },
      villain: {
        seatId: 'villain',
        position: 'BB',
        source: 'public-inference',
        active: true,
        rangeWidth: 0.5,
        weights: weights(0.08, 0.18, 0.26, 0.24, 0.24),
        initiative: !options.heroInitiative,
        actionsObserved: 2,
        ...(options.opponentLastAction ? { lastAction: options.opponentLastAction } : {}),
      },
    },
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

function seat(id: string, position: 'BTN' | 'BB'): PrivateSeatView['seats'][number] {
  return {
    id,
    name: id,
    kind: 'npc',
    position,
    stack: 100,
    status: 'active',
    streetContribution: 0,
    totalContribution: 0,
    isDealer: position === 'BTN',
    isSmallBlind: false,
    isBigBlind: position === 'BB',
  }
}

function multiSeat(
  id: string,
  position: NonNullable<PrivateSeatView['seats'][number]['position']>,
  isDealer = false,
): PrivateSeatView['seats'][number] {
  return {
    id,
    name: id,
    kind: 'npc',
    position,
    stack: 100,
    status: 'active',
    streetContribution: 0,
    totalContribution: 0,
    isDealer,
    isSmallBlind: position === 'SB',
    isBigBlind: position === 'BB',
  }
}

function fixedRng(value: number): Rng {
  return { next: () => value, state: () => Math.round(value * 1_000_000) }
}

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit }
}
