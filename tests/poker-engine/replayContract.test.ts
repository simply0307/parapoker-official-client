import { describe, expect, it } from 'vitest'
import {
  applyAction,
  createGame,
  replayHandFromConfig,
  startNextHand,
  type Card,
  type EngineCommand,
  type GameState,
  type MatchConfig,
  type Rank,
  type Suit,
} from '../../src/poker-engine'

function c(rank: Rank, suit: Suit): Card {
  return { rank, suit }
}

const showdownDeck = [
  c('A', 'hearts'),
  c('K', 'hearts'),
  c('A', 'spades'),
  c('K', 'spades'),
  c('2', 'clubs'),
  c('3', 'diamonds'),
  c('4', 'hearts'),
  c('8', 'spades'),
  c('9', 'clubs'),
]

const showdownCommands: EngineCommand[] = [
  { type: 'call', seatId: 'human', source: 'human' },
  { type: 'check', seatId: 'npc-1', source: 'npc' },
  { type: 'check', seatId: 'npc-1', source: 'npc' },
  { type: 'check', seatId: 'human', source: 'human' },
  { type: 'check', seatId: 'npc-1', source: 'npc' },
  { type: 'check', seatId: 'human', source: 'human' },
  { type: 'check', seatId: 'npc-1', source: 'npc' },
  { type: 'check', seatId: 'human', source: 'human' },
]

function mustStart(state: GameState): GameState {
  const result = startNextHand(state)
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.state
}

function mustApply(state: GameState, command: EngineCommand): GameState {
  const result = applyAction(state, command)
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.state
}

describe('replay contract', () => {
  it('reconstructs final state and event sequence from fixed deck config and command stream', () => {
    const config: Partial<MatchConfig> = { fixedDeck: showdownDeck }
    const replay = replayHandFromConfig(config, showdownCommands)

    let manual = mustStart(createGame(config))
    for (const command of showdownCommands) {
      manual = mustApply(manual, command)
    }

    expect(replay.ok).toBe(true)
    if (!replay.ok) {
      throw new Error(replay.error.message)
    }
    expect(replay.state).toEqual(manual)
    expect(replay.events).toEqual(manual.hand?.history)
    expect(replay.state.hand?.result?.winners[0].seatId).toBe('human')
  })

  it('reconstructs deterministically from seed and command stream without a fixed deck', () => {
    const config: Partial<MatchConfig> = { seed: 'replay-seed' }
    const commands: EngineCommand[] = [{ type: 'fold', seatId: 'human', source: 'human' }]

    const first = replayHandFromConfig(config, commands)
    const second = replayHandFromConfig(config, commands)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) {
      throw new Error('Replay unexpectedly failed')
    }
    expect(first.state).toEqual(second.state)
    expect(first.events).toEqual(second.events)
  })

  it('preserves input config, fixed deck, and command stream objects', () => {
    const config: Partial<MatchConfig> = { fixedDeck: showdownDeck }
    const commands = showdownCommands.map((command) => ({ ...command }))
    const beforeConfig = JSON.stringify(config)
    const beforeCommands = JSON.stringify(commands)

    const replay = replayHandFromConfig(config, commands)

    expect(replay.ok).toBe(true)
    expect(JSON.stringify(config)).toBe(beforeConfig)
    expect(JSON.stringify(commands)).toBe(beforeCommands)
  })

  it('returns structured errors for invalid replay commands with the last valid state', () => {
    const replay = replayHandFromConfig({ seed: 'invalid-replay' }, [
      { type: 'check', seatId: 'npc-1', source: 'npc' },
    ])

    expect(replay.ok).toBe(false)
    if (!replay.ok) {
      expect(replay.error.reason).toBe('NOT_PENDING_ACTOR')
      expect(replay.state.status).toBe('handInProgress')
      expect(replay.state.hand?.history.map((event) => event.type)).toEqual([
        'handStarted',
        'blindPosted',
        'blindPosted',
        'holeCardsDealt',
        'holeCardsDealt',
      ])
    }
  })
})
