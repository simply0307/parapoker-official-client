import type {
  NpcStrategyModule,
  NpcStrategyModuleId,
  NpcStrategyProfile,
  NpcStrategyTargetPresetId,
} from './config'
import { createNpcStrategyCalibrationTarget, validateNpcStrategyBehavior } from './npcStrategyValidation'
import { createPostflopStrategy } from './postflopStrategy'
import { createMultiFormatPreflopStrategy } from './preflopRanges'

export type NpcSimplePreflopStyle = 'tight' | 'balanced' | 'loose'
export type NpcSimplePressure = 'low' | 'balanced' | 'high'
export type NpcSimplePostflopPlan = 'pot-control' | 'balanced' | 'value-first' | 'draw-pressure'
export type NpcSimpleDefense = 'selective' | 'balanced' | 'sticky'
export type NpcSimpleSizing = 'small' | 'mixed' | 'large'
export type NpcSimpleContext = 'straightforward' | 'position-aware' | 'multiway-cautious'

export interface NpcSimpleStrategyIntent {
  preflopStyle: NpcSimplePreflopStyle
  pressure: NpcSimplePressure
  postflopPlan: NpcSimplePostflopPlan
  defense: NpcSimpleDefense
  sizing: NpcSimpleSizing
  context: NpcSimpleContext
}

export interface NpcSimpleStrategyPreview {
  sentence: string
  targetName: string
  metrics: Array<{ label: string; before: number; after: number }>
  changedModules: string[]
  warnings: string[]
}

export const DEFAULT_SIMPLE_STRATEGY_INTENT: NpcSimpleStrategyIntent = {
  preflopStyle: 'balanced',
  pressure: 'balanced',
  postflopPlan: 'balanced',
  defense: 'balanced',
  sizing: 'mixed',
  context: 'position-aware',
}

const PREFLOP = {
  tight: { looseness: 0.24 },
  balanced: { looseness: 0.36 },
  loose: { looseness: 0.48 },
} as const

const PRESSURE = {
  low: { aggression: 0.38, postflopAggression: 0.36, raiseMultiplier: 2.3 },
  balanced: { aggression: 0.58, postflopAggression: 0.55, raiseMultiplier: 2.8 },
  high: { aggression: 0.78, postflopAggression: 0.74, raiseMultiplier: 3.4 },
} as const

const SIZING = {
  small: {
    preflop: { openRaiseBigBlinds: 2.2, isolationRaiseBigBlinds: 2.8 },
    postflop: { dryFlopPotFraction: 0.33, dynamicFlopPotFraction: 0.45, wetFlopPotFraction: 0.55, turnPotFraction: 0.5, riverPotFraction: 0.58, raiseToMultiplier: 2.25 },
  },
  mixed: {
    preflop: { openRaiseBigBlinds: 2.5, isolationRaiseBigBlinds: 3.2 },
    postflop: { dryFlopPotFraction: 0.42, dynamicFlopPotFraction: 0.58, wetFlopPotFraction: 0.7, turnPotFraction: 0.66, riverPotFraction: 0.74, raiseToMultiplier: 2.6 },
  },
  large: {
    preflop: { openRaiseBigBlinds: 2.8, isolationRaiseBigBlinds: 3.6 },
    postflop: { dryFlopPotFraction: 0.55, dynamicFlopPotFraction: 0.72, wetFlopPotFraction: 0.85, turnPotFraction: 0.8, riverPotFraction: 0.9, raiseToMultiplier: 3 },
  },
} as const

const PLAN = {
  'pot-control': {
    target: 'pot-control',
    frequencies: { cBetFlop: 0.45, turnBarrel: 0.28, riverBarrel: 0.18, semiBluff: 0.28, pureBluff: 0.03, valueRaise: 0.55, checkRaise: 0.08 },
    thresholds: { thinValueStrength: 0.54, valueBetStrength: 0.68, valueRaiseStrength: 0.84 },
  },
  balanced: {
    target: 'balanced',
    frequencies: { cBetFlop: 0.62, turnBarrel: 0.5, riverBarrel: 0.36, semiBluff: 0.55, pureBluff: 0.1, valueRaise: 0.7, checkRaise: 0.22 },
    thresholds: { thinValueStrength: 0.48, valueBetStrength: 0.62, valueRaiseStrength: 0.78 },
  },
  'value-first': {
    target: 'value-first',
    frequencies: { cBetFlop: 0.58, turnBarrel: 0.55, riverBarrel: 0.45, semiBluff: 0.38, pureBluff: 0.04, valueRaise: 0.84, checkRaise: 0.24 },
    thresholds: { thinValueStrength: 0.43, valueBetStrength: 0.57, valueRaiseStrength: 0.72 },
  },
  'draw-pressure': {
    target: 'draw-pressure',
    frequencies: { cBetFlop: 0.68, turnBarrel: 0.58, riverBarrel: 0.42, semiBluff: 0.84, pureBluff: 0.1, valueRaise: 0.72, checkRaise: 0.34 },
    thresholds: { thinValueStrength: 0.49, valueBetStrength: 0.62, valueRaiseStrength: 0.78 },
  },
} as const

const DEFENSE = {
  selective: { mdfAdherence: 0.55, foldBias: 0.16, drawWeight: 0.55, potOddsDiscipline: 0.9 },
  balanced: { mdfAdherence: 0.78, foldBias: 0, drawWeight: 0.74, potOddsDiscipline: 0.84 },
  sticky: { mdfAdherence: 0.96, foldBias: -0.18, drawWeight: 0.88, potOddsDiscipline: 0.72 },
} as const

const CONTEXT = {
  straightforward: { positionBonus: 0.03, multiwayPenalty: 0.1, rangeAdvantageWeight: 0.22 },
  'position-aware': { positionBonus: 0.16, multiwayPenalty: 0.1, rangeAdvantageWeight: 0.38 },
  'multiway-cautious': { positionBonus: 0.08, multiwayPenalty: 0.24, rangeAdvantageWeight: 0.32 },
} as const

export function compileSimpleStrategyProfile(
  source: NpcStrategyProfile,
  intent: NpcSimpleStrategyIntent,
): NpcStrategyProfile {
  const preflop = PREFLOP[intent.preflopStyle]
  const pressure = PRESSURE[intent.pressure]
  const plan = PLAN[intent.postflopPlan]
  const sizing = SIZING[intent.sizing]
  const defense = DEFENSE[intent.defense]
  const context = CONTEXT[intent.context]
  const target = targetFor(intent)
  const preflopIdentity = source.preflopStrategy ?? { id: `${source.id}-preflop`, version: source.version }
  const postflopIdentity = source.postflopStrategy ?? { id: `${source.id}-postflop`, version: source.version }

  return {
    ...clone(source),
    calibrationTarget: createNpcStrategyCalibrationTarget(target),
    modules: compileModules(source.modules, intent),
    policyConfig: {
      preflopAggression: pressure.aggression,
      preflopLooseness: preflop.looseness,
      postflopAggression: pressure.postflopAggression,
      pressureRaiseMultiplier: pressure.raiseMultiplier,
    },
    preflopStrategy: createMultiFormatPreflopStrategy({
      id: preflopIdentity.id,
      version: preflopIdentity.version,
      description: describeSimpleStrategyIntent(intent),
      looseness: preflop.looseness,
      aggression: pressure.aggression,
      sizing: sizing.preflop,
    }),
    postflopStrategy: createPostflopStrategy({
      id: postflopIdentity.id,
      version: postflopIdentity.version,
      description: describeSimpleStrategyIntent(intent),
      aggression: pressure.postflopAggression,
      frequencies: plan.frequencies,
      sizing: sizing.postflop,
      thresholds: plan.thresholds,
      modifiers: {
        rangeAdvantageWeight: context.rangeAdvantageWeight,
        positionBonus: context.positionBonus,
        multiwayPenalty: context.multiwayPenalty,
        wetBoardBluffPenalty: intent.postflopPlan === 'draw-pressure' ? 0.05 : 0.14,
        shortStackAggressionBonus: intent.pressure === 'high' ? 0.18 : 0.08,
      },
      defense: {
        ...defense,
        madeHandWeight: intent.postflopPlan === 'value-first' ? 0.9 : 0.76,
        positionBonus: context.positionBonus,
        rangeDisadvantagePenalty: intent.context === 'straightforward' ? 0.24 : 0.34,
        multiwayPenalty: context.multiwayPenalty,
        shortStackCommitmentBonus: intent.pressure === 'high' ? 0.2 : 0.12,
      },
    }),
  }
}

export function previewSimpleStrategyChange(
  source: NpcStrategyProfile,
  intent: NpcSimpleStrategyIntent,
): NpcSimpleStrategyPreview {
  const compiled = compileSimpleStrategyProfile(source, intent)
  const sourceReport = validateNpcStrategyBehavior(source)
  const compiledReport = validateNpcStrategyBehavior(compiled)
  const before = sourceReport.calibration
  const after = compiledReport.calibration
  return {
    sentence: describeSimpleStrategyIntent(intent),
    targetName: label(targetFor(intent)),
    metrics: [
      metric('VPIP', before.preflop.vpipRate.value, after.preflop.vpipRate.value),
      metric('Open raise', before.preflop.openRaiseRate.value, after.preflop.openRaiseRate.value),
      metric('Three-bet', before.preflop.threeBetRate.value, after.preflop.threeBetRate.value),
      metric('Continuation bet', before.postflopProactive.continuationBetRate, after.postflopProactive.continuationBetRate),
      metric('Barrel', before.postflopProactive.barrelRate, after.postflopProactive.barrelRate),
      metric('Continue versus bet', before.postflopDefense.expectedContinueRate, after.postflopDefense.expectedContinueRate),
    ],
    changedModules: changedModuleLabels(source, compiled),
    warnings: compiledReport.issues
      .filter((issue) => issue.severity === 'error' || issue.severity === 'warning')
      .map((issue) => issue.message),
  }
}

export function inferSimpleStrategyIntent(profile: NpcStrategyProfile): NpcSimpleStrategyIntent {
  const target = profile.calibrationTarget?.presetId
  return {
    preflopStyle: nearest(profile.policyConfig.preflopLooseness, { tight: 0.24, balanced: 0.36, loose: 0.48 }),
    pressure: nearest(profile.policyConfig.preflopAggression, { low: 0.38, balanced: 0.58, high: 0.78 }),
    postflopPlan: target === 'pot-control' || target === 'value-first' || target === 'draw-pressure' ? target : 'balanced',
    defense: nearest(profile.postflopStrategy?.defense?.mdfAdherence ?? 0.78, { selective: 0.55, balanced: 0.78, sticky: 0.96 }),
    sizing: nearest(profile.postflopStrategy?.sizing.dryFlopPotFraction ?? 0.42, { small: 0.33, mixed: 0.42, large: 0.55 }),
    context: nearest(profile.postflopStrategy?.modifiers.positionBonus ?? 0.08, { straightforward: 0.03, 'position-aware': 0.16, 'multiway-cautious': 0.08 }),
  }
}

export function describeSimpleStrategyIntent(intent: NpcSimpleStrategyIntent): string {
  return `Play ${label(intent.preflopStyle)} preflop ranges with ${label(intent.pressure)} pressure, use a ${label(intent.postflopPlan)} postflop plan, defend ${label(intent.defense)}, prefer ${label(intent.sizing)} sizing, and stay ${label(intent.context)}.`
}

function targetFor(intent: NpcSimpleStrategyIntent): Exclude<NpcStrategyTargetPresetId, 'custom'> {
  if (intent.postflopPlan === 'balanced' && intent.pressure === 'high') return 'pressure'
  return PLAN[intent.postflopPlan].target
}

function compileModules(current: NpcStrategyModule[], intent: NpcSimpleStrategyIntent): NpcStrategyModule[] {
  const weights: Partial<Record<NpcStrategyModuleId, number>> = {
    'preflop-range': 0.8,
    'preflop-pressure': intent.pressure === 'high' ? 0.9 : intent.pressure === 'low' ? 0.3 : 0.6,
    'postflop-made-hand': intent.postflopPlan === 'value-first' ? 0.9 : 0.65,
    'draw-selection': intent.postflopPlan === 'draw-pressure' ? 0.95 : 0.55,
    'pot-control': intent.postflopPlan === 'pot-control' ? 0.95 : 0.45,
    'value-pressure': intent.postflopPlan === 'value-first' ? 0.9 : 0.55,
    'continuation-bet': intent.postflopPlan === 'pot-control' ? 0.45 : 0.75,
    'probe-bet': intent.pressure === 'high' ? 0.7 : 0.45,
    'barrel-selection': intent.postflopPlan === 'pot-control' ? 0.3 : 0.72,
    'bluff-selection': intent.postflopPlan === 'draw-pressure' ? 0.8 : intent.postflopPlan === 'value-first' ? 0.3 : 0.55,
    'mdf-defense': intent.defense === 'sticky' ? 0.95 : intent.defense === 'selective' ? 0.55 : 0.78,
  }
  const currentById = new Map(current.map((module) => [module.id, module]))
  return (Object.keys(weights) as NpcStrategyModuleId[]).map((id) => ({
    ...currentById.get(id),
    id,
    enabled: true,
    weight: weights[id] ?? 0.5,
  }))
}

function metric(labelText: string, before: number, after: number) {
  return { label: labelText, before, after }
}

function changedModuleLabels(source: NpcStrategyProfile, compiled: NpcStrategyProfile): string[] {
  const sourceById = new Map(source.modules.map((module) => [module.id, module]))
  return compiled.modules
    .filter((module) => {
      const before = sourceById.get(module.id)
      return !before || before.enabled !== module.enabled || before.weight !== module.weight
    })
    .map((module) => label(module.id))
}

function nearest<TKey extends string>(value: number, choices: Record<TKey, number>): TKey {
  return (Object.entries(choices) as Array<[TKey, number]>).reduce((best, candidate) =>
    Math.abs(candidate[1] - value) < Math.abs(best[1] - value) ? candidate : best)[0]
}

function label(value: string): string {
  return value.replaceAll('-', ' ')
}

function clone<T>(value: T): T {
  return structuredClone(value)
}
