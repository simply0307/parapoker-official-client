import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PokerTable } from '../../src/ui/PokerTable'

describe('PokerTable', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts on setup without creating a poker table', () => {
    render(<PokerTable />)

    expect(screen.getByText('Start a Local Solo Match')).toBeInTheDocument()
    expect(screen.getByLabelText('Local match setup')).toBeInTheDocument()
    expect(screen.queryByLabelText('Poker table')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /call/i })).not.toBeInTheDocument()
  })

  it('starts a playable heads-up match after explicit setup submission', async () => {
    render(<PokerTable />)

    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))

    expect(await screen.findByText("Heads-Up No-Limit Hold'em")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /call/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Poker table')).toBeInTheDocument()
    expect(screen.getByText('Seed heads-up-solo')).toBeInTheDocument()
  })

  it('validates setup before creating a match', () => {
    render(<PokerTable />)

    fireEvent.change(screen.getByLabelText('BB'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Big blind must be a positive whole number.')
    expect(screen.queryByLabelText('Poker table')).not.toBeInTheDocument()
  })

  it('trims entered seeds and allows random seeds without an entered value', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<PokerTable />)

    fireEvent.change(screen.getByLabelText('Seed'), { target: { value: '  trimmed-seed  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))

    expect(await screen.findByText('Seed trimmed-seed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Change setup' }))
    fireEvent.change(screen.getByLabelText('Seed'), { target: { value: '' } })
    fireEvent.click(screen.getByText('Random local seed'))
    expect(screen.getByLabelText('Seed')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))

    expect(await screen.findByText(/Seed local-/)).toBeInTheDocument()
  })

  it('lets players tune raises with the slider, wheel, and typed amount after the match starts', async () => {
    render(<PokerTable />)

    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))

    const raiseSlider = await screen.findByLabelText('Raise amount slider')
    const raiseInput = screen.getByLabelText('Raise amount entry')

    expect(raiseInput).toHaveValue(4)

    fireEvent.wheel(raiseSlider, { deltaY: -100 })
    expect(raiseInput).toHaveValue(5)

    fireEvent.change(raiseInput, { target: { value: '12' } })
    expect(raiseSlider).toHaveValue('12')
    expect(screen.getByRole('button', { name: 'Raise 12' })).toBeInTheDocument()
  })

  it('can start a six-max solo table with one hero and five NPC seats', async () => {
    render(<PokerTable />)

    fireEvent.click(screen.getByRole('button', { name: 'Six-max' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))

    expect(await screen.findByText("Six-Max No-Limit Hold'em")).toBeInTheDocument()
    expect(screen.getAllByLabelText('Opponent seat')).toHaveLength(5)
    expect(screen.getByText('ParaBot 5')).toBeInTheDocument()
    expect(screen.getByLabelText('Hero seat')).toHaveTextContent('You')
    expect(screen.getByLabelText('Player actions')).toHaveTextContent(/Call|Check|Raise|Bet|Waiting/)
  })

  it('requires confirmation before abandoning an active match for setup', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<PokerTable />)

    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))
    expect(await screen.findByLabelText('Poker table')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change setup' }))

    expect(confirm).toHaveBeenCalledWith('Abandon this local match and return to setup?')
    expect(screen.getByLabelText('Poker table')).toBeInTheDocument()

    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Change setup' }))

    expect(screen.getByText('Start a Local Solo Match')).toBeInTheDocument()
    expect(screen.queryByLabelText('Poker table')).not.toBeInTheDocument()
  })

  it('shows a match result scene and supports same-seed and random rematches', async () => {
    render(<PokerTable />)

    fireEvent.click(screen.getByText('Random local seed'))
    fireEvent.change(screen.getByLabelText('Stack'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('SB'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('BB'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Seed'), { target: { value: 'instant-result' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))

    expect(await playUntilSessionResult()).toBeInTheDocument()
    expect(screen.getByText('Seed')).toBeInTheDocument()
    const firstSeedLine = screen.getByText(/Seed local-/)
    const firstSeed = firstSeedLine.textContent?.replace('Seed ', '') ?? ''

    fireEvent.click(screen.getByRole('button', { name: 'Rematch same seed' }))
    expect(await screen.findByText(`Seed ${firstSeed}`)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'New random match' }))
    expect(await screen.findByText(/Seed local-/)).toBeInTheDocument()
  })
})

async function playUntilSessionResult(maxHands = 20): Promise<HTMLElement> {
  for (let hand = 0; hand < maxHands; hand += 1) {
    const result = screen.queryByLabelText('Session result')
    if (result) {
      return result
    }

    const nextHand = screen.queryByRole('button', { name: 'Next hand' })
    if (nextHand) {
      fireEvent.click(nextHand)
      await waitFor(() => {
        expect(screen.queryByLabelText('Session result') ?? screen.queryByRole('button', { name: 'Next hand' })).toBeTruthy()
      })
    }
  }

  return screen.findByLabelText('Session result')
}
