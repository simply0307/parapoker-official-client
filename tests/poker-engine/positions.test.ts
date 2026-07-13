import { describe, expect, it } from 'vitest'
import {
  assignSeatPositions,
  createGame,
  getPublicView,
  getSeatView,
  startNextHand,
  type GameState,
  type PositionLabel,
} from '../../src/poker-engine'

const seatIds = ['human', 'npc-1', 'npc-2', 'npc-3', 'npc-4', 'npc-5']

function seats(count: number) {
  return seatIds.slice(0, count).map((id, index) => ({
    id,
    name: index === 0 ? 'You' : `NPC ${index}`,
    kind: index === 0 ? 'human' as const : 'npc' as const,
    stack: 200,
    status: 'active' as const,
  }))
}

function gameWithSeats(count: number): GameState {
  const result = startNextHand(createGame({
    seats: seats(count).map(({ id, name, kind }) => ({ id, name, kind })),
  }))
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.state
}

describe('seat position helpers', () => {
  it.each([
    [2, ['BTN/SB', 'BB']],
    [3, ['BTN', 'SB', 'BB']],
    [4, ['BTN', 'SB', 'BB', 'UTG']],
    [5, ['BTN', 'SB', 'BB', 'UTG', 'CO']],
    [6, ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']],
  ] satisfies Array<[number, PositionLabel[]]>)(
    'assigns conventional positions for %i funded seats',
    (count, expectedPositions) => {
      const assignments = assignSeatPositions(seats(count), 'human')

      expect(assignments.map((assignment) => assignment.position)).toEqual(expectedPositions)
      expect(assignments.map((assignment) => assignment.seatId)).toEqual(seatIds.slice(0, count))
    },
  )

  it('exposes shared position labels through public and private projections', () => {
    const state = gameWithSeats(6)
    const publicView = getPublicView(state)
    const privateView = getSeatView(state, 'human')

    expect(publicView.seats.map((seat) => [seat.id, seat.position])).toEqual([
      ['human', 'BTN'],
      ['npc-1', 'SB'],
      ['npc-2', 'BB'],
      ['npc-3', 'UTG'],
      ['npc-4', 'HJ'],
      ['npc-5', 'CO'],
    ])
    expect(privateView.seats.map((seat) => [seat.id, seat.position])).toEqual(
      publicView.seats.map((seat) => [seat.id, seat.position]),
    )
  })

  it('recalculates positions from funded seats instead of permanent seat ids', () => {
    const activeSeats = seats(6)
    activeSeats[2] = { ...activeSeats[2], stack: 0, status: 'out' }

    const assignments = assignSeatPositions(activeSeats, 'human')

    expect(assignments.map((assignment) => [assignment.seatId, assignment.position])).toEqual([
      ['human', 'BTN'],
      ['npc-1', 'SB'],
      ['npc-3', 'BB'],
      ['npc-4', 'UTG'],
      ['npc-5', 'CO'],
    ])
    expect(assignments.some((assignment) => assignment.seatId === 'npc-2')).toBe(false)
  })
})
