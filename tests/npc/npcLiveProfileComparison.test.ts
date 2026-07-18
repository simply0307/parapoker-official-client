import { describe, expect, it } from 'vitest'
import { BasicNpcPolicy, createNpcDecisionContext, type NpcTableMemory } from '../../src/npc/basicNpc'
import type { NpcStrategyProfile } from '../../src/npc/config'
import type { NpcDecisionResult } from '../../src/npc/npcDecisionTrace'
import type { NpcRangeState } from '../../src/npc/rangeTracking'
import { LOCAL_NPC_STRATEGY_PROFILES } from '../../src/npc/roster'
import type { Card, LegalAction, PositionLabel, PrivateSeatView, Street } from '../../src/poker-engine'
import { createRng } from '../../src/shared/rng'

const FIXED_SEED_SET = [
  'live-profile-comparison-alpha',
  'live-profile-comparison-bravo',
  'live-profile-comparison-charlie',
  'live-profile-comparison-delta',
]
const OPPORTUNITIES_PER_SEED = 80

describe('live NPC profile comparisons', () => {
  it('observes the intended profile differences through BasicNpcPolicy', () => {
    const pressure = requireProfile('strategy-pressure-raiser-v5')
    const potControl = requireProfile('strategy-pot-controller-v5')
    const pressureOpens = observe(pressure, preflopOpenView, {})
    const controlledOpens = observe(potControl, preflopOpenView, {})
    const pressureBarrels = observe(pressure, () => postflopView('turn'), postflopMemory('turn', 'flop'))
    const controlledBarrels = observe(potControl, () => postflopView('turn'), postflopMemory('turn', 'flop'))
    const stickyDefense = observe(requireProfile('strategy-balanced-caller-v5'), facingBetView, postflopMemory('flop'))
    const selectiveDefense = observe(potControl, facingBetView, postflopMemory('flop'))

    expect(pressureOpens.opportunities).toBe(FIXED_SEED_SET.length * OPPORTUNITIES_PER_SEED)
    expect(pressureOpens.aggressive).toBeGreaterThan(controlledOpens.aggressive)
    expect(pressureBarrels.opportunities).toBe(FIXED_SEED_SET.length * OPPORTUNITIES_PER_SEED)
    expect(pressureBarrels.aggressive, JSON.stringify({ pressure: pressureBarrels.probabilities, controlled: controlledBarrels.probabilities }))
      .toBeGreaterThan(controlledBarrels.aggressive)
    expect(mean(pressureBarrels.amounts)).toBeGreaterThan(mean(controlledBarrels.amounts))
    expect(stickyDefense.continues).toBeGreaterThan(selectiveDefense.continues)
  })

  it('reproduces identical live-path outcomes for the same profile and seed set', () => {
    const profile = requireProfile('strategy-pressure-raiser-v5')

    expect(observe(profile, () => postflopView('turn'), postflopMemory('turn', 'flop')))
      .toEqual(observe(profile, () => postflopView('turn'), postflopMemory('turn', 'flop')))
  })
})

function observe(
  profile: NpcStrategyProfile,
  createView: () => PrivateSeatView,
  memory: NpcTableMemory,
) {
  const decisions: NpcDecisionResult[] = FIXED_SEED_SET.flatMap((seed) => {
    const rng = createRng(seed)
    return Array.from({ length: OPPORTUNITIES_PER_SEED }, (_, index) => {
      const view = createView()
      return new BasicNpcPolicy().chooseDecision(createNpcDecisionContext(
        view,
        rng,
        profile.policyConfig,
        memory,
        profile.preflopStrategy,
        profile.postflopStrategy,
        {
          npcDefinitionId: 'npc-live-comparison',
          strategyProfileId: profile.id,
          strategyProfileVersion: profile.version,
          teachingTags: [],
        },
        {
          matchId: `comparison-match-${seed}`,
          tableId: `comparison-table-${seed}`,
          decisionSequence: index + 1,
        },
      ))
    })
  })
  return {
    opportunities: decisions.length,
    aggressive: decisions.filter(({ command }) => command.type === 'raise' || command.type === 'bet' || command.type === 'allIn').length,
    continues: decisions.filter(({ command }) => command.type !== 'fold').length,
    amounts: decisions.flatMap(({ command }) => 'amount' in command ? [command.amount] : []),
    outcomes: decisions.map(({ command }) => command),
    probabilities: [...new Set(decisions.map(({ trace }) => trace.probability))],
  }
}

function preflopOpenView(): PrivateSeatView {
  return tableView({
    street: 'preflop',
    communityCards: [],
    pot: 3,
    currentBet: 2,
    seats: sixMaxSeats('BTN'),
    holeCards: [card('A', 'spades'), card('5', 'spades')],
    legalActions: [
      { type: 'fold' },
      { type: 'call', amount: 2 },
      { type: 'raise', min: 4, max: 100 },
      { type: 'allIn', amount: 100, targetContribution: 100 },
    ],
  })
}

function postflopView(street: Extract<Street, 'flop' | 'turn'>): PrivateSeatView {
  return tableView({
    street,
    communityCards: street === 'flop'
      ? [card('A', 'spades'), card('7', 'diamonds'), card('2', 'clubs')]
      : [card('A', 'spades'), card('7', 'diamonds'), card('2', 'clubs'), card('T', 'hearts')],
    pot: 40,
    currentBet: 0,
    seats: headsUpSeats(),
    holeCards: [card('K', 'clubs'), card('Q', 'clubs')],
    legalActions: [
      { type: 'check' },
      { type: 'bet', min: 2, max: 100 },
      { type: 'allIn', amount: 100, targetContribution: 100 },
    ],
  })
}

function facingBetView(): PrivateSeatView {
  const view = postflopView('flop')
  view.pot = 60
  view.currentBet = 20
  view.legalActions = [
    { type: 'fold' },
    { type: 'call', amount: 20 },
    { type: 'raise', min: 40, max: 100 },
    { type: 'allIn', amount: 100, targetContribution: 100 },
  ]
  return view
}

function tableView(input: {
  street: Street
  communityCards: Card[]
  pot: number
  currentBet: number
  seats: PrivateSeatView['seats']
  holeCards: Card[]
  legalActions: LegalAction[]
}): PrivateSeatView {
  return {
    status: 'handInProgress',
    handNumber: 1,
    street: input.street,
    communityCards: input.communityCards,
    pot: input.pot,
    currentBet: input.currentBet,
    minRaise: 2,
    pendingSeatId: 'hero',
    seats: input.seats,
    events: [],
    heroSeatId: 'hero',
    holeCards: input.holeCards,
    legalActions: input.legalActions,
  }
}

function postflopMemory(street: Extract<Street, 'flop' | 'turn'>, lastAggressiveStreet: Street = 'preflop'): NpcTableMemory {
  const rangeState: NpcRangeState = {
    schemaVersion: 'npc-range-state-v1',
    handNumber: 1,
    street,
    heroSeatId: 'hero',
    boardTexture: 'dry',
    communityCardCount: street === 'flop' ? 3 : 4,
    processedThroughSequenceNumber: 0,
    seats: {
      hero: {
        seatId: 'hero',
        position: 'BTN',
        source: 'hero-private',
        active: true,
        rangeWidth: 0.3,
        weights: { premium: 0.12, strong: 0.24, medium: 0.24, draw: 0.2, weak: 0.2 },
        initiative: true,
        actionsObserved: 2,
        lastAggressiveStreet,
        knownHandClass: 'KQs',
      },
      villain: {
        seatId: 'villain',
        position: 'BB',
        source: 'public-inference',
        active: true,
        rangeWidth: 0.5,
        weights: { premium: 0.08, strong: 0.18, medium: 0.26, draw: 0.24, weak: 0.24 },
        initiative: false,
        actionsObserved: 2,
      },
    },
  }
  return { rangeState }
}

function sixMaxSeats(heroPosition: PositionLabel): PrivateSeatView['seats'] {
  return [
    seat('sb', 'SB'),
    seat('bb', 'BB'),
    seat('utg', 'UTG'),
    seat('hj', 'HJ'),
    seat('co', 'CO'),
    seat('hero', heroPosition, true),
  ]
}

function headsUpSeats(): PrivateSeatView['seats'] {
  return [seat('hero', 'BTN/SB', true), seat('villain', 'BB')]
}

function seat(id: string, position: PositionLabel, isDealer = false): PrivateSeatView['seats'][number] {
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
    isSmallBlind: position === 'SB' || position === 'BTN/SB',
    isBigBlind: position === 'BB',
  }
}

function requireProfile(id: string): NpcStrategyProfile {
  const profile = LOCAL_NPC_STRATEGY_PROFILES.find((candidate) => candidate.id === id)
  if (!profile) throw new Error(`Missing profile fixture: ${id}`)
  return structuredClone(profile)
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
}

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit }
}
