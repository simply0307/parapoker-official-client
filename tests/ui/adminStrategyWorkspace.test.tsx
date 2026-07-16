import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AdminStrategyWorkspace } from '../../src/ui/AdminStrategyWorkspace'
import { LOCAL_NPC_STRATEGY_PROFILES } from '../../src/npc/roster'

describe('Admin strategy workspace', () => {
  it('creates and saves an independent editable profile version', async () => {
    const onCreateVersion = vi.fn().mockResolvedValue(undefined)
    render(
      <AdminStrategyWorkspace
        profiles={[structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])]}
        onCreateVersion={onCreateVersion}
      />,
    )

    expect(screen.getByRole('spinbutton', { name: /fold bias/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Create editable version' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Maven Teaching Defense' },
    })
    fireEvent.change(screen.getByRole('spinbutton', { name: /fold bias/i }), {
      target: { value: '0.2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile version' }))

    expect(onCreateVersion).toHaveBeenCalledTimes(1)
    const [sourceId, saved] = onCreateVersion.mock.calls[0]
    expect(sourceId).toBe('strategy-balanced-caller-v4')
    expect(saved).toEqual(expect.objectContaining({
      id: 'strategy-balanced-caller-custom-v5',
      version: 5,
      name: 'Maven Teaching Defense',
    }))
    expect(saved.postflopStrategy.defense.foldBias).toBe(0.2)
    expect(LOCAL_NPC_STRATEGY_PROFILES[0].name).toBe('Balanced Caller')
  })

  it('edits a selected preflop hand while preserving a valid frequency mix', async () => {
    const onCreateVersion = vi.fn().mockResolvedValue(undefined)
    render(
      <AdminStrategyWorkspace
        profiles={[structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])]}
        onCreateVersion={onCreateVersion}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Create editable version' }))
    fireEvent.click(screen.getByRole('gridcell', { name: 'AA' }))
    const raise = screen.getByRole('spinbutton', { name: 'Raise' })
    fireEvent.change(raise, { target: { value: '0.8' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile version' }))

    const saved = onCreateVersion.mock.calls[0][1]
    const firstNode = saved.preflopStrategy.nodes[0]
    expect(firstNode.hands.AA.find((entry: { action: string }) => entry.action === 'raise')?.frequency).toBe(0.8)
    expect(firstNode.hands.AA.reduce((sum: number, entry: { frequency: number }) => sum + entry.frequency, 0)).toBeCloseTo(1)
  })

  it('shows a deterministic simulator trace from the selected strategy', () => {
    render(
      <AdminStrategyWorkspace
        profiles={[structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])]}
        onCreateVersion={vi.fn()}
      />,
    )

    expect(screen.getByRole('region', { name: 'NPC decision simulator' })).toHaveTextContent('MDF')
    expect(screen.getByRole('region', { name: 'NPC decision simulator' })).toHaveTextContent('Pot odds')
    expect(screen.getByRole('region', { name: 'NPC decision simulator' })).toHaveTextContent(/call|fold/i)
  })
})
