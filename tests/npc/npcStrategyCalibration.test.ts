import { describe, expect, it } from 'vitest'
import {
  calibrateNpcStrategy,
  DEFAULT_NPC_CALIBRATION_FILTERS,
} from '../../src/npc/npcStrategyCalibration'
import { LOCAL_NPC_STRATEGY_PROFILES } from '../../src/npc/roster'
import { compileSimpleStrategyProfile, type NpcSimpleStrategyIntent } from '../../src/npc/npcSimpleStrategy'

const TEACHING_COMPARISON_FILTERS = {
  ...DEFAULT_NPC_CALIBRATION_FILTERS,
  texture: 'dry' as const,
  tableShape: 'heads-up' as const,
  betSize: 'medium' as const,
}

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
      LOCAL_NPC_STRATEGY_PROFILES.find((profile) => profile.id === 'strategy-balanced-caller-v5')!,
      TEACHING_COMPARISON_FILTERS,
    )
    const pressure = calibrateNpcStrategy(
      LOCAL_NPC_STRATEGY_PROFILES.find((profile) => profile.id === 'strategy-pressure-raiser-v5')!,
      TEACHING_COMPARISON_FILTERS,
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

  it('proves the required teaching tendencies across identical deterministic scenario batches', () => {
    const source = LOCAL_NPC_STRATEGY_PROFILES[0]
    const report = (intent: Partial<NpcSimpleStrategyIntent>) => calibrateNpcStrategy(
      compileSimpleStrategyProfile(source, {
        preflopStyle: 'balanced',
        pressure: 'balanced',
        postflopPlan: 'balanced',
        defense: 'balanced',
        sizing: 'mixed',
        context: 'position-aware',
        ...intent,
      }),
      TEACHING_COMPARISON_FILTERS,
    )
    const tight = report({ preflopStyle: 'tight' })
    const loose = report({ preflopStyle: 'loose' })
    const passive = report({ pressure: 'low' })
    const pressure = report({ pressure: 'high' })
    const selective = report({ defense: 'selective' })
    const sticky = report({ defense: 'sticky' })
    const drawPressure = report({ postflopPlan: 'draw-pressure' })
    const valueFirst = report({ postflopPlan: 'value-first' })
    const potControl = report({ postflopPlan: 'pot-control', sizing: 'small' })
    const large = report({ sizing: 'large' })
    const oneAndDoneProfile = compileSimpleStrategyProfile(source, {
      preflopStyle: 'balanced',
      pressure: 'balanced',
      postflopPlan: 'balanced',
      defense: 'balanced',
      sizing: 'mixed',
      context: 'position-aware',
    })
    const persistentProfile = structuredClone(oneAndDoneProfile)
    oneAndDoneProfile.postflopStrategy!.frequencies.turnBarrel = 0.12
    oneAndDoneProfile.postflopStrategy!.frequencies.riverBarrel = 0.08
    persistentProfile.postflopStrategy!.frequencies.turnBarrel = 0.72
    persistentProfile.postflopStrategy!.frequencies.riverBarrel = 0.6
    const oneAndDone = calibrateNpcStrategy(oneAndDoneProfile, TEACHING_COMPARISON_FILTERS)
    const persistent = calibrateNpcStrategy(persistentProfile, TEACHING_COMPARISON_FILTERS)

    expect(tight.preflop.vpipRate.value).toBeLessThan(loose.preflop.vpipRate.value)
    expect(pressure.preflop.openRaiseRate.value).toBeGreaterThan(passive.preflop.openRaiseRate.value)
    expect(sticky.postflopDefense.expectedContinueRate).toBeGreaterThan(selective.postflopDefense.expectedContinueRate)
    expect(oneAndDone.postflopProactive.continuationBetRate).toBe(persistent.postflopProactive.continuationBetRate)
    expect(oneAndDone.postflopProactive.barrelRate).toBeLessThan(persistent.postflopProactive.barrelRate)
    expect(drawPressure.postflopProactive.semiBluffRate).toBeGreaterThan(valueFirst.postflopProactive.semiBluffRate)
    expect(potControl.postflopProactive.barrelRate).toBeLessThan(pressure.postflopProactive.barrelRate)
    expect(potControl.postflopProactive.averagePotFraction).toBeLessThan(large.postflopProactive.averagePotFraction)
  })

  it('compares the shipped Pressure Raiser, Pot Controller, and Balanced Caller profiles', () => {
    const byName = (name: string) => calibrateNpcStrategy(
      LOCAL_NPC_STRATEGY_PROFILES.find((profile) => profile.name === name)!,
      TEACHING_COMPARISON_FILTERS,
    )
    const pressure = byName('Pressure Raiser')
    const potControl = byName('Pot Controller')
    const balanced = byName('Balanced Caller')

    expect(pressure.preflop.openRaiseRate.value).toBeGreaterThan(balanced.preflop.openRaiseRate.value)
    expect(pressure.postflopProactive.betRate).toBeGreaterThan(balanced.postflopProactive.betRate)
    expect(potControl.postflopProactive.barrelRate).toBeLessThan(balanced.postflopProactive.barrelRate)
    expect(potControl.postflopProactive.averagePotFraction).toBeLessThan(pressure.postflopProactive.averagePotFraction)
    expect(balanced.postflopDefense.expectedContinueRate).toBeGreaterThan(pressure.postflopDefense.expectedContinueRate)
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
