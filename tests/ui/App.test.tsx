import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../../src/App'

describe('App navigation', () => {
  it('opens the local admin screen from the poker client', async () => {
    render(<App />)

    expect(screen.getByLabelText('ParaPoker lobby')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(screen.getByLabelText('Local match setup')).toBeInTheDocument()

    await openAdmin()

    expect(screen.getByLabelText('Admin overview')).toBeInTheDocument()
    expect(screen.getByText('NPC and Game Configuration')).toBeInTheDocument()
    expect(screen.getByLabelText('NPC definitions')).toBeInTheDocument()
    expect(screen.getByLabelText('Game blueprint builder')).toBeInTheDocument()
  })

  it('edits local admin drafts and updates the generated controller preview', async () => {
    render(<App />)

    await openAdmin()
    fireEvent.change(screen.getByLabelText('npc-maven name'), { target: { value: 'Maven Prime' } })
    fireEvent.click(screen.getByLabelText('Admin game mode'))
    fireEvent.change(screen.getByLabelText('Admin game mode'), { target: { value: 'six-max' } })
    fireEvent.change(screen.getByLabelText('npc-2 NPC assignment'), { target: { value: 'npc-vega' } })

    expect(screen.getByLabelText('Configuration preview')).toHaveTextContent('Maven Prime')
    expect(screen.getByLabelText('Configuration preview')).toHaveTextContent('"mode": "six-max"')
    expect(screen.getByLabelText('Configuration preview')).toHaveTextContent('"npcDefinitionId": "npc-vega"')
  })

  it('saves game blueprints and manages lobby table instances from admin', async () => {
    render(<App />)

    await openAdmin()
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Saved game blueprints')).toHaveTextContent('Local Heads-Up Solo')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open lobby table' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Lobby table drafts')).toHaveTextContent('open')
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
    fireEvent.change(screen.getByLabelText('Lobby table status filter'), { target: { value: 'cancelled' } })

    await waitFor(() => {
      expect(screen.getByLabelText('Lobby table drafts')).toHaveTextContent('cancelled')
    })

    fireEvent.change(screen.getByLabelText('Lobby table status filter'), { target: { value: 'active' } })
    expect(screen.getByLabelText('Lobby table drafts')).not.toHaveTextContent('cancelled')

    fireEvent.change(screen.getByLabelText('Lobby table status filter'), { target: { value: 'cancelled' } })
    expect(screen.getByLabelText('Lobby table drafts')).toHaveTextContent('cancelled')

    fireEvent.change(screen.getByLabelText('Lobby table status filter'), { target: { value: 'closed' } })
    expect(screen.getByLabelText('Lobby table drafts')).toHaveTextContent('No closed lobby tables')
  })

  it('opens random-seed blueprints with a resolved per-table seed', async () => {
    render(<App />)

    await openAdmin()
    expect(screen.getByLabelText('Random seed per table')).toBeChecked()
    expect(screen.getByLabelText('Admin seed')).toBeDisabled()
    expect(screen.getByLabelText('Configuration preview')).toHaveTextContent('"seedPolicy": "random"')

    fireEvent.click(screen.getByRole('button', { name: 'Open lobby table' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Lobby table drafts')).toHaveTextContent('random seed')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Lobby' }))
    const randomTableCard = (await screen.findByText(/random seed/)).closest('article')
    expect(randomTableCard).not.toBeNull()
    fireEvent.click(within(randomTableCard as HTMLElement).getByRole('button', { name: 'Join table' }))

    expect(await screen.findByText(/^Seed table-/)).toBeInTheDocument()
  })

  it('returns from admin to the playable setup screen', async () => {
    render(<App />)

    await openAdmin()
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))

    expect(screen.getByLabelText('Local match setup')).toBeInTheDocument()
    expect(screen.queryByLabelText('Admin overview')).not.toBeInTheDocument()
  })

  it('lists open lobby tables and joins one into the playable local client', async () => {
    render(<App />)

    expect(screen.getByLabelText('ParaPoker lobby')).toBeInTheDocument()
    await openAdmin()
    fireEvent.click(screen.getByRole('button', { name: 'Open lobby table' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Lobby table drafts')).toHaveTextContent('open')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Lobby' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Open lobby tables')).toHaveTextContent('Local Heads-Up Solo')
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Join table' })[0])

    expect(await screen.findByLabelText('Poker table')).toBeInTheDocument()
    expect(screen.getByText(/^Seed table-/)).toBeInTheDocument()
  })

  it('keeps multiple joined lobby tables active in the table layout', async () => {
    render(<App />)

    await openAdmin()
    fireEvent.click(screen.getByRole('button', { name: 'Open lobby table' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open lobby table' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Lobby table drafts')).toHaveTextContent('open')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Lobby' }))
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Join table' }).length).toBeGreaterThanOrEqual(2)
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Join table' })[0])
    expect(await screen.findByLabelText('Poker table')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Lobby' }))
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Join table' }).length).toBeGreaterThanOrEqual(1)
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Join table' })[0])

    await waitFor(() => {
      expect(screen.getByLabelText('Table windows')).toHaveClass('layout-2')
    })
    expect(screen.getAllByLabelText('Poker table')).toHaveLength(2)
    expect(screen.getByLabelText('Table 2 footer')).not.toHaveTextContent('No active session')
  })

  it('keeps a room authority alive while the player visits the lobby', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(screen.getByLabelText('Current player identity')).toHaveTextContent('Playing as'))
    fireEvent.click(screen.getByRole('button', { name: 'Start Match' }))
    expect(await screen.findByLabelText('Poker table')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fold' }))
    expect(await screen.findByRole('button', { name: 'Next hand' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Lobby' }))
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))

    expect(screen.getByLabelText('Poker table')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next hand' })).toBeInTheDocument()
  })
})

async function openAdmin() {
  fireEvent.click(screen.getByRole('button', { name: 'Admin' }))
  await screen.findByLabelText('Admin overview')
}
