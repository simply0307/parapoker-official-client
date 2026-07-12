import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PokerTable } from '../../src/ui/PokerTable'

describe('PokerTable', () => {
  it('renders a playable table surface', () => {
    render(<PokerTable />)

    expect(screen.getByText("Heads-Up No-Limit Hold'em")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /call/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Poker table')).toBeInTheDocument()
  })

  it('shows scannable heads-up match metrics and action context', () => {
    render(<PokerTable />)

    expect(screen.getByText('Hand')).toBeInTheDocument()
    expect(screen.getByText('Pot')).toBeInTheDocument()
    expect(screen.getByText('To call')).toBeInTheDocument()
    expect(screen.getByText('Stack lead')).toBeInTheDocument()
    expect(screen.getByLabelText('Hero seat')).toBeInTheDocument()
    expect(screen.getByLabelText('Opponent seat')).toBeInTheDocument()
    expect(screen.getByLabelText('Player actions')).toHaveTextContent('Call 1')
  })

  it('lets players tune raises with the slider, wheel, and typed amount', () => {
    render(<PokerTable />)

    const raiseSlider = screen.getByLabelText('Raise amount slider')
    const raiseInput = screen.getByLabelText('Raise amount entry')

    expect(raiseInput).toHaveValue(4)

    fireEvent.wheel(raiseSlider, { deltaY: -100 })
    expect(raiseInput).toHaveValue(5)

    fireEvent.change(raiseInput, { target: { value: '12' } })
    expect(raiseSlider).toHaveValue('12')
    expect(screen.getByRole('button', { name: 'Raise 12' })).toBeInTheDocument()
  })

  it('can start a six-max solo table with one hero and five NPC seats', () => {
    render(<PokerTable />)

    fireEvent.click(screen.getByRole('button', { name: 'Six-max' }))

    expect(screen.getByText("Six-Max No-Limit Hold'em")).toBeInTheDocument()
    expect(screen.getAllByLabelText('Opponent seat')).toHaveLength(5)
    expect(screen.getByText('ParaBot 5')).toBeInTheDocument()
    expect(screen.getByLabelText('Hero seat')).toHaveTextContent('You')
    expect(screen.getByLabelText('Player actions')).toHaveTextContent(/Call|Check|Raise|Bet|Waiting/)
  })
})
