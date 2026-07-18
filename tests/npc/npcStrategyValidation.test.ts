import { describe, expect, it } from 'vitest'
import { normalizeStrategyProfile } from '../../src/npc/npcRegistry'
import { LOCAL_NPC_STRATEGY_PROFILES } from '../../src/npc/roster'
import {
  createNpcStrategyCalibrationTarget,
  validateNpcStrategyBehavior,
} from '../../src/npc/npcStrategyValidation'
import type { NpcObservedStrategyEvidence } from '../../src/npc/npcObservedStrategyStats'

describe('NPC strategy validation', () => {
  it('produces deterministic target and observed-behavior reports without secrets', () => {
    const profile = LOCAL_NPC_STRATEGY_PROFILES[0]
    const first = validateNpcStrategyBehavior(profile)
    const second = validateNpcStrategyBehavior(profile)

    expect(first).toEqual(second)
    expect(first.schemaVersion).toBe('npc-strategy-validation-v1')
    expect(first.target.presetId).toBe('balanced')
    expect(first.metrics.length).toBeGreaterThan(5)
    expect(first.metrics.every((metric) => Math.abs(metric.value - metric.observed) < 0.04)).toBe(true)
    expect(JSON.stringify(first)).not.toMatch(/deck|holeCards|rngState|entropy/i)
  })

  it('persists selected target bands while normalizing legacy profiles', () => {
    const pressure = normalizeStrategyProfile({
      ...structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0]),
      id: 'pressure-copy-v5',
      version: 5,
      calibrationTarget: createNpcStrategyCalibrationTarget('pressure'),
    })
    const legacy = structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])
    delete legacy.calibrationTarget

    expect(pressure.calibrationTarget?.presetId).toBe('pressure')
    expect(pressure.calibrationTarget?.bands['proactive.barrel']).toEqual(expect.objectContaining({ min: expect.any(Number) }))
    expect(normalizeStrategyProfile(legacy).calibrationTarget?.presetId).toBe('balanced')
  })

  it('flags target misses and configuration contradictions without mutating the profile', () => {
    const profile = structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])
    const before = structuredClone(profile)
    if (!profile.postflopStrategy) throw new Error('Expected postflop strategy.')
    profile.calibrationTarget = createNpcStrategyCalibrationTarget('pressure')
    profile.postflopStrategy.thresholds.thinValueStrength = 0.9
    profile.postflopStrategy.thresholds.valueBetStrength = 0.6

    const report = validateNpcStrategyBehavior(profile)

    expect(report.status).not.toBe('on-target')
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'thin-value-order', severity: 'error' }))
    expect(report.issues.some((issue) => issue.code.startsWith('target-'))).toBe(true)
    expect(before.postflopStrategy?.thresholds.thinValueStrength).not.toBe(0.9)
  })

  it('rejects malformed target bands through the registry boundary', () => {
    const profile = structuredClone(LOCAL_NPC_STRATEGY_PROFILES[0])
    if (!profile.calibrationTarget) throw new Error('Expected calibration target.')
    profile.calibrationTarget.bands['preflop.vpip'] = { min: 0.8, max: 0.2 }

    expect(() => normalizeStrategyProfile(profile)).toThrow(/calibration band/i)
  })

  it('uses sufficiently sampled verified match evidence while retaining scenario fallback metrics', () => {
    const profile = LOCAL_NPC_STRATEGY_PROFILES[0]
    const evidence: NpcObservedStrategyEvidence = {
      schemaVersion: 'npc-observed-strategy-v1',
      profileId: profile.id,
      profileVersion: profile.version,
      matchIds: ['verified-match'],
      handCount: 40,
      metrics: {
        'preflop.vpip': { value: 0.4, opportunities: 40, successes: 16 },
      },
      teachingMetrics: {},
      decisionCoverage: {
        totalDecisions: 0,
        sourceCounts: {},
        sourceRates: {},
        fallbackRate: 0,
        mostCommonFallbackSituations: [],
      },
    }

    const report = validateNpcStrategyBehavior(profile, undefined, evidence)
    const vpip = report.metrics.find((metric) => metric.id === 'preflop.vpip')
    const threeBet = report.metrics.find((metric) => metric.id === 'preflop.threeBet')

    expect(vpip).toEqual(expect.objectContaining({
      observed: 0.4,
      observedSource: 'verified-match',
      observedSampleCount: 40,
    }))
    expect(threeBet).toEqual(expect.objectContaining({ observedSource: 'deterministic-scenario' }))
  })
})
