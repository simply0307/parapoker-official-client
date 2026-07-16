import type {
  Card,
  PositionLabel,
  PrivateSeatView,
  Street,
} from '../poker-engine'
import type { Rng } from '../shared/rng'
import type {
  NpcPreflopAction,
  NpcPreflopFormat,
  NpcPreflopRangeNode,
  NpcPreflopStackDepth,
  NpcPreflopStrategy,
  NpcPreflopSituation,
  NpcStrategyProfile,
} from './config'
import { simulatePostflopDefenseScenario } from './npcScenarioSimulator'
import {
  chooseProactivePostflopDecision,
  type NpcPostflopHandAssessment,
  type NpcProactivePostflopReason,
} from './postflopStrategy'
import type { NpcBoardTexture, NpcRangeBucketWeights, NpcRangeState } from './rangeTracking'

export type NpcCalibrationTexture = Exclude<NpcBoardTexture, 'none'>
export type NpcCalibrationTableShape = 'all' | 'heads-up' | 'multiway'
export type NpcCalibrationBetSize = 'all' | 'small' | 'medium' | 'large'

export interface NpcCalibrationFilters {
  format: 'all' | NpcPreflopFormat
  stackDepth: 'all' | NpcPreflopStackDepth
  position: 'all' | PositionLabel
  situation: 'all' | NpcPreflopSituation
  texture: 'all' | NpcCalibrationTexture
  tableShape: NpcCalibrationTableShape
  betSize: NpcCalibrationBetSize
}

export interface NpcCalibrationMetric {
  value: number
  sampleWeight: number
}

export interface NpcStrategyCalibrationReport {
  schemaVersion: 'npc-calibration-v1'
  profileId: string
  profileVersion: number
  filters: NpcCalibrationFilters
  preflop: {
    nodeCount: number
    comboSamples: number
    vpipRate: NpcCalibrationMetric
    openRaiseRate: NpcCalibrationMetric
    threeBetRate: NpcCalibrationMetric
    squeezeRate: NpcCalibrationMetric
    foldToThreeBetRate: NpcCalibrationMetric
  }
  postflopDefense: {
    scenarioCount: number
    expectedContinueRate: number
    smallBetContinueRate: number
    largeBetContinueRate: number
    drawContinueRate: number
    bluffCatchContinueRate: number
    headsUpContinueRate: number
    multiwayContinueRate: number
  }
  postflopProactive: {
    scenarioCount: number
    betRate: number
    continuationBetRate: number
    barrelRate: number
    probeBetRate: number
    semiBluffRate: number
    valueBetRate: number
    bluffBetRate: number
    averagePotFraction: number
  }
}

export const DEFAULT_NPC_CALIBRATION_FILTERS: NpcCalibrationFilters = {
  format: 'all',
  stackDepth: 'all',
  position: 'all',
  situation: 'all',
  texture: 'all',
  tableShape: 'all',
  betSize: 'all',
}

export function calibrateNpcStrategy(
  profile: NpcStrategyProfile,
  filters: NpcCalibrationFilters = DEFAULT_NPC_CALIBRATION_FILTERS,
): NpcStrategyCalibrationReport {
  const stableFilters = { ...filters }
  return {
    schemaVersion: 'npc-calibration-v1',
    profileId: profile.id,
    profileVersion: profile.version,
    filters: stableFilters,
    preflop: calibratePreflop(profile.preflopStrategy, stableFilters),
    postflopDefense: calibrateDefense(profile, stableFilters),
    postflopProactive: calibrateProactive(profile, stableFilters),
  }
}

function calibratePreflop(
  strategy: NpcPreflopStrategy | undefined,
  filters: NpcCalibrationFilters,
): NpcStrategyCalibrationReport['preflop'] {
  const nodes = strategy?.nodes.filter((node) => matchesPreflopFilters(node, filters)) ?? []
  const allHands = handSamples(nodes)
  return {
    nodeCount: nodes.length,
    comboSamples: allHands.reduce((sum, sample) => sum + sample.weight, 0),
    vpipRate: actionMetric(allHands, ['call', 'raise', 'allIn']),
    openRaiseRate: actionMetric(handSamples(nodesForSituation(nodes, 'unopened')), ['raise', 'allIn']),
    threeBetRate: actionMetric(handSamples(nodesForSituation(nodes, 'facingOpen')), ['raise', 'allIn']),
    squeezeRate: actionMetric(handSamples(nodesForSituation(nodes, 'facingOpenWithCallers')), ['raise', 'allIn']),
    foldToThreeBetRate: actionMetric(handSamples(nodesForSituation(nodes, 'facingThreeBet')), ['fold']),
  }
}

function calibrateDefense(
  profile: NpcStrategyProfile,
  filters: NpcCalibrationFilters,
): NpcStrategyCalibrationReport['postflopDefense'] {
  if (!profile.postflopStrategy) {
    return emptyDefenseReport()
  }
  const results: DefenseSample[] = []
  for (const betToPot of calibrationBetSizes(filters.betSize)) {
    for (const madeStrength of [0.18, 0.38, 0.58, 0.82]) {
      for (const draw of ['none', 'draw', 'strongDraw'] as const) {
        for (const texture of calibrationTextures(filters.texture)) {
          for (const heroPosition of ['BB', 'BTN'] as const) {
            for (const opponentCount of calibrationOpponentCounts(filters.tableShape)) {
              for (const [heroRangeTop, opponentRangeTop] of [[0.22, 0.42], [0.42, 0.22]] as const) {
                const result = simulatePostflopDefenseScenario(profile, {
                  potBeforeWager: 100,
                  wager: Math.round(100 * betToPot),
                  heroStack: 250,
                  madeStrength,
                  draw,
                  boardTexture: texture,
                  heroPosition,
                  opponentCount,
                  heroRangeTop,
                  opponentRangeTop,
                  roll: 0.5,
                })
                if (result.ok) {
                  results.push({
                    continueRate: result.decision.continueProbability,
                    betToPot,
                    madeStrength,
                    draw,
                    opponentCount,
                  })
                }
              }
            }
          }
        }
      }
    }
  }
  return {
    scenarioCount: results.length,
    expectedContinueRate: average(results.map((sample) => sample.continueRate)),
    smallBetContinueRate: average(results.filter((sample) => sample.betToPot <= 0.33).map((sample) => sample.continueRate)),
    largeBetContinueRate: average(results.filter((sample) => sample.betToPot >= 0.75).map((sample) => sample.continueRate)),
    drawContinueRate: average(results.filter((sample) => sample.draw !== 'none').map((sample) => sample.continueRate)),
    bluffCatchContinueRate: average(results.filter((sample) => sample.draw === 'none' && sample.madeStrength <= 0.38).map((sample) => sample.continueRate)),
    headsUpContinueRate: average(results.filter((sample) => sample.opponentCount === 1).map((sample) => sample.continueRate)),
    multiwayContinueRate: average(results.filter((sample) => sample.opponentCount > 1).map((sample) => sample.continueRate)),
  }
}

function calibrateProactive(
  profile: NpcStrategyProfile,
  filters: NpcCalibrationFilters,
): NpcStrategyCalibrationReport['postflopProactive'] {
  const strategy = profile.postflopStrategy
  if (!strategy) {
    return emptyProactiveReport()
  }
  const samples: ProactiveSample[] = []
  const lines: ProactiveLine[] = [
    'continuationBet',
    'turnBarrel',
    'riverBarrel',
    'probeBet',
    'semiBluff',
    'valueBet',
    'pureBluff',
  ]
  for (const line of lines) {
    for (const texture of calibrationTextures(filters.texture)) {
      for (const heroPosition of ['BB', 'BTN'] as const) {
        for (const opponentCount of calibrationOpponentCounts(filters.tableShape)) {
          for (const [heroRangeTop, opponentRangeTop] of [[0.22, 0.42], [0.42, 0.22]] as const) {
            for (let rollIndex = 0; rollIndex < 20; rollIndex += 1) {
              const roll = (rollIndex + 0.5) / 20
              const decision = proactiveDecision(profile, {
                line,
                texture,
                heroPosition,
                opponentCount,
                heroRangeTop,
                opponentRangeTop,
                roll,
              })
              samples.push({
                line,
                bet: Boolean(decision),
                reason: decision?.reason,
                potFraction: decision?.potFraction,
              })
            }
          }
        }
      }
    }
  }
  return {
    scenarioCount: samples.length,
    betRate: rate(samples, (sample) => sample.bet),
    continuationBetRate: lineBetRate(samples, 'continuationBet'),
    barrelRate: rate(samples.filter((sample) => sample.line === 'turnBarrel' || sample.line === 'riverBarrel'), (sample) => sample.bet),
    probeBetRate: lineBetRate(samples, 'probeBet'),
    semiBluffRate: lineBetRate(samples, 'semiBluff'),
    valueBetRate: lineBetRate(samples, 'valueBet'),
    bluffBetRate: lineBetRate(samples, 'pureBluff'),
    averagePotFraction: average(samples.flatMap((sample) => sample.potFraction === undefined ? [] : [sample.potFraction])),
  }
}

type ProactiveLine =
  | 'continuationBet'
  | 'turnBarrel'
  | 'riverBarrel'
  | 'probeBet'
  | 'semiBluff'
  | 'valueBet'
  | 'pureBluff'

interface ProactiveScenario {
  line: ProactiveLine
  texture: NpcCalibrationTexture
  heroPosition: 'BB' | 'BTN'
  opponentCount: number
  heroRangeTop: number
  opponentRangeTop: number
  roll: number
}

function proactiveDecision(profile: NpcStrategyProfile, scenario: ProactiveScenario) {
  if (!profile.postflopStrategy) {
    return undefined
  }
  const street: Exclude<Street, 'preflop' | 'showdown'> = scenario.line === 'turnBarrel'
    ? 'turn'
    : scenario.line === 'riverBarrel'
      ? 'river'
      : 'flop'
  const assessment = proactiveAssessment(scenario.line)
  const view = proactiveView(street, scenario)
  return chooseProactivePostflopDecision({
    view,
    legalActions: view.legalActions,
    strategy: profile.postflopStrategy,
    rangeState: proactiveRangeState(street, scenario),
    assessment,
    rng: fixedRng(scenario.roll),
  })
}

function proactiveAssessment(line: ProactiveLine): NpcPostflopHandAssessment {
  if (line === 'valueBet') {
    return { madeStrength: 0.72, hasStrongDraw: false, hasAnyDraw: false, boardWetness: 0 }
  }
  if (line === 'semiBluff') {
    return { madeStrength: 0.24, hasStrongDraw: true, hasAnyDraw: true, boardWetness: 2 }
  }
  return { madeStrength: 0.2, hasStrongDraw: false, hasAnyDraw: false, boardWetness: 0 }
}

function proactiveView(
  street: Exclude<Street, 'preflop' | 'showdown'>,
  scenario: ProactiveScenario,
): PrivateSeatView {
  return {
    status: 'handInProgress',
    handNumber: 1,
    street,
    communityCards: communityCards(street, scenario.texture),
    pot: 100,
    currentBet: 0,
    minRaise: 2,
    pendingSeatId: 'hero',
    seats: [
      calibrationSeat('hero', scenario.heroPosition, 250, scenario.heroPosition === 'BTN'),
      ...Array.from({ length: scenario.opponentCount }, (_, index) =>
        calibrationSeat(`villain-${index + 1}`, index === 0 ? 'BB' : 'BTN', 250, scenario.heroPosition !== 'BTN' && index === 0)),
    ],
    events: [],
    heroSeatId: 'hero',
    holeCards: [card('K', 'clubs'), card('Q', 'clubs')],
    legalActions: [{ type: 'check' }, { type: 'bet', min: 2, max: 250 }],
  }
}

function proactiveRangeState(
  street: Exclude<Street, 'preflop' | 'showdown'>,
  scenario: ProactiveScenario,
): NpcRangeState {
  const initiative = scenario.line !== 'probeBet' && scenario.line !== 'pureBluff'
  const lastAggressiveStreet: Street | undefined = scenario.line === 'turnBarrel'
    ? 'flop'
    : scenario.line === 'riverBarrel'
      ? 'turn'
      : initiative
        ? 'preflop'
        : undefined
  return {
    schemaVersion: 'npc-range-state-v1',
    handNumber: 1,
    street,
    heroSeatId: 'hero',
    boardTexture: scenario.texture,
    communityCardCount: street === 'flop' ? 3 : street === 'turn' ? 4 : 5,
    processedThroughSequenceNumber: 0,
    seats: {
      hero: calibrationRangeSeat('hero', scenario.heroPosition, scenario.heroRangeTop, true, {
        initiative,
        ...(lastAggressiveStreet ? { lastAggressiveStreet } : {}),
      }),
      ...Object.fromEntries(Array.from({ length: scenario.opponentCount }, (_, index) => {
        const id = `villain-${index + 1}`
        return [id, calibrationRangeSeat(id, index === 0 ? 'BB' : 'BTN', scenario.opponentRangeTop, false, {
          initiative: false,
          ...(scenario.line === 'probeBet' ? { lastAction: 'check' as const } : {}),
        })]
      })),
    },
  }
}

function matchesPreflopFilters(node: NpcPreflopRangeNode, filters: NpcCalibrationFilters): boolean {
  return (filters.format === 'all' || node.formats.includes(filters.format)) &&
    (filters.stackDepth === 'all' || node.stackDepths.includes(filters.stackDepth)) &&
    (filters.position === 'all' || node.positions.includes(filters.position)) &&
    (filters.situation === 'all' || node.situations.includes(filters.situation))
}

function nodesForSituation(nodes: NpcPreflopRangeNode[], situation: NpcPreflopSituation): NpcPreflopRangeNode[] {
  return nodes.filter((node) => node.situations.includes(situation))
}

interface HandSample {
  weight: number
  frequencies: Partial<Record<NpcPreflopAction, number>>
}

function handSamples(nodes: NpcPreflopRangeNode[]): HandSample[] {
  return nodes.flatMap((node) => Object.entries(node.hands).map(([handClass, mix]) => ({
    weight: handCombinationCount(handClass),
    frequencies: Object.fromEntries(mix.map((entry) => [entry.action, entry.frequency])),
  })))
}

function handCombinationCount(handClass: string): number {
  if (handClass.length === 2) {
    return 6
  }
  return handClass.endsWith('s') ? 4 : 12
}

function actionMetric(samples: HandSample[], actions: NpcPreflopAction[]): NpcCalibrationMetric {
  const sampleWeight = samples.reduce((sum, sample) => sum + sample.weight, 0)
  const weightedActions = samples.reduce((sum, sample) => sum + sample.weight * actions.reduce(
    (actionSum, action) => actionSum + (sample.frequencies[action] ?? 0),
    0,
  ), 0)
  return { value: sampleWeight > 0 ? round(weightedActions / sampleWeight) : 0, sampleWeight }
}

interface DefenseSample {
  continueRate: number
  betToPot: number
  madeStrength: number
  draw: 'none' | 'draw' | 'strongDraw'
  opponentCount: number
}

interface ProactiveSample {
  line: ProactiveLine
  bet: boolean
  reason?: NpcProactivePostflopReason
  potFraction?: number
}

function calibrationBetSizes(filter: NpcCalibrationBetSize): number[] {
  if (filter === 'small') return [0.25]
  if (filter === 'medium') return [0.5]
  if (filter === 'large') return [0.75, 1]
  return [0.25, 0.5, 0.75, 1]
}

function calibrationTextures(filter: NpcCalibrationFilters['texture']): NpcCalibrationTexture[] {
  return filter === 'all' ? ['dry', 'dynamic', 'wet', 'paired'] : [filter]
}

function calibrationOpponentCounts(filter: NpcCalibrationTableShape): number[] {
  if (filter === 'heads-up') return [1]
  if (filter === 'multiway') return [2]
  return [1, 2]
}

function lineBetRate(samples: ProactiveSample[], line: ProactiveLine): number {
  return rate(samples.filter((sample) => sample.line === line), (sample) => sample.bet)
}

function rate<T>(samples: T[], predicate: (sample: T) => boolean): number {
  return samples.length > 0 ? round(samples.filter(predicate).length / samples.length) : 0
}

function average(values: number[]): number {
  return values.length > 0 ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0
}

function emptyDefenseReport(): NpcStrategyCalibrationReport['postflopDefense'] {
  return {
    scenarioCount: 0,
    expectedContinueRate: 0,
    smallBetContinueRate: 0,
    largeBetContinueRate: 0,
    drawContinueRate: 0,
    bluffCatchContinueRate: 0,
    headsUpContinueRate: 0,
    multiwayContinueRate: 0,
  }
}

function emptyProactiveReport(): NpcStrategyCalibrationReport['postflopProactive'] {
  return {
    scenarioCount: 0,
    betRate: 0,
    continuationBetRate: 0,
    barrelRate: 0,
    probeBetRate: 0,
    semiBluffRate: 0,
    valueBetRate: 0,
    bluffBetRate: 0,
    averagePotFraction: 0,
  }
}

function calibrationSeat(id: string, position: PositionLabel, stack: number, isDealer: boolean): PrivateSeatView['seats'][number] {
  return {
    id,
    name: id,
    kind: 'npc',
    position,
    stack,
    status: 'active',
    streetContribution: 0,
    totalContribution: 0,
    isDealer,
    isSmallBlind: position === 'SB',
    isBigBlind: position === 'BB',
  }
}

function calibrationRangeSeat(
  seatId: string,
  position: PositionLabel,
  top: number,
  hero: boolean,
  context: { initiative: boolean; lastAction?: 'check'; lastAggressiveStreet?: Street },
): NpcRangeState['seats'][string] {
  const premium = top * 0.35
  const strong = top - premium
  const remainder = 1 - top
  const weights: NpcRangeBucketWeights = {
    premium,
    strong,
    medium: remainder * 0.35,
    draw: remainder * 0.25,
    weak: remainder * 0.4,
  }
  return {
    seatId,
    position,
    source: hero ? 'hero-private' : 'public-inference',
    active: true,
    rangeWidth: 0.45,
    weights,
    initiative: context.initiative,
    actionsObserved: 1,
    ...(context.lastAction ? { lastAction: context.lastAction } : {}),
    ...(context.lastAggressiveStreet ? { lastAggressiveStreet: context.lastAggressiveStreet } : {}),
    ...(hero ? { knownHandClass: 'KQo' } : {}),
  }
}

function communityCards(street: Exclude<Street, 'preflop' | 'showdown'>, texture: NpcCalibrationTexture): Card[] {
  const flop = texture === 'wet'
    ? [card('9', 'hearts'), card('8', 'hearts'), card('7', 'clubs')]
    : texture === 'dynamic'
      ? [card('J', 'spades'), card('T', 'spades'), card('4', 'diamonds')]
      : texture === 'paired'
        ? [card('8', 'spades'), card('8', 'diamonds'), card('2', 'clubs')]
        : [card('A', 'spades'), card('7', 'diamonds'), card('2', 'clubs')]
  return street === 'flop'
    ? flop
    : street === 'turn'
      ? [...flop, card('3', 'clubs')]
      : [...flop, card('3', 'clubs'), card('Q', 'diamonds')]
}

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit }
}

function fixedRng(value: number): Rng {
  return { next: () => value, state: () => Math.round(value * 1_000_000) }
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
