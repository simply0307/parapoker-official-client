import { render, screen } from '@testing-library/react'
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
})
