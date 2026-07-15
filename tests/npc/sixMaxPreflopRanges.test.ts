import { describe, expect, it } from 'vitest'
import {
  analyzePreflopSpot,
  choosePreflopRangeDecision,
  createSixMaxPreflopStrategy,
  validatePreflopStrategy,
} from '../../src/npc/preflopRanges'
import {
  applyAction,
  createGame,
  freshDeck,
  getSeatView,
  startNextHand,
  type Card,
  type EngineCommand,
  type GameState,
  type SeatId,
} from '../../src/poker-engine'
import type { Rng } from '../../src/shared/rng'

const SIX_MAX_SEATS = [
  { id: 'human', name: 'Hero', kind: 'human' as const },
  { id: 'npc-1', name: 'Small Blind', kind: 'npc' as const },
  { id: 'npc-2', name: 'Big Blind', kind: 'npc' as const },
  { id: 'npc-3', name: 'Under the Gun', kind: 'npc' as const },
  { id: 'npc-4', name: 'Hijack', kind: 'npc' as const },
  { id: 'npc-5', name: 'Cutoff', kind: 'npc' as const },
]

const DEAL_ORDER: SeatId[] = ['npc-1', 'npc-2', 'npc-3', 'npc-4', 'npc-5', 'human']

describe('six-max NPC preflop ranges', () => {
  it('builds position-specific 169-class nodes for every stack-depth bucket', () => {
    const strategy = createSixMaxPreflopStrategy({
      id: 'six-max-structure',
      looseness: 0.5,
      aggression: 0.5,
    })

    expect(strategy.nodes.length).toBeGreaterThanOrEqual(40)
    expect(new Set(strategy.nodes.flatMap((node) => node.formats))).toEqual(new Set(['six-max']))
    expect(strategy.nodes.some((node) => node.id === 'sixmax-utg-unopened-deep')).toBe(true)
    expect(strategy.nodes.some((node) => node.id === 'sixmax-btn-unopened-deep')).toBe(true)
    expect(strategy.nodes.some((node) => node.id === 'sixmax-blinds-squeeze-deep')).toBe(true)
    expect(strategy.nodes.every((node) => Object.keys(node.hands).length === 169)).toBe(true)
  })

  it('rejects unsafe persisted sizing and multiway matching values', () => {
    const strategy = createSixMaxPreflopStrategy({
      id: 'six-max-validation',
      looseness: 0.5,
      aggression: 0.5,
    })
    const invalidSizing = structuredClone(strategy)
    invalidSizing.sizing.squeezeOutOfPositionMultiplier = 0
    const invalidContext = structuredClone(strategy)
    invalidContext.nodes[0].minimumCallers = -1

    expect(() => validatePreflopStrategy(invalidSizing)).toThrow(/sizing/i)
    expect(() => validatePreflopStrategy(invalidContext)).toThrow(/minimum callers/i)
  })

  it('opens premium hands UTG while constructing a wider button range', () => {
    const strategy = createSixMaxPreflopStrategy({ id: 'six-max-position', looseness: 0.5, aggression: 0.6 })
    const premiumState = sixMaxStateWithHand('npc-3', ['As', 'Ah'])
    const premiumView = getSeatView(premiumState, 'npc-3')
    const premium = decide(premiumView, strategy, 0)

    expect(analyzePreflopSpot(premiumView)).toEqual(expect.objectContaining({
      format: 'six-max',
      position: 'UTG',
      situation: 'unopened',
    }))
    expect(premium?.nodeId).toBe('sixmax-utg-unopened-deep')
    expect(premium?.command).toEqual({ type: 'raise', seatId: 'npc-3', amount: 5, source: 'npc' })

    const utgA9 = decide(getSeatView(sixMaxStateWithHand('npc-3', ['As', '9h']), 'npc-3'), strategy, 0.5)
    let buttonState = sixMaxStateWithHand('human', ['As', '9h'])
    buttonState = act(buttonState, { type: 'fold', seatId: 'npc-3', source: 'npc' })
    buttonState = act(buttonState, { type: 'fold', seatId: 'npc-4', source: 'npc' })
    buttonState = act(buttonState, { type: 'fold', seatId: 'npc-5', source: 'npc' })
    const buttonA9 = decide(getSeatView(buttonState, 'human'), strategy, 0.5)

    expect(utgA9?.command.type).toBe('fold')
    expect(buttonA9?.nodeId).toBe('sixmax-btn-unopened-deep')
    expect(buttonA9?.command.type).toBe('raise')
  })

  it('isolates a limper from the hijack with profile-owned sizing', () => {
    const strategy = createSixMaxPreflopStrategy({ id: 'six-max-isolate', looseness: 0.5, aggression: 0.8 })
    let state = sixMaxStateWithHand('npc-4', ['As', 'Ah'])
    state = act(state, { type: 'call', seatId: 'npc-3', source: 'npc' })
    const view = getSeatView(state, 'npc-4')
    const spot = analyzePreflopSpot(view)
    const decision = decide(view, strategy, 0)

    expect(spot).toEqual(expect.objectContaining({
      position: 'HJ',
      situation: 'facingLimp',
      limperCount: 1,
      callerCount: 0,
    }))
    expect(decision?.nodeId).toBe('sixmax-early-vs-limp-deep')
    expect(decision?.command).toEqual({ type: 'raise', seatId: 'npc-4', amount: 6, source: 'npc' })
  })

  it('recognizes a big-blind squeeze separately from an ordinary three-bet', () => {
    const strategy = createSixMaxPreflopStrategy({ id: 'six-max-squeeze', looseness: 0.5, aggression: 0.8 })
    let state = sixMaxStateWithHand('npc-2', ['As', 'Ah'])
    state = act(state, { type: 'fold', seatId: 'npc-3', source: 'npc' })
    state = act(state, { type: 'fold', seatId: 'npc-4', source: 'npc' })
    state = act(state, { type: 'raise', seatId: 'npc-5', amount: 6, source: 'npc' })
    state = act(state, { type: 'call', seatId: 'human', source: 'human' })
    state = act(state, { type: 'call', seatId: 'npc-1', source: 'npc' })
    const view = getSeatView(state, 'npc-2')
    const spot = analyzePreflopSpot(view)
    const decision = decide(view, strategy, 0)

    expect(spot).toEqual(expect.objectContaining({
      position: 'BB',
      situation: 'facingOpenWithCallers',
      callerCount: 2,
      aggressorPosition: 'CO',
      raiseSizeBucket: 'medium',
    }))
    expect(decision?.nodeId).toBe('sixmax-blinds-squeeze-deep')
    expect(decision?.command).toEqual({ type: 'raise', seatId: 'npc-2', amount: 27, source: 'npc' })
  })

  it('identifies a returning opener facing a three-bet and applies four-bet sizing', () => {
    const strategy = createSixMaxPreflopStrategy({ id: 'six-max-four-bet', looseness: 0.5, aggression: 0.8 })
    let state = sixMaxStateWithHand('npc-3', ['As', 'Ah'])
    state = act(state, { type: 'raise', seatId: 'npc-3', amount: 5, source: 'npc' })
    state = act(state, { type: 'raise', seatId: 'npc-4', amount: 15, source: 'npc' })
    state = act(state, { type: 'fold', seatId: 'npc-5', source: 'npc' })
    state = act(state, { type: 'fold', seatId: 'human', source: 'human' })
    state = act(state, { type: 'fold', seatId: 'npc-1', source: 'npc' })
    state = act(state, { type: 'fold', seatId: 'npc-2', source: 'npc' })
    const view = getSeatView(state, 'npc-3')
    const spot = analyzePreflopSpot(view)
    const decision = decide(view, strategy, 0)

    expect(spot).toEqual(expect.objectContaining({
      position: 'UTG',
      situation: 'facingThreeBet',
      aggressorPosition: 'HJ',
    }))
    expect(decision?.nodeId).toBe('sixmax-vs-three-bet-deep')
    expect(decision?.command).toEqual({ type: 'raise', seatId: 'npc-3', amount: 35, source: 'npc' })
  })
})

function decide(
  view: ReturnType<typeof getSeatView>,
  strategy: ReturnType<typeof createSixMaxPreflopStrategy>,
  roll: number,
) {
  return choosePreflopRangeDecision({ view, legalActions: view.legalActions, strategy, rng: fixedRng(roll) })
}

function sixMaxStateWithHand(seatId: SeatId, cards: [string, string]): GameState {
  const holeCards = cards.map(parseCard) as [Card, Card]
  const remaining = freshDeck().filter((card) => !holeCards.some((selected) => sameCard(card, selected)))
  const deal = Array<Card | undefined>(12)
  const seatIndex = DEAL_ORDER.indexOf(seatId)
  deal[seatIndex] = holeCards[0]
  deal[seatIndex + DEAL_ORDER.length] = holeCards[1]
  for (let index = 0; index < deal.length; index += 1) {
    deal[index] ??= remaining.shift()
  }
  const result = startNextHand(createGame({
    seats: SIX_MAX_SEATS,
    fixedDeck: [...deal as Card[], ...remaining],
  }))
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.state
}

function act(state: GameState, command: EngineCommand): GameState {
  const result = applyAction(state, command)
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.state
}

function fixedRng(value: number): Rng {
  return { next: () => value, state: () => Math.round(value * 1_000_000) }
}

function parseCard(value: string): Card {
  const rank = value[0] as Card['rank']
  const suit = ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const)[value[1] as 'c' | 'd' | 'h' | 's']
  return { rank, suit }
}

function sameCard(left: Card, right: Card): boolean {
  return left.rank === right.rank && left.suit === right.suit
}
