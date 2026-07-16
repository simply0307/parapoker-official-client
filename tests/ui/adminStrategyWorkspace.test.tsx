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

    openAdvancedEditor()
    expect(screen.getByRole('tab', { name: 'Intent' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('grid', { name: 'Preflop hand matrix' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create editable version' }))
    fireEvent.change(screen.getByLabelText('Strategy calibration target'), { target: { value: 'pressure' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Profile' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Maven Teaching Defense' },
    })
    fireEvent.click(screen.getByRole('tab', { name: 'Postflop' }))
    fireEvent.change(screen.getByLabelText('Postflop parameter group'), { target: { value: 'defense' } })
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
    expect(saved.calibrationTarget.presetId).toBe('pressure')
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

    openAdvancedEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Create editable version' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Preflop' }))
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

    openAdvancedEditor()
    fireEvent.click(screen.getByRole('tab', { name: 'Decision Lab' }))
    expect(screen.getByRole('region', { name: 'NPC decision simulator' })).toHaveTextContent('MDF')
    expect(screen.getByRole('region', { name: 'NPC decision simulator' })).toHaveTextContent('Pot odds')
    expect(screen.getByRole('region', { name: 'NPC decision simulator' })).toHaveTextContent(/call|fold/i)
  })

  it('keeps calibration in a focused filterable stage', () => {
    render(
      <AdminStrategyWorkspace
        profiles={structuredClone(LOCAL_NPC_STRATEGY_PROFILES)}
        onCreateVersion={vi.fn()}
      />,
    )

    openAdvancedEditor()
    fireEvent.click(screen.getByRole('tab', { name: 'Calibration' }))

    expect(screen.getByRole('region', { name: 'NPC strategy calibration' })).toBeInTheDocument()
    expect(screen.getByLabelText('Calibration format')).toBeInTheDocument()
    expect(screen.getByLabelText('Comparison profile')).toBeInTheDocument()
    expect(screen.getByText('Projected VPIP')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Deterministic behavior validation' })).toBeInTheDocument()
    expect(screen.getByText('Observed')).toBeInTheDocument()
    expect(screen.queryByRole('grid', { name: 'Preflop hand matrix' })).not.toBeInTheDocument()
  })

  it('starts with strategy intent, explains the model, and shows calibration again in Profile', () => {
    render(
      <AdminStrategyWorkspace
        profiles={structuredClone(LOCAL_NPC_STRATEGY_PROFILES)}
        onCreateVersion={vi.fn()}
      />,
    )

    openAdvancedEditor()
    expect(screen.getByRole('region', { name: 'Strategy calibration intent' })).toBeInTheDocument()
    expect(screen.getByLabelText('Strategy calibration target')).toHaveValue('balanced')
    expect(screen.getByText('Strategy editor key and poker-theory guide')).toBeInTheDocument()
    expect(screen.getByText(/MDF/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Profile' }))
    expect(screen.getByRole('region', { name: 'Strategy target summary' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open full calibration' })).toBeInTheDocument()
  })

  it('turns a preset into a persisted custom target when its bands are edited', async () => {
    const onCreateVersion = vi.fn().mockResolvedValue(undefined)
    render(
      <AdminStrategyWorkspace
        profiles={[structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])]}
        onCreateVersion={onCreateVersion}
      />,
    )

    openAdvancedEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Create editable version' }))
    fireEvent.change(screen.getByLabelText('VPIP minimum'), { target: { value: '0.31' } })

    expect(screen.getByLabelText('Strategy calibration target')).toHaveValue('custom')
    fireEvent.click(screen.getByRole('button', { name: 'Save profile version' }))

    expect(onCreateVersion).toHaveBeenCalledTimes(1)
    expect(onCreateVersion.mock.calls[0][1].calibrationTarget).toEqual(expect.objectContaining({
      presetId: 'custom',
      bands: expect.objectContaining({ 'preflop.vpip': { min: 0.31, max: 0.48 } }),
    }))
  })

  it('surfaces verified archived-hand evidence for the exact profile version', () => {
    render(
      <AdminStrategyWorkspace
        profiles={[structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])]}
        evidence={[{
          schemaVersion: 'npc-observed-strategy-v1',
          profileId: 'strategy-balanced-caller-v4',
          profileVersion: 4,
          matchIds: ['match-a', 'match-b'],
          handCount: 42,
          metrics: {
            'preflop.vpip': { value: 0.38, opportunities: 42, successes: 16 },
          },
        }]}
        onCreateVersion={vi.fn()}
      />,
    )

    openAdvancedEditor()
    expect(screen.getByText('42 verified hands across 2 matches')).toBeInTheDocument()
    expect(screen.getByText('verified n=42')).toBeInTheDocument()
  })

  it('starts in a readable Simple mode and requires an editable version before applying', () => {
    render(
      <AdminStrategyWorkspace
        profiles={[structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])]}
        onCreateVersion={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Simple' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: 'Simple strategy editor' })).toBeInTheDocument()
    expect(screen.getByLabelText('Simple strategy summary')).toHaveTextContent('Play balanced preflop ranges')
    expect(screen.getByRole('button', { name: 'Apply broad changes' })).toBeDisabled()
    expect(screen.queryByRole('tab', { name: 'Preflop' })).not.toBeInTheDocument()
  })

  it('applies broad intent to a draft and keeps the result available in Advanced mode', async () => {
    const onCreateVersion = vi.fn().mockResolvedValue(undefined)
    render(
      <AdminStrategyWorkspace
        profiles={[structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])]}
        onCreateVersion={onCreateVersion}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Create editable version' }))
    fireEvent.change(screen.getByLabelText('Preflop ranges'), { target: { value: 'loose' } })
    fireEvent.change(screen.getByLabelText('Pressure'), { target: { value: 'high' } })
    fireEvent.change(screen.getByLabelText('Postflop plan'), { target: { value: 'draw-pressure' } })
    expect(screen.getByLabelText('Simple strategy change preview')).toHaveTextContent('draw selection')
    fireEvent.click(screen.getByRole('button', { name: 'Apply broad changes' }))

    openAdvancedEditor()
    fireEvent.click(screen.getByRole('tab', { name: 'Profile' }))
    expect(screen.getByRole('spinbutton', { name: 'Preflop Looseness' })).toHaveValue(0.48)
    fireEvent.click(screen.getByRole('button', { name: 'Save profile version' }))

    expect(onCreateVersion).toHaveBeenCalledTimes(1)
    expect(onCreateVersion.mock.calls[0][1].policyConfig.preflopLooseness).toBe(0.48)
    expect(onCreateVersion.mock.calls[0][1].calibrationTarget.presetId).toBe('draw-pressure')
  })
})

function openAdvancedEditor() {
  fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
}
