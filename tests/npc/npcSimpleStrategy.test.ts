import { describe, expect, it } from 'vitest'
import { normalizeStrategyProfile } from '../../src/npc/npcRegistry'
import {
  compileSimpleStrategyProfile,
  describeSimpleStrategyIntent,
  previewSimpleStrategyChange,
  type NpcSimpleStrategyIntent,
} from '../../src/npc/npcSimpleStrategy'
import { LOCAL_NPC_STRATEGY_PROFILES } from '../../src/npc/roster'

const aggressiveDrawIntent: NpcSimpleStrategyIntent = {
  preflopStyle: 'loose',
  pressure: 'high',
  postflopPlan: 'draw-pressure',
  defense: 'sticky',
  sizing: 'large',
  context: 'position-aware',
}

describe('simple NPC strategy compilation', () => {
  it('deterministically compiles broad intent without mutating the source profile', () => {
    const source = structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])
    const untouched = structuredClone(source)
    const first = compileSimpleStrategyProfile(source, aggressiveDrawIntent)
    const second = compileSimpleStrategyProfile(source, aggressiveDrawIntent)

    expect(first).toEqual(second)
    expect(source).toEqual(untouched)
    expect(first.id).toBe(source.id)
    expect(first.version).toBe(source.version)
    expect(first.preflopStrategy?.id).toBe(source.preflopStrategy?.id)
    expect(first.postflopStrategy?.id).toBe(source.postflopStrategy?.id)
  })

  it('turns broad choices into valid ranges, sizing, modules, and calibration intent', () => {
    const compiled = compileSimpleStrategyProfile(LOCAL_NPC_STRATEGY_PROFILES[0], aggressiveDrawIntent)

    expect(compiled.policyConfig).toEqual({
      preflopAggression: 0.78,
      preflopLooseness: 0.48,
      postflopAggression: 0.74,
      pressureRaiseMultiplier: 3.4,
    })
    expect(compiled.calibrationTarget?.presetId).toBe('draw-pressure')
    expect(compiled.preflopStrategy?.nodes.length).toBeGreaterThan(0)
    expect(compiled.postflopStrategy?.frequencies.semiBluff).toBe(0.84)
    expect(compiled.postflopStrategy?.defense?.mdfAdherence).toBe(0.96)
    expect(compiled.modules.find((module) => module.id === 'draw-selection')?.weight).toBe(0.95)
    expect(() => normalizeStrategyProfile(compiled)).not.toThrow()
  })

  it('keeps low-pressure pot control materially different from a pressure strategy', () => {
    const source = LOCAL_NPC_STRATEGY_PROFILES[0]
    const quiet = compileSimpleStrategyProfile(source, {
      preflopStyle: 'tight',
      pressure: 'low',
      postflopPlan: 'pot-control',
      defense: 'selective',
      sizing: 'small',
      context: 'multiway-cautious',
    })
    const pressure = compileSimpleStrategyProfile(source, aggressiveDrawIntent)

    expect(quiet.policyConfig.preflopLooseness).toBeLessThan(pressure.policyConfig.preflopLooseness)
    expect(quiet.postflopStrategy!.frequencies.turnBarrel).toBeLessThan(pressure.postflopStrategy!.frequencies.turnBarrel)
    expect(quiet.postflopStrategy!.sizing.riverPotFraction).toBeLessThan(pressure.postflopStrategy!.sizing.riverPotFraction)
    expect(quiet.postflopStrategy!.modifiers.multiwayPenalty).toBeGreaterThan(pressure.postflopStrategy!.modifiers.multiwayPenalty)
  })

  it('produces a readable sentence and before/after preview', () => {
    const source = LOCAL_NPC_STRATEGY_PROFILES[0]
    const preview = previewSimpleStrategyChange(source, aggressiveDrawIntent)

    expect(describeSimpleStrategyIntent(aggressiveDrawIntent)).toContain('loose preflop ranges')
    expect(preview.targetName).toBe('draw pressure')
    expect(preview.metrics).toHaveLength(6)
    expect(preview.metrics.find((metric) => metric.label === 'VPIP')?.after).toBeGreaterThan(0)
    expect(preview.changedModules).toContain('draw selection')
    expect(preview.warnings).toEqual(expect.any(Array))
  })
})
