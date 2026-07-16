import type {
  NpcStrategyCalibrationBand,
  NpcStrategyCalibrationMetricId,
  NpcStrategyCalibrationTarget,
  NpcStrategyProfile,
  NpcStrategyTargetPresetId,
} from './config'
import {
  calibrateNpcStrategy,
  DEFAULT_NPC_CALIBRATION_FILTERS,
  type NpcCalibrationFilters,
  type NpcStrategyCalibrationReport,
} from './npcStrategyCalibration'
import { createRng } from '../shared/rng'

export interface NpcStrategyTargetPreset {
  id: NpcStrategyTargetPresetId
  name: string
  summary: string
  bands: Partial<Record<NpcStrategyCalibrationMetricId, NpcStrategyCalibrationBand>>
}

export type NpcStrategyValidationSeverity = 'error' | 'warning' | 'info'

export interface NpcStrategyValidationIssue {
  code: string
  severity: NpcStrategyValidationSeverity
  stage: 'intent' | 'preflop' | 'postflop' | 'modules'
  message: string
  metricId?: NpcStrategyCalibrationMetricId
}

export interface NpcStrategyMetricResult {
  id: NpcStrategyCalibrationMetricId
  label: string
  value: number
  observed: number
  band?: NpcStrategyCalibrationBand
  status: 'inside' | 'below' | 'above' | 'unbounded'
}

export interface NpcStrategyValidationReport {
  schemaVersion: 'npc-strategy-validation-v1'
  profileId: string
  profileVersion: number
  target: NpcStrategyCalibrationTarget
  targetName: string
  status: 'on-target' | 'review' | 'off-target'
  score: number
  calibration: NpcStrategyCalibrationReport
  metrics: NpcStrategyMetricResult[]
  issues: NpcStrategyValidationIssue[]
}

export const NPC_STRATEGY_TARGET_PRESETS: NpcStrategyTargetPreset[] = [
  preset('balanced', 'Balanced', 'Competes across common lines without making pressure or passivity its defining feature.', {
    'preflop.vpip': band(0.28, 0.48),
    'preflop.openRaise': band(0.18, 0.42),
    'preflop.threeBet': band(0.06, 0.22),
    'preflop.foldToThreeBet': band(0.35, 0.72),
    'defense.continue': band(0.4, 0.68),
    'proactive.bet': band(0.42, 0.7),
    'proactive.continuationBet': band(0.48, 0.75),
    'proactive.bluffBet': band(0.03, 0.2),
    'proactive.averagePotFraction': band(0.4, 0.72),
  }),
  preset('pressure', 'Pressure', 'Raises and barrels more often, while still using hand class, range context, and board texture.', {
    'preflop.vpip': band(0.26, 0.5),
    'preflop.openRaise': band(0.28, 0.62),
    'preflop.threeBet': band(0.12, 0.34),
    'defense.continue': band(0.36, 0.67),
    'proactive.bet': band(0.56, 0.86),
    'proactive.continuationBet': band(0.66, 0.94),
    'proactive.barrel': band(0.5, 0.84),
    'proactive.semiBluff': band(0.58, 0.92),
    'proactive.bluffBet': band(0.1, 0.34),
    'proactive.averagePotFraction': band(0.56, 0.92),
  }),
  preset('pot-control', 'Pot control', 'Uses smaller pots and fewer marginal pressure lines, especially as streets and ranges narrow.', {
    'preflop.vpip': band(0.2, 0.4),
    'preflop.openRaise': band(0.14, 0.36),
    'preflop.threeBet': band(0.03, 0.16),
    'defense.continue': band(0.34, 0.62),
    'proactive.bet': band(0.22, 0.54),
    'proactive.continuationBet': band(0.3, 0.62),
    'proactive.barrel': band(0.12, 0.46),
    'proactive.bluffBet': band(0, 0.1),
    'proactive.averagePotFraction': band(0.3, 0.62),
  }),
  preset('value-first', 'Value first', 'Builds larger pots with made hands while keeping unsupported bluffs comparatively rare.', {
    'preflop.vpip': band(0.22, 0.42),
    'preflop.openRaise': band(0.2, 0.46),
    'preflop.threeBet': band(0.07, 0.24),
    'defense.continue': band(0.4, 0.7),
    'proactive.bet': band(0.4, 0.72),
    'proactive.valueBet': band(0.82, 1),
    'proactive.bluffBet': band(0, 0.11),
    'proactive.averagePotFraction': band(0.5, 0.84),
  }),
  preset('draw-pressure', 'Draw pressure', 'Uses strong draws and dynamic boards as controlled sources of aggression.', {
    'preflop.vpip': band(0.28, 0.52),
    'preflop.openRaise': band(0.18, 0.46),
    'defense.drawContinue': band(0.62, 0.92),
    'proactive.bet': band(0.44, 0.76),
    'proactive.semiBluff': band(0.65, 0.96),
    'proactive.bluffBet': band(0.04, 0.22),
    'proactive.averagePotFraction': band(0.48, 0.82),
  }),
  preset('custom', 'Custom targets', 'Starts from broad safety bands and allows a deliberately specialized strategy.', {
    'preflop.vpip': band(0.12, 0.7),
    'preflop.openRaise': band(0.08, 0.7),
    'preflop.threeBet': band(0.01, 0.45),
    'defense.continue': band(0.2, 0.82),
    'proactive.bet': band(0.15, 0.9),
    'proactive.bluffBet': band(0, 0.4),
    'proactive.averagePotFraction': band(0.25, 1.05),
  }),
]

const METRIC_LABELS: Record<NpcStrategyCalibrationMetricId, string> = {
  'preflop.vpip': 'VPIP',
  'preflop.openRaise': 'Open raise',
  'preflop.threeBet': 'Three-bet',
  'preflop.foldToThreeBet': 'Fold to three-bet',
  'defense.continue': 'Continue versus bet',
  'defense.largeBetContinue': 'Continue versus large bet',
  'defense.drawContinue': 'Continue with draw',
  'proactive.bet': 'Bet when checked to',
  'proactive.continuationBet': 'Continuation bet',
  'proactive.barrel': 'Turn or river barrel',
  'proactive.semiBluff': 'Semi-bluff',
  'proactive.valueBet': 'Value bet',
  'proactive.bluffBet': 'Pure bluff',
  'proactive.averagePotFraction': 'Average bet size',
}

export function createNpcStrategyCalibrationTarget(
  presetId: NpcStrategyTargetPresetId,
): NpcStrategyCalibrationTarget {
  const selected = mustTargetPreset(presetId)
  return {
    schemaVersion: 'npc-strategy-target-v1',
    presetId,
    bands: clone(selected.bands),
  }
}

export function normalizeNpcStrategyCalibrationTarget(
  target: NpcStrategyCalibrationTarget | undefined,
): NpcStrategyCalibrationTarget {
  if (!target) {
    return createNpcStrategyCalibrationTarget('balanced')
  }
  if (target.schemaVersion !== 'npc-strategy-target-v1') {
    throw new Error('NPC strategy calibration target schema version is invalid.')
  }
  mustTargetPreset(target.presetId)
  for (const [metricId, metricBand] of Object.entries(target.bands)) {
    if (!isMetricId(metricId) || !metricBand || !validBand(metricBand)) {
      throw new Error(`NPC strategy calibration band is invalid: ${metricId}`)
    }
  }
  return clone(target)
}

export function validateNpcStrategyBehavior(
  profile: NpcStrategyProfile,
  filters: NpcCalibrationFilters = DEFAULT_NPC_CALIBRATION_FILTERS,
): NpcStrategyValidationReport {
  const target = normalizeNpcStrategyCalibrationTarget(profile.calibrationTarget)
  const targetPreset = mustTargetPreset(target.presetId)
  const calibration = calibrateNpcStrategy(profile, filters)
  const values = calibrationValues(calibration)
  const metrics = (Object.keys(target.bands) as NpcStrategyCalibrationMetricId[]).map((id) => {
    const value = values[id]
    const targetBand = target.bands[id]
    return {
      id,
      label: METRIC_LABELS[id],
      value,
      observed: id === 'proactive.averagePotFraction'
        ? value
        : deterministicObservedRate(value, `${profile.id}:${profile.version}:${id}`),
      ...(targetBand ? { band: targetBand } : {}),
      status: metricStatus(value, targetBand),
    }
  })
  const issues = [
    ...metrics.flatMap((metric) => metricIssue(metric)),
    ...configurationIssues(profile, calibration),
  ]
  const bounded = metrics.filter((metric) => metric.status !== 'unbounded')
  const inside = bounded.filter((metric) => metric.status === 'inside').length
  const score = bounded.length > 0 ? round(inside / bounded.length) : 1
  const errors = issues.filter((issue) => issue.severity === 'error').length
  const warnings = issues.filter((issue) => issue.severity === 'warning').length
  return {
    schemaVersion: 'npc-strategy-validation-v1',
    profileId: profile.id,
    profileVersion: profile.version,
    target,
    targetName: targetPreset.name,
    status: errors > 0 || score < 0.5 ? 'off-target' : warnings > 0 || score < 1 ? 'review' : 'on-target',
    score,
    calibration,
    metrics,
    issues,
  }
}

function configurationIssues(
  profile: NpcStrategyProfile,
  calibration: NpcStrategyCalibrationReport,
): NpcStrategyValidationIssue[] {
  const issues: NpcStrategyValidationIssue[] = []
  const postflop = profile.postflopStrategy
  if (!profile.preflopStrategy || calibration.preflop.nodeCount === 0) {
    issues.push(issue('missing-preflop', 'error', 'preflop', 'No preflop range nodes are available for calibration.'))
  }
  if (!postflop) {
    issues.push(issue('missing-postflop', 'error', 'postflop', 'No postflop strategy is available for calibration.'))
    return issues
  }
  if (postflop.thresholds.thinValueStrength > postflop.thresholds.valueBetStrength) {
    issues.push(issue('thin-value-order', 'error', 'postflop', 'Thin-value strength must not exceed the normal value-bet threshold.'))
  }
  if (postflop.thresholds.valueBetStrength > postflop.thresholds.valueRaiseStrength) {
    issues.push(issue('value-raise-order', 'error', 'postflop', 'The value-raise threshold must be at least as strong as the value-bet threshold.'))
  }
  if (postflop.sizing.dryFlopPotFraction > postflop.sizing.wetFlopPotFraction + 0.2) {
    issues.push(issue('texture-sizing-reversal', 'warning', 'postflop', 'Dry-board bets are much larger than wet-board bets; confirm that this reversal is intentional.'))
  }
  if (postflop.frequencies.pureBluff > postflop.frequencies.semiBluff) {
    issues.push(issue('bluff-composition', 'warning', 'postflop', 'Pure bluffs occur more often than semi-bluffs; this may produce an unusually equity-light bluff range.'))
  }
  const cBetModule = profile.modules.find((module) => module.id === 'continuation-bet')
  if (cBetModule && !cBetModule.enabled && postflop.frequencies.cBetFlop > 0.15) {
    issues.push(issue('disabled-cbet-module', 'warning', 'modules', 'The continuation-bet module is disabled while its configured frequency remains material.'))
  }
  const mdfModule = profile.modules.find((module) => module.id === 'mdf-defense')
  if (mdfModule && !mdfModule.enabled && (postflop.defense?.mdfAdherence ?? 0) > 0.25) {
    issues.push(issue('disabled-mdf-module', 'warning', 'modules', 'MDF adherence is configured while the MDF defense module is disabled.'))
  }
  return issues
}

function calibrationValues(report: NpcStrategyCalibrationReport): Record<NpcStrategyCalibrationMetricId, number> {
  return {
    'preflop.vpip': report.preflop.vpipRate.value,
    'preflop.openRaise': report.preflop.openRaiseRate.value,
    'preflop.threeBet': report.preflop.threeBetRate.value,
    'preflop.foldToThreeBet': report.preflop.foldToThreeBetRate.value,
    'defense.continue': report.postflopDefense.expectedContinueRate,
    'defense.largeBetContinue': report.postflopDefense.largeBetContinueRate,
    'defense.drawContinue': report.postflopDefense.drawContinueRate,
    'proactive.bet': report.postflopProactive.betRate,
    'proactive.continuationBet': report.postflopProactive.continuationBetRate,
    'proactive.barrel': report.postflopProactive.barrelRate,
    'proactive.semiBluff': report.postflopProactive.semiBluffRate,
    'proactive.valueBet': report.postflopProactive.valueBetRate,
    'proactive.bluffBet': report.postflopProactive.bluffBetRate,
    'proactive.averagePotFraction': report.postflopProactive.averagePotFraction,
  }
}

function deterministicObservedRate(expected: number, seed: string): number {
  const rng = createRng(seed)
  const sampleCount = 2_000
  let observed = 0
  for (let index = 0; index < sampleCount; index += 1) {
    if (rng.next() < expected) observed += 1
  }
  return round(observed / sampleCount)
}

function metricIssue(metric: NpcStrategyMetricResult): NpcStrategyValidationIssue[] {
  if (metric.status === 'inside' || metric.status === 'unbounded' || !metric.band) return []
  const direction = metric.status === 'below' ? 'below' : 'above'
  return [{
    code: `target-${metric.id}-${direction}`,
    severity: 'warning',
    stage: metric.id.startsWith('preflop') ? 'preflop' : 'postflop',
    message: `${metric.label} is ${direction} the ${formatBand(metric.band)} target band.`,
    metricId: metric.id,
  }]
}

function metricStatus(value: number, targetBand?: NpcStrategyCalibrationBand): NpcStrategyMetricResult['status'] {
  if (!targetBand) return 'unbounded'
  if (value < targetBand.min) return 'below'
  if (value > targetBand.max) return 'above'
  return 'inside'
}

function issue(code: string, severity: NpcStrategyValidationSeverity, stage: NpcStrategyValidationIssue['stage'], message: string): NpcStrategyValidationIssue {
  return { code, severity, stage, message }
}

function preset(
  id: NpcStrategyTargetPresetId,
  name: string,
  summary: string,
  bands: NpcStrategyTargetPreset['bands'],
): NpcStrategyTargetPreset {
  return { id, name, summary, bands }
}

function band(min: number, max: number): NpcStrategyCalibrationBand {
  return { min, max }
}

function validBand(value: NpcStrategyCalibrationBand): boolean {
  return Number.isFinite(value.min) && Number.isFinite(value.max) && value.min >= 0 && value.max <= 1.25 && value.min <= value.max
}

function isMetricId(value: string): value is NpcStrategyCalibrationMetricId {
  return value in METRIC_LABELS
}

function mustTargetPreset(id: NpcStrategyTargetPresetId): NpcStrategyTargetPreset {
  const target = NPC_STRATEGY_TARGET_PRESETS.find((preset) => preset.id === id)
  if (!target) throw new Error(`Unknown NPC strategy target preset: ${id}`)
  return target
}

function formatBand(value: NpcStrategyCalibrationBand): string {
  return `${Math.round(value.min * 100)}-${Math.round(value.max * 100)}%`
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
