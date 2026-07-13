import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../../src/App'

describe('App navigation', () => {
  it('opens the local admin screen from the poker client', () => {
    render(<App />)

    expect(screen.getByLabelText('Local match setup')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Admin' }))

    expect(screen.getByLabelText('Admin overview')).toBeInTheDocument()
    expect(screen.getByText('NPC and Game Configuration')).toBeInTheDocument()
    expect(screen.getByLabelText('NPC definitions')).toBeInTheDocument()
    expect(screen.getByLabelText('Game blueprint builder')).toBeInTheDocument()
  })

  it('edits local admin drafts and updates the generated controller preview', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Admin' }))
    fireEvent.change(screen.getByLabelText('npc-maven name'), { target: { value: 'Maven Prime' } })
    fireEvent.click(screen.getByLabelText('Admin game mode'))
    fireEvent.change(screen.getByLabelText('Admin game mode'), { target: { value: 'six-max' } })
    fireEvent.change(screen.getByLabelText('npc-2 NPC assignment'), { target: { value: 'npc-vega' } })

    expect(screen.getByLabelText('Configuration preview')).toHaveTextContent('Maven Prime')
    expect(screen.getByLabelText('Configuration preview')).toHaveTextContent('"mode": "six-max"')
    expect(screen.getByLabelText('Configuration preview')).toHaveTextContent('"npcDefinitionId": "npc-vega"')
  })

  it('returns from admin to the playable setup screen', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Admin' }))
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))

    expect(screen.getByLabelText('Local match setup')).toBeInTheDocument()
    expect(screen.queryByLabelText('Admin overview')).not.toBeInTheDocument()
  })
})
