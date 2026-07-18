import { describe, expect, it } from 'vitest'
import { BasicNpcPolicy, createNpcDecisionContext } from '../../src/npc/basicNpc'
import { traceContainsRestrictedState } from '../../src/npc/npcDecisionTrace'
import { createPostflopStrategy } from '../../src/npc/postflopStrategy'
import { updateNpcRangeMemory } from '../../src/npc/rangeTracking'
import { createRng } from '../../src/shared/rng'
import {
  applyAction,
  createGame,
  getSeatView,
  startNextHand,
  type Card,
  type GameState,
  type Rank,
  type Suit,
} from '../../src/poker-engine'

function c(rank: Rank, suit: Suit): Card {
  return { rank, suit }
}

function mustStart(fixedDeck: Card[]): GameState {
  const started = startNextHand(createGame({ fixedDeck }))
  expect(started.ok).toBe(true)
  if (!started.ok) {
    throw new Error(started.error.message)
  }
  return started.state
}

function mustApply(state: GameState, command: Parameters<typeof applyAction>[1]): GameState {
  const result = applyAction(state, command)
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.state
}

describe('basic NPC policy', () => {
  it('chooses only a legal shared engine command from its seat projection', () => {
    const started = startNextHand(createGame({ seed: 'npc-legal' }))
    expect(started.ok).toBe(true)
    if (!started.ok) {
      throw new Error(started.error.message)
    }

    const afterHumanCall = applyAction(started.state, { type: 'call', seatId: 'human', source: 'human' })
    expect(afterHumanCall.ok).toBe(true)
    if (!afterHumanCall.ok) {
      throw new Error(afterHumanCall.error.message)
    }

    const view = getSeatView(afterHumanCall.state, 'npc-1')
    const context = createNpcDecisionContext(view, createRng('npc-test'))
    const decision = new BasicNpcPolicy().chooseDecision(context)
    const result = applyAction(afterHumanCall.state, decision.command)

    expect(result.ok).toBe(true)
    expect(decision.command.seatId).toBe('npc-1')
    expect(decision.trace).toEqual(expect.objectContaining({
      schemaVersion: 'npc-decision-trace-v1',
      seatId: 'npc-1',
      selectedAction: decision.command.type,
      decisionSource: 'legacy-fallback',
    }))
    expect(traceContainsRestrictedState(decision.trace)).toBe(false)
    expect(JSON.stringify(view)).not.toContain('deck')
    expect(JSON.stringify(view)).not.toContain('rngState')
  })

  it('raises preflop value hands after the small blind completes', () => {
    let state = mustStart([
      c('2', 'clubs'),
      c('A', 'spades'),
      c('7', 'diamonds'),
      c('A', 'hearts'),
      c('3', 'clubs'),
      c('4', 'diamonds'),
      c('5', 'hearts'),
      c('8', 'spades'),
      c('9', 'clubs'),
    ])
    state = mustApply(state, { type: 'call', seatId: 'human', source: 'human' })

    const view = getSeatView(state, 'npc-1')
    const command = new BasicNpcPolicy().chooseAction(createNpcDecisionContext(view, createRng('premium-aa')))

    expect(command).toEqual({ type: 'bet', seatId: 'npc-1', amount: 6, source: 'npc' })
  })

  it('folds weak preflop hands to a meaningful raise', () => {
    let state = mustStart([
      c('A', 'clubs'),
      c('7', 'spades'),
      c('K', 'diamonds'),
      c('2', 'hearts'),
      c('3', 'clubs'),
      c('4', 'diamonds'),
      c('5', 'hearts'),
      c('8', 'spades'),
      c('9', 'clubs'),
    ])
    state = mustApply(state, { type: 'raise', seatId: 'human', amount: 12, source: 'human' })

    const view = getSeatView(state, 'npc-1')
    const command = new BasicNpcPolicy().chooseAction(createNpcDecisionContext(view, createRng('trash-fold')))

    expect(command).toEqual({ type: 'fold', seatId: 'npc-1', source: 'npc' })
  })

  it('continues cheaply with playable suited preflop hands', () => {
    let state = mustStart([
      c('A', 'clubs'),
      c('T', 'hearts'),
      c('K', 'diamonds'),
      c('9', 'hearts'),
      c('3', 'clubs'),
      c('4', 'diamonds'),
      c('5', 'hearts'),
      c('8', 'spades'),
      c('9', 'clubs'),
    ])
    state = mustApply(state, { type: 'raise', seatId: 'human', amount: 4, source: 'human' })

    const view = getSeatView(state, 'npc-1')
    const command = new BasicNpcPolicy().chooseAction(createNpcDecisionContext(view, createRng('suited-connector')))

    expect(command).toEqual({ type: 'call', seatId: 'npc-1', source: 'npc' })
  })

  it('keeps NPC random streams independent through explicit decision contexts', () => {
    let state = mustStart([
      c('2', 'clubs'),
      c('K', 'spades'),
      c('7', 'diamonds'),
      c('Q', 'spades'),
      c('3', 'clubs'),
      c('4', 'diamonds'),
      c('5', 'hearts'),
      c('8', 'spades'),
      c('9', 'clubs'),
    ])
    state = mustApply(state, { type: 'call', seatId: 'human', source: 'human' })

    const view = getSeatView(state, 'npc-1')
    const policy = new BasicNpcPolicy()
    const rngA = createRng('npc-a')
    const rngB = createRng('npc-b')
    const controlB = createRng('npc-b')

    policy.chooseAction(createNpcDecisionContext(view, rngA))
    policy.chooseAction(createNpcDecisionContext(view, rngA))

    const commandAfterAAdvanced = policy.chooseAction(createNpcDecisionContext(view, rngB))
    const commandFromFreshB = policy.chooseAction(createNpcDecisionContext(view, controlB))

    expect(commandAfterAAdvanced).toEqual(commandFromFreshB)
  })

  it('bets strong postflop made hands for value', () => {
    let state = advanceToNpcFlopAction([
      c('K', 'clubs'),
      c('A', 'spades'),
      c('7', 'diamonds'),
      c('Q', 'spades'),
      c('A', 'diamonds'),
      c('Q', 'clubs'),
      c('4', 'hearts'),
      c('8', 'spades'),
      c('9', 'clubs'),
    ])

    const view = getSeatView(state, 'npc-1')
    const command = new BasicNpcPolicy().chooseAction(createNpcDecisionContext(view, createRng('postflop-value')))

    expect(command).toEqual({ type: 'bet', seatId: 'npc-1', amount: 3, source: 'npc' })
  })

  it('checks weak postflop hands with no draw when checking is free', () => {
    const state = advanceToNpcFlopAction([
      c('A', 'clubs'),
      c('9', 'spades'),
      c('K', 'diamonds'),
      c('2', 'hearts'),
      c('Q', 'clubs'),
      c('7', 'diamonds'),
      c('4', 'spades'),
      c('8', 'hearts'),
      c('J', 'clubs'),
    ])

    const view = getSeatView(state, 'npc-1')
    const command = new BasicNpcPolicy().chooseAction(createNpcDecisionContext(view, createRng('postflop-air')))

    expect(command).toEqual({ type: 'check', seatId: 'npc-1', source: 'npc' })
  })

  it('uses a configured proactive profile to continuation-bet weak range holdings', () => {
    let state = mustStart([
      c('Q', 'clubs'),
      c('7', 'spades'),
      c('J', 'hearts'),
      c('2', 'hearts'),
      c('A', 'clubs'),
      c('K', 'diamonds'),
      c('4', 'spades'),
      c('8', 'hearts'),
      c('9', 'clubs'),
    ])
    state = mustApply(state, { type: 'call', seatId: 'human', source: 'human' })
    state = mustApply(state, { type: 'bet', seatId: 'npc-1', amount: 6, source: 'npc' })
    state = mustApply(state, { type: 'call', seatId: 'human', source: 'human' })
    const view = getSeatView(state, 'npc-1')
    const memory = updateNpcRangeMemory({}, view)
    const strategy = createPostflopStrategy({
      id: 'integration-cbet',
      aggression: 0.5,
      frequencies: { cBetFlop: 1, pureBluff: 0 },
      sizing: { dryFlopPotFraction: 0.45 },
    })
    const decision = new BasicNpcPolicy().chooseDecision(
      createNpcDecisionContext(view, createRng('configured-cbet'), {}, memory, undefined, strategy),
    )

    expect(decision.command).toEqual({ type: 'bet', seatId: 'npc-1', amount: 5, source: 'npc' })
    expect(decision.trace).toEqual(expect.objectContaining({
      decisionSource: 'proactive-postflop',
      situationId: 'continuationBet',
      reasonCode: 'continuationBet',
    }))
  })

  it('records the check portion of an explicit c-bet frequency without falling back', () => {
    let state = mustStart([
      c('Q', 'clubs'),
      c('7', 'spades'),
      c('J', 'hearts'),
      c('2', 'hearts'),
      c('A', 'clubs'),
      c('K', 'diamonds'),
      c('4', 'spades'),
      c('8', 'hearts'),
      c('9', 'clubs'),
    ])
    state = mustApply(state, { type: 'call', seatId: 'human', source: 'human' })
    state = mustApply(state, { type: 'bet', seatId: 'npc-1', amount: 6, source: 'npc' })
    state = mustApply(state, { type: 'call', seatId: 'human', source: 'human' })
    const view = getSeatView(state, 'npc-1')
    const memory = updateNpcRangeMemory({}, view)
    const strategy = createPostflopStrategy({
      id: 'integration-check-cbet',
      aggression: 0,
      frequencies: { cBetFlop: 0, pureBluff: 0 },
    })
    const decision = new BasicNpcPolicy().chooseDecision(createNpcDecisionContext(
      view,
      { next: () => 0.99, state: () => 99 },
      {},
      memory,
      undefined,
      strategy,
    ))

    expect(decision.command).toEqual({ type: 'check', seatId: 'npc-1', source: 'npc' })
    expect(decision.trace).toEqual(expect.objectContaining({
      decisionSource: 'proactive-postflop',
      situationId: 'continuationBet',
      reasonCode: 'continuationBet-declined',
    }))
    expect(decision.trace.probability).toBe(0)
    expect(decision.trace.rngRoll).toBeUndefined()
  })

  it('turns configured sizing into different legal amounts through the live policy path', () => {
    let state = mustStart([
      c('Q', 'clubs'),
      c('7', 'spades'),
      c('J', 'hearts'),
      c('2', 'hearts'),
      c('A', 'clubs'),
      c('K', 'diamonds'),
      c('4', 'spades'),
      c('8', 'hearts'),
      c('9', 'clubs'),
    ])
    state = mustApply(state, { type: 'call', seatId: 'human', source: 'human' })
    state = mustApply(state, { type: 'bet', seatId: 'npc-1', amount: 6, source: 'npc' })
    state = mustApply(state, { type: 'call', seatId: 'human', source: 'human' })
    const view = getSeatView(state, 'npc-1')
    const memory = updateNpcRangeMemory({}, view)
    const policy = new BasicNpcPolicy()
    const strategy = (potFraction: number) => createPostflopStrategy({
      id: `integration-size-${potFraction}`,
      aggression: 0.5,
      frequencies: { cBetFlop: 1, pureBluff: 0 },
      sizing: { dryFlopPotFraction: potFraction },
    })
    const small = policy.chooseDecision(createNpcDecisionContext(
      view, { next: () => 0, state: () => 0 }, {}, memory, undefined, strategy(0.35),
    ))
    const large = policy.chooseDecision(createNpcDecisionContext(
      view, { next: () => 0, state: () => 0 }, {}, memory, undefined, strategy(0.8),
    ))

    expect(small.command.type).toBe('bet')
    expect(large.command.type).toBe('bet')
    expect('amount' in small.command && 'amount' in large.command && large.command.amount > small.command.amount).toBe(true)
    expect(small.trace.configuredValues).toEqual(expect.objectContaining({ baseFrequency: 1 }))
    expect(large.trace.calculatedValues).toEqual(expect.objectContaining({ potFraction: 0.8 }))
  })

  it('continues postflop with a strong draw at a fair price', () => {
    let state = advanceToNpcFlopAction([
      c('A', 'clubs'),
      c('A', 'hearts'),
      c('K', 'diamonds'),
      c('J', 'hearts'),
      c('2', 'hearts'),
      c('9', 'hearts'),
      c('4', 'spades'),
      c('8', 'diamonds'),
      c('Q', 'clubs'),
    ])
    state = mustApply(state, { type: 'check', seatId: 'npc-1', source: 'npc' })
    state = mustApply(state, { type: 'bet', seatId: 'human', amount: 4, source: 'human' })

    const view = getSeatView(state, 'npc-1')
    const command = new BasicNpcPolicy().chooseAction(createNpcDecisionContext(view, createRng('postflop-draw')))

    expect(command).toEqual({ type: 'call', seatId: 'npc-1', source: 'npc' })
  })

  it('folds weak postflop hands to oversized pressure', () => {
    let state = advanceToNpcFlopAction([
      c('A', 'clubs'),
      c('9', 'spades'),
      c('K', 'diamonds'),
      c('2', 'hearts'),
      c('Q', 'clubs'),
      c('7', 'diamonds'),
      c('4', 'spades'),
      c('8', 'hearts'),
      c('J', 'clubs'),
    ])
    state = mustApply(state, { type: 'check', seatId: 'npc-1', source: 'npc' })
    state = mustApply(state, { type: 'bet', seatId: 'human', amount: 24, source: 'human' })

    const view = getSeatView(state, 'npc-1')
    const command = new BasicNpcPolicy().chooseAction(createNpcDecisionContext(view, createRng('postflop-fold')))

    expect(command).toEqual({ type: 'fold', seatId: 'npc-1', source: 'npc' })
  })

  it('routes configured postflop defense through the MDF module during a real hand', () => {
    let state = advanceToNpcFlopAction([
      c('A', 'clubs'),
      c('9', 'spades'),
      c('K', 'diamonds'),
      c('2', 'hearts'),
      c('Q', 'clubs'),
      c('7', 'diamonds'),
      c('4', 'spades'),
      c('8', 'hearts'),
      c('J', 'clubs'),
    ])
    state = mustApply(state, { type: 'check', seatId: 'npc-1', source: 'npc' })
    state = mustApply(state, { type: 'bet', seatId: 'human', amount: 24, source: 'human' })

    const view = getSeatView(state, 'npc-1')
    const memory = updateNpcRangeMemory({}, view)
    const strategy = createPostflopStrategy({
      id: 'sticky-integration-defense',
      aggression: 0,
      frequencies: { checkRaise: 0, valueRaise: 0 },
      defense: { mdfAdherence: 1, foldBias: -0.5 },
    })
    const command = new BasicNpcPolicy().chooseAction(createNpcDecisionContext(
      view,
      { next: () => 0.01, state: () => 1 },
      {},
      memory,
      undefined,
      strategy,
    ))

    expect(command).toEqual({ type: 'call', seatId: 'npc-1', source: 'npc' })
  })
})

function advanceToNpcFlopAction(fixedDeck: Card[]): GameState {
  let state = mustStart(fixedDeck)
  state = mustApply(state, { type: 'call', seatId: 'human', source: 'human' })
  return mustApply(state, { type: 'check', seatId: 'npc-1', source: 'npc' })
}
