import { describe, expect, it } from 'vitest'
import { BasicNpcPolicy, createNpcDecisionContext } from '../../src/npc/basicNpc'
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
    const command = new BasicNpcPolicy().chooseAction(context)
    const result = applyAction(afterHumanCall.state, command)

    expect(result.ok).toBe(true)
    expect(command.seatId).toBe('npc-1')
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
})
