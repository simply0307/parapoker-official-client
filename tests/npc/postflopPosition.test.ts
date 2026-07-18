import { describe, expect, it } from 'vitest'
import { isPostflopInPosition } from '../../src/npc/postflopPosition'
import type { PlayerStatus, PositionLabel, PrivateSeatView } from '../../src/poker-engine'

describe('shared NPC postflop position', () => {
  it('keeps the cutoff out of position while the button remains active', () => {
    expect(isPostflopInPosition(tableView('co'))).toBe(false)
  })

  it('makes the cutoff in position after every later actor folds', () => {
    expect(isPostflopInPosition(tableView('co', { btn: 'folded' }))).toBe(true)
  })

  it('recognizes the active button as in position', () => {
    expect(isPostflopInPosition(tableView('btn'))).toBe(true)
  })

  it('keeps the heads-up button and small blind in position postflop', () => {
    expect(isPostflopInPosition(headsUpView())).toBe(true)
  })
})

function tableView(
  heroSeatId: string,
  statuses: Partial<Record<string, PlayerStatus>> = {},
): PrivateSeatView {
  return view(heroSeatId, [
    seat('sb', 'SB', false, statuses.sb),
    seat('bb', 'BB', false, statuses.bb),
    seat('utg', 'UTG', false, statuses.utg),
    seat('hj', 'HJ', false, statuses.hj),
    seat('co', 'CO', false, statuses.co),
    seat('btn', 'BTN', true, statuses.btn),
  ])
}

function headsUpView(): PrivateSeatView {
  return view('button', [
    seat('button', 'BTN/SB', true),
    seat('big-blind', 'BB', false),
  ])
}

function view(heroSeatId: string, seats: PrivateSeatView['seats']): PrivateSeatView {
  return {
    status: 'handInProgress',
    handNumber: 1,
    street: 'flop',
    communityCards: [],
    pot: 12,
    currentBet: 0,
    minRaise: 2,
    pendingSeatId: heroSeatId,
    seats,
    events: [],
    heroSeatId,
    holeCards: [],
    legalActions: [],
  }
}

function seat(
  id: string,
  position: PositionLabel,
  isDealer: boolean,
  status: PlayerStatus = 'active',
): PrivateSeatView['seats'][number] {
  return {
    id,
    name: id,
    kind: 'npc',
    position,
    stack: status === 'out' ? 0 : 100,
    status,
    streetContribution: 0,
    totalContribution: 0,
    isDealer,
    isSmallBlind: position === 'SB' || position === 'BTN/SB',
    isBigBlind: position === 'BB',
  }
}
