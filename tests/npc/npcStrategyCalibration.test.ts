import { describe, expect, it } from 'vitest'
import {
  calibrateNpcStrategy,
  DEFAULT_NPC_CALIBRATION_FILTERS,
} from '../../src/npc/npcStrategyCalibration'
import { LOCAL_NPC_STRATEGY_PROFILES } from '../../src/npc/roster'

describe('NPC strategy calibration', () => {
  it('produces deterministic bounded reports without canonical poker secrets', () => {
    const profile = LOCAL_NPC_STRATEGY_PROFILES[0]
    const first = calibrateNpcStrategy(profile, DEFAULT_NPC_CALIBRATION_FILTERS)
    const second = calibrateNpcStrategy(profile, DEFAULT_NPC_CALIBRATION_FILTERS)

    expect(first).toEqual(second)
    expect(first.schemaVersion).toBe('npc-calibration-v1')
    expect(first.preflop.nodeCount).toBeGreaterThan(0)
    expect(first.postflopDefense.scenarioCount).toBeGreaterThan(100)
    expect(first.postflopProactive.scenarioCount).toBeGreaterThan(100)
    expect(allRates(first)).toEqual(expect.arrayContaining([expect.any(Number)]))
    expect(allRates(first).every((rate) => rate >= 0 && rate <= 1)).toBe(true)
    expect(JSON.stringify(first)).not.toMatch(/deck|holeCards|rngState|entropy/i)
  })

  it('filters the preflop catalog without changing the source profile', () => {
    const profile = structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])
    const before = structuredClone(profile)
    const report = calibrateNpcStrategy(profile, {
      ...DEFAULT_NPC_CALIBRATION_FILTERS,
      format: 'heads-up',
      stackDepth: 'short',
      position: 'BB',
    })

    expect(report.preflop.nodeCount).toBeGreaterThan(0)
    expect(report.preflop.nodeCount).toBeLessThan(profile.preflopStrategy?.nodes.length ?? 0)
    expect(profile).toEqual(before)
  })

  it('makes meaningful profile differences visible in batch behavior', () => {
    const balanced = calibrateNpcStrategy(
      LOCAL_NPC_STRATEGY_PROFILES.find((profile) => profile.id === 'strategy-balanced-caller-v4')!,
      DEFAULT_NPC_CALIBRATION_FILTERS,
    )
    const pressure = calibrateNpcStrategy(
      LOCAL_NPC_STRATEGY_PROFILES.find((profile) => profile.id === 'strategy-pressure-raiser-v4')!,
      DEFAULT_NPC_CALIBRATION_FILTERS,
    )

    expect(pressure.preflop.openRaiseRate.value).toBeGreaterThan(balanced.preflop.openRaiseRate.value)
    expect(pressure.postflopProactive.betRate).toBeGreaterThan(balanced.postflopProactive.betRate)
  })

  it('shows defense settings changing expected continuation across the scenario batch', () => {
    const sticky = structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])
    const cautious = structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])
    if (!sticky.postflopStrategy?.defense || !cautious.postflopStrategy?.defense) {
      throw new Error('Expected defense configuration.')
    }
    sticky.postflopStrategy.defense.foldBias = -0.3
    cautious.postflopStrategy.defense.foldBias = 0.3

    const stickyReport = calibrateNpcStrategy(sticky, DEFAULT_NPC_CALIBRATION_FILTERS)
    const cautiousReport = calibrateNpcStrategy(cautious, DEFAULT_NPC_CALIBRATION_FILTERS)

    expect(stickyReport.postflopDefense.expectedContinueRate)
      .toBeGreaterThan(cautiousReport.postflopDefense.expectedContinueRate)
  })
})

function allRates(report: ReturnType<typeof calibrateNpcStrategy>): number[] {
  return [
    report.preflop.vpipRate.value,
    report.preflop.openRaiseRate.value,
    report.preflop.threeBetRate.value,
    report.preflop.squeezeRate.value,
    report.postflopDefense.expectedContinueRate,
    report.postflopDefense.smallBetContinueRate,
    report.postflopDefense.largeBetContinueRate,
    report.postflopProactive.betRate,
    report.postflopProactive.valueBetRate,
    report.postflopProactive.bluffBetRate,
  ]
}
