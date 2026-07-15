import type {
  Card,
  EngineCommand,
  LegalAction,
  PositionLabel,
  PrivateSeatView,
  Rank,
} from '../poker-engine'
import type { Rng } from '../shared/rng'
import type {
  NpcPreflopAction,
  NpcPreflopActionFrequency,
  NpcPreflopFormat,
  NpcPreflopRaiseSizeBucket,
  NpcPreflopRangeNode,
  NpcPreflopSituation,
  NpcPreflopSizingConfig,
  NpcPreflopStackDepth,
  NpcPreflopStrategy,
} from './config'

const RANKS: Rank[] = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const RANK_VALUE = Object.fromEntries(RANKS.map((rank, index) => [rank, 14 - index])) as Record<Rank, number>

const DEFAULT_SIZING: NpcPreflopSizingConfig = {
  openRaiseBigBlinds: 2.5,
  isolationRaiseBigBlinds: 3,
  threeBetInPositionMultiplier: 3.2,
  threeBetOutOfPositionMultiplier: 3.8,
  fourBetMultiplier: 2.35,
}

export interface CreateHeadsUpPreflopStrategyInput {
  id: string
  version?: number
  description?: string
  looseness: number
  aggression: number
  sizing?: Partial<NpcPreflopSizingConfig>
}

export interface PreflopSpot {
  format: NpcPreflopFormat
  position?: PositionLabel
  stackDepth: NpcPreflopStackDepth
  situation: NpcPreflopSituation
  raiseSizeBucket: NpcPreflopRaiseSizeBucket
  bigBlind: number
  effectiveStackBigBlinds: number
}

export interface PreflopDecisionInput {
  view: PrivateSeatView
  legalActions: LegalAction[]
  strategy: NpcPreflopStrategy
  rng: Rng
}

export interface PreflopRangeDecision {
  command: EngineCommand
  nodeId: string
  handClass: string
  spot: PreflopSpot
  selectedAction: NpcPreflopAction
  legalFrequencies: NpcPreflopActionFrequency[]
}

export function allPreflopHandClasses(): string[] {
  const classes: string[] = []
  for (let highIndex = 0; highIndex < RANKS.length; highIndex += 1) {
    for (let lowIndex = highIndex; lowIndex < RANKS.length; lowIndex += 1) {
      const high = RANKS[highIndex]
      const low = RANKS[lowIndex]
      if (high === low) {
        classes.push(`${high}${low}`)
      } else {
        classes.push(`${high}${low}s`, `${high}${low}o`)
      }
    }
  }
  return classes
}

export function toPreflopHandClass(cards: Card[]): string {
  if (cards.length !== 2) {
    throw new Error('A preflop hand class requires exactly two cards.')
  }
  const [first, second] = [...cards].sort((left, right) => RANK_VALUE[right.rank] - RANK_VALUE[left.rank])
  if (first.rank === second.rank) {
    return `${first.rank}${second.rank}`
  }
  return `${first.rank}${second.rank}${first.suit === second.suit ? 's' : 'o'}`
}

export function createHeadsUpPreflopStrategy(input: CreateHeadsUpPreflopStrategyInput): NpcPreflopStrategy {
  const looseness = clamp01(input.looseness)
  const aggression = clamp01(input.aggression)
  const nodes: NpcPreflopRangeNode[] = []

  for (const stackDepth of ['short', 'medium', 'deep'] as const) {
    nodes.push(
      createNode(`hu-btn-unopened-${stackDepth}`, ['BTN/SB'], stackDepth, 'unopened', undefined, (score) =>
        buttonUnopenedMix(score, stackDepth, looseness, aggression)),
      createNode(`hu-bb-vs-limp-${stackDepth}`, ['BB'], stackDepth, 'facingLimp', undefined, (score) =>
        bigBlindVsLimpMix(score, stackDepth, aggression)),
      createNode(`hu-bb-vs-small-open-${stackDepth}`, ['BB'], stackDepth, 'facingOpen', ['small'], (score) =>
        bigBlindVsOpenMix(score, stackDepth, 'small', looseness, aggression)),
      createNode(`hu-bb-vs-medium-open-${stackDepth}`, ['BB'], stackDepth, 'facingOpen', ['medium'], (score) =>
        bigBlindVsOpenMix(score, stackDepth, 'medium', looseness, aggression)),
      createNode(`hu-bb-vs-large-open-${stackDepth}`, ['BB'], stackDepth, 'facingOpen', ['large', 'allIn'], (score) =>
        bigBlindVsOpenMix(score, stackDepth, 'large', looseness, aggression)),
      createNode(`hu-btn-vs-limp-raise-${stackDepth}`, ['BTN/SB'], stackDepth, 'facingRaiseAfterLimp', undefined, (score) =>
        buttonVsLimpRaiseMix(score, stackDepth, looseness, aggression)),
      createNode(`hu-vs-three-bet-${stackDepth}`, ['BTN/SB', 'BB'], stackDepth, 'facingThreeBet', undefined, (score) =>
        versusThreeBetMix(score, stackDepth, looseness, aggression)),
      createNode(`hu-vs-four-bet-${stackDepth}`, ['BTN/SB', 'BB'], stackDepth, 'facingFourBet', undefined, (score) =>
        versusFourBetMix(score, stackDepth, aggression)),
    )
  }

  return {
    schemaVersion: 'npc-preflop-v1',
    id: input.id.trim(),
    version: input.version ?? 1,
    ...(input.description ? { description: input.description } : {}),
    nodes,
    sizing: { ...DEFAULT_SIZING, ...input.sizing },
  }
}

export function analyzePreflopSpot(view: PrivateSeatView): PreflopSpot {
  const activeSeats = view.seats.filter((seat) => seat.status !== 'out')
  const hero = view.seats.find((seat) => seat.id === view.heroSeatId)
  const position = hero?.position
  const bigBlind = findPostedBigBlind(view)
  const effectiveStack = getEffectiveStackAtStreetStart(view)
  const effectiveStackBigBlinds = effectiveStack / Math.max(1, bigBlind)
  const actionEvents = view.events.filter((event) => event.type === 'actionApplied')
  let highestTarget = bigBlind
  let aggressiveActions = 0
  let heroActed = false
  let limpSeen = false

  for (const event of actionEvents) {
    if (event.payload.seatId === view.heroSeatId) {
      heroActed = true
    }
    if (event.payload.action === 'call' && event.payload.targetContribution <= bigBlind) {
      limpSeen = true
    }
    if (event.payload.targetContribution > highestTarget) {
      aggressiveActions += 1
      highestTarget = event.payload.targetContribution
    }
  }

  const situation = preflopSituation(aggressiveActions, heroActed, limpSeen)
  return {
    format: activeSeats.length === 2 ? 'heads-up' : 'six-max',
    position,
    stackDepth: stackDepthFor(effectiveStackBigBlinds),
    situation,
    raiseSizeBucket: raiseSizeBucketFor(view.currentBet, bigBlind, effectiveStack),
    bigBlind,
    effectiveStackBigBlinds,
  }
}

export function choosePreflopRangeDecision(input: PreflopDecisionInput): PreflopRangeDecision | undefined {
  if (input.view.street !== 'preflop' || input.view.holeCards.length !== 2) {
    return undefined
  }
  const spot = analyzePreflopSpot(input.view)
  const node = input.strategy.nodes.find((candidate) => nodeMatches(candidate, spot))
  if (!node) {
    return undefined
  }
  const handClass = toPreflopHandClass(input.view.holeCards)
  const frequencies = node.hands[handClass]
  if (!frequencies) {
    return undefined
  }
  const legalFrequencies = normalizeMix(frequencies.filter((entry) => actionIsAvailable(entry.action, input.legalActions)))
  if (legalFrequencies.length === 0) {
    return undefined
  }
  const selectedAction = selectMixedAction(legalFrequencies, input.rng.next())
  const command = commandFor(selectedAction, input.view, input.legalActions, input.strategy.sizing, spot)
  if (!command) {
    return undefined
  }
  return { command, nodeId: node.id, handClass, spot, selectedAction, legalFrequencies }
}

export function validatePreflopStrategy(strategy: NpcPreflopStrategy): void {
  if (strategy.schemaVersion !== 'npc-preflop-v1') {
    throw new Error('NPC preflop strategy schema version is invalid.')
  }
  if (!strategy.id.trim()) {
    throw new Error('NPC preflop strategy requires an id.')
  }
  if (!Number.isInteger(strategy.version) || strategy.version < 1) {
    throw new Error('NPC preflop strategy version must be a positive integer.')
  }
  const expectedHands = allPreflopHandClasses()
  const nodeIds = new Set<string>()
  for (const node of strategy.nodes) {
    if (nodeIds.has(node.id)) {
      throw new Error(`Duplicate NPC preflop node: ${node.id}`)
    }
    nodeIds.add(node.id)
    if (Object.keys(node.hands).length !== expectedHands.length) {
      throw new Error(`NPC preflop node must define all 169 hand classes: ${node.id}`)
    }
    for (const handClass of expectedHands) {
      const frequencies = node.hands[handClass]
      if (!frequencies?.length) {
        throw new Error(`NPC preflop node is missing ${handClass}: ${node.id}`)
      }
      const total = frequencies.reduce((sum, entry) => sum + entry.frequency, 0)
      if (frequencies.some((entry) => entry.frequency < 0 || entry.frequency > 1) || Math.abs(total - 1) > 1e-8) {
        throw new Error(`NPC preflop frequencies must total one for ${handClass}: ${node.id}`)
      }
    }
  }
}

function createNode(
  id: string,
  positions: PositionLabel[],
  stackDepth: NpcPreflopStackDepth,
  situation: NpcPreflopSituation,
  raiseSizeBuckets: NpcPreflopRaiseSizeBucket[] | undefined,
  createMix: (score: number) => NpcPreflopActionFrequency[],
): NpcPreflopRangeNode {
  return {
    id,
    formats: ['heads-up'],
    positions,
    stackDepths: [stackDepth],
    situations: [situation],
    ...(raiseSizeBuckets ? { raiseSizeBuckets } : {}),
    hands: Object.fromEntries(allPreflopHandClasses().map((handClass) => [handClass, createMix(handClassScore(handClass))])),
  }
}

function buttonUnopenedMix(
  score: number,
  depth: NpcPreflopStackDepth,
  looseness: number,
  aggression: number,
): NpcPreflopActionFrequency[] {
  if (depth === 'short' && score >= 0.58) {
    return mix(['allIn', 0.35 + aggression * 0.35], ['raise', 0.25], ['call', 0.4 - aggression * 0.2])
  }
  if (score >= 0.82) {
    return mix(['raise', 0.78 + aggression * 0.12], ['call', 0.22 - aggression * 0.12])
  }
  if (score >= 0.62) {
    return mix(['raise', 0.5 + aggression * 0.3], ['call', 0.5 - aggression * 0.2], ['fold', 0.1 - looseness * 0.08])
  }
  if (score >= 0.42) {
    const play = 0.72 + looseness * 0.24
    const raise = 0.14 + aggression * 0.28
    return mix(['raise', raise], ['call', Math.max(0, play - raise)], ['fold', 1 - play])
  }
  const play = 0.45 + looseness * 0.45
  const raise = 0.04 + aggression * 0.14
  return mix(['raise', raise], ['call', Math.max(0, play - raise)], ['fold', 1 - play])
}

function bigBlindVsLimpMix(
  score: number,
  depth: NpcPreflopStackDepth,
  aggression: number,
): NpcPreflopActionFrequency[] {
  if (depth === 'short' && score >= 0.66) {
    return mix(['allIn', 0.35 + aggression * 0.35], ['raise', 0.2], ['check', 0.45 - aggression * 0.15])
  }
  if (score >= 0.82) {
    return mix(['raise', 0.78 + aggression * 0.15], ['check', 0.22 - aggression * 0.15])
  }
  if (score >= 0.62) {
    return mix(['raise', 0.3 + aggression * 0.38], ['check', 0.7 - aggression * 0.28])
  }
  if (score >= 0.42) {
    return mix(['raise', 0.08 + aggression * 0.22], ['check', 0.92 - aggression * 0.12])
  }
  return mix(['raise', 0.02 + aggression * 0.08], ['check', 0.98 - aggression * 0.08])
}

function bigBlindVsOpenMix(
  score: number,
  depth: NpcPreflopStackDepth,
  size: 'small' | 'medium' | 'large',
  looseness: number,
  aggression: number,
): NpcPreflopActionFrequency[] {
  if (depth === 'short' && score >= (size === 'large' ? 0.72 : 0.62)) {
    return mix(['allIn', 0.52 + aggression * 0.32], ['call', 0.38 - aggression * 0.12], ['fold', 0.1])
  }
  const sizePenalty = size === 'small' ? 0 : size === 'medium' ? 0.2 : 0.4
  if (score >= 0.82) {
    return mix(['raise', 0.6 + aggression * 0.28], ['call', 0.4 - aggression * 0.18], ['fold', sizePenalty * 0.08])
  }
  if (score >= 0.62) {
    return mix(
      ['raise', Math.max(0.04, 0.16 + aggression * 0.2 - sizePenalty * 0.15)],
      ['call', Math.max(0.28, 0.58 + looseness * 0.22 - sizePenalty * 0.48)],
      ['fold', 0.06 + sizePenalty * 0.45],
    )
  }
  if (score >= 0.42) {
    return mix(
      ['raise', Math.max(0.01, 0.05 + aggression * 0.12 - sizePenalty * 0.1)],
      ['call', Math.max(0.12, 0.4 + looseness * 0.35 - sizePenalty * 0.5)],
      ['fold', 0.2 + sizePenalty * 0.65],
    )
  }
  return mix(
    ['raise', Math.max(0, 0.02 + aggression * 0.05 - sizePenalty * 0.08)],
    ['call', Math.max(0.04, 0.15 + looseness * 0.4 - sizePenalty * 0.42)],
    ['fold', 0.45 + sizePenalty * 0.8],
  )
}

function buttonVsLimpRaiseMix(
  score: number,
  depth: NpcPreflopStackDepth,
  looseness: number,
  aggression: number,
): NpcPreflopActionFrequency[] {
  if (depth === 'short' && score >= 0.64) {
    return mix(['allIn', 0.48 + aggression * 0.3], ['call', 0.42 - aggression * 0.15], ['fold', 0.1])
  }
  if (score >= 0.82) {
    return mix(['raise', 0.48 + aggression * 0.35], ['call', 0.5 - aggression * 0.15], ['fold', 0.02])
  }
  if (score >= 0.58) {
    return mix(['call', 0.55 + looseness * 0.28], ['raise', aggression * 0.12], ['fold', 0.3 - looseness * 0.18])
  }
  return mix(['call', 0.12 + looseness * 0.35], ['fold', 0.88 - looseness * 0.2])
}

function versusThreeBetMix(
  score: number,
  depth: NpcPreflopStackDepth,
  looseness: number,
  aggression: number,
): NpcPreflopActionFrequency[] {
  if (depth === 'short' && score >= 0.7) {
    return mix(['allIn', 0.68 + aggression * 0.22], ['call', 0.32 - aggression * 0.12])
  }
  if (score >= 0.9) {
    return mix(['raise', 0.55 + aggression * 0.3], ['call', 0.45 - aggression * 0.2])
  }
  if (score >= 0.72) {
    return mix(['call', 0.55 + looseness * 0.2], ['raise', aggression * 0.12], ['fold', 0.3 - looseness * 0.12])
  }
  if (score >= 0.58) {
    return mix(['call', 0.18 + looseness * 0.28], ['fold', 0.82 - looseness * 0.15])
  }
  return mix(['fold', 0.94], ['call', 0.04 + looseness * 0.04], ['raise', aggression * 0.02])
}

function versusFourBetMix(
  score: number,
  depth: NpcPreflopStackDepth,
  aggression: number,
): NpcPreflopActionFrequency[] {
  if (score >= 0.93) {
    return depth === 'deep'
      ? mix(['allIn', 0.55 + aggression * 0.3], ['call', 0.45 - aggression * 0.15])
      : mix(['allIn', 0.82 + aggression * 0.15], ['call', 0.18 - aggression * 0.08])
  }
  if (score >= 0.8) {
    return mix(['call', 0.32], ['allIn', aggression * 0.18], ['fold', 0.6 - aggression * 0.08])
  }
  return mix(['fold', 0.97], ['allIn', aggression * 0.03])
}

function handClassScore(handClass: string): number {
  const high = RANK_VALUE[handClass[0] as Rank]
  const low = RANK_VALUE[handClass[1] as Rank]
  if (handClass.length === 2) {
    return clamp01(0.55 + ((high - 2) / 12) * 0.45)
  }
  const suited = handClass.endsWith('s')
  const gap = high - low
  const broadway = high >= 10 && low >= 10
  return clamp01(
    ((high - 2) / 12) * 0.55 +
    ((low - 2) / 12) * 0.25 +
    (suited ? 0.08 : 0) +
    (gap === 1 ? 0.07 : gap === 2 ? 0.04 : 0) +
    (broadway ? 0.05 : 0) +
    (high === 14 ? 0.04 : 0),
  )
}

function mix(...entries: Array<[NpcPreflopAction, number]>): NpcPreflopActionFrequency[] {
  return normalizeMix(entries
    .filter(([, frequency]) => frequency > 0)
    .map(([action, frequency]) => ({ action, frequency })))
}

function normalizeMix(entries: NpcPreflopActionFrequency[]): NpcPreflopActionFrequency[] {
  const total = entries.reduce((sum, entry) => sum + entry.frequency, 0)
  if (total <= 0) {
    return []
  }
  return entries.map((entry) => ({ ...entry, frequency: entry.frequency / total }))
}

function selectMixedAction(entries: NpcPreflopActionFrequency[], roll: number): NpcPreflopAction {
  let cursor = 0
  for (const entry of entries) {
    cursor += entry.frequency
    if (roll < cursor) {
      return entry.action
    }
  }
  return entries[entries.length - 1].action
}

function nodeMatches(node: NpcPreflopRangeNode, spot: PreflopSpot): boolean {
  return node.formats.includes(spot.format) &&
    Boolean(spot.position && node.positions.includes(spot.position)) &&
    node.stackDepths.includes(spot.stackDepth) &&
    node.situations.includes(spot.situation) &&
    (!node.raiseSizeBuckets || node.raiseSizeBuckets.includes(spot.raiseSizeBucket))
}

function actionIsAvailable(action: NpcPreflopAction, legalActions: LegalAction[]): boolean {
  if (action === 'raise') {
    return legalActions.some((legal) => legal.type === 'raise' || legal.type === 'bet')
  }
  return legalActions.some((legal) => legal.type === action)
}

function commandFor(
  action: NpcPreflopAction,
  view: PrivateSeatView,
  legalActions: LegalAction[],
  sizing: NpcPreflopSizingConfig,
  spot: PreflopSpot,
): EngineCommand | undefined {
  const seatId = view.heroSeatId
  if (action === 'raise') {
    const pressure = legalActions.find((legal): legal is Extract<LegalAction, { type: 'raise' | 'bet' }> =>
      legal.type === 'raise' || legal.type === 'bet')
    if (!pressure) {
      return undefined
    }
    const amount = raiseTarget(pressure, view, sizing, spot)
    return pressure.type === 'raise'
      ? { type: 'raise', seatId, amount, source: 'npc' }
      : { type: 'bet', seatId, amount, source: 'npc' }
  }
  if (action === 'fold' || action === 'check' || action === 'call' || action === 'allIn') {
    return { type: action, seatId, source: 'npc' }
  }
  return undefined
}

function raiseTarget(
  action: Extract<LegalAction, { type: 'raise' | 'bet' }>,
  view: PrivateSeatView,
  sizing: NpcPreflopSizingConfig,
  spot: PreflopSpot,
): number {
  let target = action.min
  if (spot.situation === 'unopened') {
    target = spot.bigBlind * sizing.openRaiseBigBlinds
  } else if (spot.situation === 'facingLimp') {
    target = spot.bigBlind * sizing.isolationRaiseBigBlinds
  } else if (spot.situation === 'facingOpen' || spot.situation === 'facingRaiseAfterLimp') {
    const inPosition = spot.position === 'BTN/SB' || spot.position === 'BTN'
    target = view.currentBet * (inPosition ? sizing.threeBetInPositionMultiplier : sizing.threeBetOutOfPositionMultiplier)
  } else if (spot.situation === 'facingThreeBet' || spot.situation === 'facingFourBet') {
    target = view.currentBet * sizing.fourBetMultiplier
  }
  return Math.min(action.max, Math.max(action.min, Math.round(target)))
}

function preflopSituation(aggressiveActions: number, heroActed: boolean, limpSeen: boolean): NpcPreflopSituation {
  if (aggressiveActions === 0) {
    return limpSeen ? 'facingLimp' : 'unopened'
  }
  if (aggressiveActions === 1) {
    return heroActed && limpSeen ? 'facingRaiseAfterLimp' : 'facingOpen'
  }
  if (aggressiveActions === 2) {
    return 'facingThreeBet'
  }
  return 'facingFourBet'
}

function stackDepthFor(bigBlinds: number): NpcPreflopStackDepth {
  if (bigBlinds <= 15) {
    return 'short'
  }
  if (bigBlinds <= 40) {
    return 'medium'
  }
  return 'deep'
}

function raiseSizeBucketFor(
  currentBet: number,
  bigBlind: number,
  effectiveStack: number,
): NpcPreflopRaiseSizeBucket {
  if (currentBet <= bigBlind) {
    return 'none'
  }
  if (currentBet >= effectiveStack) {
    return 'allIn'
  }
  const sizeInBigBlinds = currentBet / Math.max(1, bigBlind)
  if (sizeInBigBlinds <= 2.5) {
    return 'small'
  }
  if (sizeInBigBlinds <= 4) {
    return 'medium'
  }
  return 'large'
}

function findPostedBigBlind(view: PrivateSeatView): number {
  const event = [...view.events].reverse().find((candidate) =>
    candidate.type === 'blindPosted' && candidate.payload.blind === 'big')
  return event?.type === 'blindPosted' ? Math.max(1, event.payload.amount) : Math.max(1, view.minRaise)
}

function getEffectiveStackAtStreetStart(view: PrivateSeatView): number {
  const hero = view.seats.find((seat) => seat.id === view.heroSeatId)
  const heroStack = (hero?.stack ?? 0) + (hero?.streetContribution ?? 0)
  const opponents = view.seats
    .filter((seat) => seat.id !== view.heroSeatId && seat.status !== 'out')
    .map((seat) => seat.stack + seat.streetContribution)
  return Math.max(1, Math.min(heroStack, Math.max(1, ...opponents)))
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
