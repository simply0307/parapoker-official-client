import { describe, expect, it } from 'vitest'
import {
  allPreflopHandClasses,
  analyzePreflopSpot,
  choosePreflopRangeDecision,
  createHeadsUpPreflopStrategy,
  toPreflopHandClass,
} from '../../src/npc/preflopRanges'
import {
  applyAction,
  createGame,
  getSeatView,
  startNextHand,
  type Card,
  type EngineCommand,
  type GameState,
  type Rank,
  type Suit,
} from '../../src/poker-engine'
import type { Rng } from '../../src/shared/rng'

describe('NPC preflop range foundation', () => {
  it('covers all 169 canonical starting-hand classes', () => {
    const classes = allPreflopHandClasses()

    expect(classes).toHaveLength(169)
    expect(new Set(classes)).toHaveLength(169)
    expect(classes).toEqual(expect.arrayContaining(['AA', 'AKs', 'AKo', '72o']))
    expect(toPreflopHandClass([c('A', 'spades'), c('K', 'spades')])).toBe('AKs')
    expect(toPreflopHandClass([c('K', 'diamonds'), c('A', 'clubs')])).toBe('AKo')
  })

  it('creates serializable versioned nodes whose hand frequencies normalize to one', () => {
    const strategy = createHeadsUpPreflopStrategy({
      id: 'test-balanced-hu',
      version: 3,
      looseness: 0.5,
      aggression: 0.5,
    })

    expect(strategy).toEqual(expect.objectContaining({
      schemaVersion: 'npc-preflop-v1',
      id: 'test-balanced-hu',
      version: 3,
    }))
    expect(strategy.nodes.length).toBeGreaterThanOrEqual(6)
    for (const node of strategy.nodes) {
      expect(Object.keys(node.hands)).toHaveLength(169)
      for (const frequencies of Object.values(node.hands)) {
        expect(frequencies.reduce((total, action) => total + action.frequency, 0)).toBeCloseTo(1, 8)
      }
    }
    expect(() => JSON.stringify(strategy)).not.toThrow()
  })

  it('recognizes heads-up blind situations and never folds when the big blind can check', () => {
    const view = npcViewAfter({ type: 'call', seatId: 'human', source: 'human' }, [
      c('A', 'clubs'), c('7', 'spades'), c('K', 'diamonds'), c('2', 'hearts'),
    ])
    const strategy = createHeadsUpPreflopStrategy({ id: 'hu-check-option', looseness: 0.2, aggression: 0.2 })
    const spot = analyzePreflopSpot(view)
    const decision = choosePreflopRangeDecision({ view, legalActions: view.legalActions, strategy, rng: fixedRng(0.99) })

    expect(spot).toEqual(expect.objectContaining({
      format: 'heads-up',
      position: 'BB',
      situation: 'facingLimp',
      stackDepth: 'deep',
    }))
    expect(decision?.nodeId).toBe('hu-bb-vs-limp-deep')
    expect(decision?.handClass).toBe('72o')
    expect(decision?.command).toEqual({ type: 'check', seatId: 'npc-1', source: 'npc' })
  })

  it('raises premium hands over a heads-up limp using the profile sizing plan', () => {
    const view = npcViewAfter({ type: 'call', seatId: 'human', source: 'human' }, [
      c('2', 'clubs'), c('A', 'spades'), c('7', 'diamonds'), c('A', 'hearts'),
    ])
    const strategy = createHeadsUpPreflopStrategy({ id: 'hu-value-raise', looseness: 0.5, aggression: 0.7 })
    const decision = choosePreflopRangeDecision({ view, legalActions: view.legalActions, strategy, rng: fixedRng(0) })

    expect(decision?.command).toEqual({ type: 'bet', seatId: 'npc-1', amount: 6, source: 'npc' })
  })

  it('lets configured looseness change big-blind defense against a small open', () => {
    const view = npcViewAfter({ type: 'raise', seatId: 'human', amount: 4, source: 'human' }, [
      c('A', 'clubs'), c('7', 'spades'), c('K', 'diamonds'), c('2', 'hearts'),
    ])
    const tight = createHeadsUpPreflopStrategy({ id: 'hu-tight', looseness: 0, aggression: 0.3 })
    const loose = createHeadsUpPreflopStrategy({ id: 'hu-loose', looseness: 1, aggression: 0.3 })
    const tightDecision = choosePreflopRangeDecision({ view, legalActions: view.legalActions, strategy: tight, rng: fixedRng(0.4) })
    const looseDecision = choosePreflopRangeDecision({ view, legalActions: view.legalActions, strategy: loose, rng: fixedRng(0.4) })

    expect(analyzePreflopSpot(view).raiseSizeBucket).toBe('small')
    expect(tightDecision?.command.type).toBe('fold')
    expect(looseDecision?.command.type).toBe('call')
  })

  it('replays mixed preflop frequencies deterministically from the policy RNG', () => {
    const view = npcViewAfter({ type: 'raise', seatId: 'human', amount: 4, source: 'human' }, [
      c('A', 'clubs'), c('9', 'spades'), c('K', 'diamonds'), c('7', 'hearts'),
    ])
    const strategy = createHeadsUpPreflopStrategy({ id: 'hu-repeatable', looseness: 0.6, aggression: 0.6 })
    const first = choosePreflopRangeDecision({ view, legalActions: view.legalActions, strategy, rng: fixedRng(0.37) })
    const replay = choosePreflopRangeDecision({ view, legalActions: view.legalActions, strategy, rng: fixedRng(0.37) })

    expect(first).toEqual(replay)
  })
})

function npcViewAfter(command: EngineCommand, holeCards: Card[]) {
  const fixedDeck = [
    holeCards[0],
    holeCards[1],
    holeCards[2],
    holeCards[3],
    c('3', 'clubs'),
    c('4', 'diamonds'),
    c('5', 'hearts'),
    c('8', 'spades'),
    c('9', 'clubs'),
  ]
  let state = mustStart(fixedDeck)
  state = mustApply(state, command)
  return getSeatView(state, 'npc-1')
}

function mustStart(fixedDeck: Card[]): GameState {
  const result = startNextHand(createGame({ fixedDeck }))
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.state
}

function mustApply(state: GameState, command: EngineCommand): GameState {
  const result = applyAction(state, command)
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.state
}

function fixedRng(value: number): Rng {
  return {
    next: () => value,
    state: () => Math.round(value * 1_000_000),
  }
}

function c(rank: Rank, suit: Suit): Card {
  return { rank, suit }
}
