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
  squeezeInPositionMultiplier: 3.8,
  squeezeOutOfPositionMultiplier: 4.5,
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

export type CreateSixMaxPreflopStrategyInput = CreateHeadsUpPreflopStrategyInput

export interface PreflopSpot {
  format: NpcPreflopFormat
  position?: PositionLabel
  stackDepth: NpcPreflopStackDepth
  situation: NpcPreflopSituation
  raiseSizeBucket: NpcPreflopRaiseSizeBucket
  bigBlind: number
  effectiveStackBigBlinds: number
  limperCount: number
  callerCount: number
  aggressorPosition?: PositionLabel
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

export function createSixMaxPreflopStrategy(input: CreateSixMaxPreflopStrategyInput): NpcPreflopStrategy {
  const looseness = clamp01(input.looseness)
  const aggression = clamp01(input.aggression)
  const nodes: NpcPreflopRangeNode[] = []

  for (const stackDepth of ['short', 'medium', 'deep'] as const) {
    for (const position of ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const) {
      nodes.push(createSixMaxNode(
        `sixmax-${position.toLowerCase()}-unopened-${stackDepth}`,
        [position],
        stackDepth,
        'unopened',
        (score) => sixMaxUnopenedMix(score, position, stackDepth, looseness, aggression),
      ))
    }

    nodes.push(
      createSixMaxNode(
        `sixmax-early-vs-limp-${stackDepth}`,
        ['HJ', 'CO'],
        stackDepth,
        'facingLimp',
        (score) => sixMaxIsolationMix(score, stackDepth, looseness, aggression, false),
        { minimumLimpers: 1 },
      ),
      createSixMaxNode(
        `sixmax-late-vs-limp-${stackDepth}`,
        ['BTN', 'SB', 'BB'],
        stackDepth,
        'facingLimp',
        (score) => sixMaxIsolationMix(score, stackDepth, looseness, aggression, true),
        { minimumLimpers: 1 },
      ),
    )

    for (const size of ['small', 'medium', 'large'] as const) {
      nodes.push(
        createSixMaxNode(
          `sixmax-in-position-vs-${size}-open-${stackDepth}`,
          ['HJ', 'CO', 'BTN'],
          stackDepth,
          'facingOpen',
          (score) => sixMaxVsOpenMix(score, stackDepth, size, looseness, aggression, true),
          { raiseSizeBuckets: size === 'large' ? ['large', 'allIn'] : [size] },
        ),
        createSixMaxNode(
          `sixmax-blinds-vs-${size}-open-${stackDepth}`,
          ['SB', 'BB'],
          stackDepth,
          'facingOpen',
          (score) => sixMaxVsOpenMix(score, stackDepth, size, looseness, aggression, false),
          { raiseSizeBuckets: size === 'large' ? ['large', 'allIn'] : [size] },
        ),
      )
    }

    nodes.push(
      createSixMaxNode(
        `sixmax-in-position-squeeze-${stackDepth}`,
        ['CO', 'BTN'],
        stackDepth,
        'facingOpenWithCallers',
        (score) => sixMaxSqueezeMix(score, stackDepth, looseness, aggression, true),
        { minimumCallers: 1 },
      ),
      createSixMaxNode(
        `sixmax-blinds-squeeze-${stackDepth}`,
        ['SB', 'BB'],
        stackDepth,
        'facingOpenWithCallers',
        (score) => sixMaxSqueezeMix(score, stackDepth, looseness, aggression, false),
        { minimumCallers: 1 },
      ),
      createSixMaxNode(
        `sixmax-limper-facing-raise-${stackDepth}`,
        ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
        stackDepth,
        'facingRaiseAfterLimp',
        (score) => buttonVsLimpRaiseMix(score, stackDepth, looseness, aggression),
      ),
      createSixMaxNode(
        `sixmax-vs-three-bet-${stackDepth}`,
        ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
        stackDepth,
        'facingThreeBet',
        (score) => versusThreeBetMix(score, stackDepth, looseness, aggression),
      ),
      createSixMaxNode(
        `sixmax-vs-four-bet-${stackDepth}`,
        ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
        stackDepth,
        'facingFourBet',
        (score) => versusFourBetMix(score, stackDepth, aggression),
      ),
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

export function createMultiFormatPreflopStrategy(input: CreateHeadsUpPreflopStrategyInput): NpcPreflopStrategy {
  const headsUp = createHeadsUpPreflopStrategy(input)
  const sixMax = createSixMaxPreflopStrategy(input)
  return { ...headsUp, nodes: [...headsUp.nodes, ...sixMax.nodes] }
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
  let limperCount = 0
  let callerCount = 0
  let lastAggressorSeatId: string | undefined
  let lastAggressionWasAllIn = false

  for (const event of actionEvents) {
    if (event.payload.seatId === view.heroSeatId) {
      heroActed = true
    }
    const passiveAllIn = event.payload.action === 'allIn' && event.payload.targetContribution <= highestTarget
    if (event.payload.action === 'call' || passiveAllIn) {
      if (aggressiveActions === 0 && event.payload.targetContribution <= bigBlind) {
        limperCount += 1
      } else if (aggressiveActions > 0) {
        callerCount += 1
      }
    }
    if (event.payload.targetContribution > highestTarget) {
      aggressiveActions += 1
      highestTarget = event.payload.targetContribution
      lastAggressorSeatId = event.payload.seatId
      lastAggressionWasAllIn = event.payload.action === 'allIn'
      callerCount = 0
    }
  }

  const situation = preflopSituation(aggressiveActions, heroActed, limperCount, callerCount)
  const aggressorPosition = view.seats.find((seat) => seat.id === lastAggressorSeatId)?.position
  return {
    format: activeSeats.length === 2 ? 'heads-up' : 'six-max',
    position,
    stackDepth: stackDepthFor(effectiveStackBigBlinds),
    situation,
    raiseSizeBucket: raiseSizeBucketFor(view.currentBet, bigBlind, effectiveStack, lastAggressionWasAllIn),
    bigBlind,
    effectiveStackBigBlinds,
    limperCount,
    callerCount,
    ...(aggressorPosition ? { aggressorPosition } : {}),
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
  for (const [name, value] of Object.entries(strategy.sizing)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`NPC preflop sizing must be positive: ${name}`)
    }
  }
  const expectedHands = allPreflopHandClasses()
  const nodeIds = new Set<string>()
  for (const node of strategy.nodes) {
    if (nodeIds.has(node.id)) {
      throw new Error(`Duplicate NPC preflop node: ${node.id}`)
    }
    nodeIds.add(node.id)
    if (!node.formats.length || !node.positions.length || !node.stackDepths.length || !node.situations.length) {
      throw new Error(`NPC preflop node requires format, position, stack-depth, and situation selectors: ${node.id}`)
    }
    if (node.minimumLimpers !== undefined && (!Number.isInteger(node.minimumLimpers) || node.minimumLimpers < 0)) {
      throw new Error(`NPC preflop node minimum limpers must be a non-negative integer: ${node.id}`)
    }
    if (node.minimumCallers !== undefined && (!Number.isInteger(node.minimumCallers) || node.minimumCallers < 0)) {
      throw new Error(`NPC preflop node minimum callers must be a non-negative integer: ${node.id}`)
    }
    if (Object.keys(node.hands).length !== expectedHands.length) {
      throw new Error(`NPC preflop node must define all 169 hand classes: ${node.id}`)
    }
    for (const handClass of expectedHands) {
      const frequencies = node.hands[handClass]
      if (!frequencies?.length) {
        throw new Error(`NPC preflop node is missing ${handClass}: ${node.id}`)
      }
      const total = frequencies.reduce((sum, entry) => sum + entry.frequency, 0)
      const actionCount = new Set(frequencies.map((entry) => entry.action)).size
      if (
        actionCount !== frequencies.length ||
        frequencies.some((entry) => !Number.isFinite(entry.frequency) || entry.frequency < 0 || entry.frequency > 1) ||
        !Number.isFinite(total) ||
        Math.abs(total - 1) > 1e-8
      ) {
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

interface SixMaxNodeOptions {
  raiseSizeBuckets?: NpcPreflopRaiseSizeBucket[]
  aggressorPositions?: PositionLabel[]
  minimumLimpers?: number
  minimumCallers?: number
}

function createSixMaxNode(
  id: string,
  positions: PositionLabel[],
  stackDepth: NpcPreflopStackDepth,
  situation: NpcPreflopSituation,
  createMix: (score: number) => NpcPreflopActionFrequency[],
  options: SixMaxNodeOptions = {},
): NpcPreflopRangeNode {
  return {
    id,
    formats: ['six-max'],
    positions,
    stackDepths: [stackDepth],
    situations: [situation],
    ...options,
    hands: Object.fromEntries(allPreflopHandClasses().map((handClass) => [handClass, createMix(sixMaxHandScore(handClass))])),
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

function sixMaxUnopenedMix(
  score: number,
  position: Exclude<PositionLabel, 'BTN/SB' | 'BB'>,
  depth: NpcPreflopStackDepth,
  looseness: number,
  aggression: number,
): NpcPreflopActionFrequency[] {
  const threshold: Record<typeof position, number> = {
    UTG: 0.67,
    HJ: 0.61,
    CO: 0.54,
    BTN: 0.48,
    SB: 0.52,
  }
  const openThreshold = threshold[position] - looseness * 0.045
  if (depth === 'short' && score >= Math.max(0.62, openThreshold)) {
    return mix(['allIn', 0.22 + aggression * 0.35], ['raise', 0.48], ['fold', 0.3 - looseness * 0.12])
  }
  if (score >= 0.86) {
    return mix(['raise', 0.9 + aggression * 0.08], ['call', 0.1 - aggression * 0.06])
  }
  if (score >= openThreshold) {
    const raise = 0.66 + aggression * 0.27
    const limp = position === 'SB' ? 0.2 + looseness * 0.18 : 0.04 + looseness * 0.08
    return mix(['raise', raise], ['call', limp], ['fold', Math.max(0.02, 1 - raise - limp)])
  }
  const distance = openThreshold - score
  const marginalPlay = Math.max(0.01, looseness * 0.24 - distance * 1.5)
  return mix(
    ['raise', marginalPlay * (0.55 + aggression * 0.25)],
    ['call', marginalPlay * (position === 'SB' ? 0.6 : 0.18)],
    ['fold', 1 - marginalPlay],
  )
}

function sixMaxIsolationMix(
  score: number,
  depth: NpcPreflopStackDepth,
  looseness: number,
  aggression: number,
  latePosition: boolean,
): NpcPreflopActionFrequency[] {
  const threshold = (latePosition ? 0.48 : 0.58) - looseness * 0.04
  if (depth === 'short' && score >= 0.66) {
    return mix(['allIn', 0.3 + aggression * 0.38], ['raise', 0.4], ['call', 0.2], ['fold', 0.1])
  }
  if (score >= 0.84) {
    return mix(['raise', 0.88 + aggression * 0.1], ['call', 0.12 - aggression * 0.06])
  }
  if (score >= threshold) {
    return mix(
      ['raise', 0.48 + aggression * 0.35],
      ['call', 0.2 + looseness * 0.18],
      ['fold', Math.max(0.02, 0.3 - looseness * 0.14)],
    )
  }
  return mix(['raise', aggression * 0.05], ['call', looseness * 0.16], ['fold', 0.86])
}

function sixMaxVsOpenMix(
  score: number,
  depth: NpcPreflopStackDepth,
  size: 'small' | 'medium' | 'large',
  looseness: number,
  aggression: number,
  inPosition: boolean,
): NpcPreflopActionFrequency[] {
  const sizePenalty = size === 'small' ? 0 : size === 'medium' ? 0.08 : 0.17
  const continueThreshold = 0.59 + sizePenalty - looseness * 0.08 + (inPosition ? -0.04 : 0.02)
  if (depth === 'short' && score >= 0.72 + sizePenalty * 0.4) {
    return mix(['allIn', 0.45 + aggression * 0.38], ['call', 0.35 - aggression * 0.12], ['fold', 0.2])
  }
  if (score >= 0.87) {
    return mix(['raise', 0.58 + aggression * 0.32], ['call', 0.42 - aggression * 0.18])
  }
  if (score >= continueThreshold) {
    return mix(
      ['raise', 0.08 + aggression * 0.2],
      ['call', 0.5 + looseness * 0.22 + (inPosition ? 0.08 : 0)],
      ['fold', 0.28 + sizePenalty],
    )
  }
  const bluff = Math.max(0.005, aggression * 0.045 - sizePenalty * 0.08)
  const defend = Math.max(0.01, looseness * (inPosition ? 0.16 : 0.1) - sizePenalty * 0.25)
  return mix(['raise', bluff], ['call', defend], ['fold', 0.94])
}

function sixMaxSqueezeMix(
  score: number,
  depth: NpcPreflopStackDepth,
  looseness: number,
  aggression: number,
  inPosition: boolean,
): NpcPreflopActionFrequency[] {
  if (depth === 'short' && score >= 0.68) {
    return mix(['allIn', 0.52 + aggression * 0.34], ['raise', 0.22], ['call', 0.16], ['fold', 0.1])
  }
  if (score >= 0.86) {
    return mix(['raise', 0.86 + aggression * 0.12], ['call', 0.14 - aggression * 0.06])
  }
  if (score >= 0.65) {
    return mix(
      ['raise', 0.22 + aggression * 0.34],
      ['call', (inPosition ? 0.24 : 0.14) + looseness * 0.12],
      ['fold', 0.48 - looseness * 0.1],
    )
  }
  if (score >= 0.48) {
    return mix(['raise', aggression * 0.14], ['call', inPosition ? looseness * 0.08 : 0], ['fold', 0.88])
  }
  return mix(['raise', aggression * 0.025], ['fold', 0.98])
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

function sixMaxHandScore(handClass: string): number {
  if (handClass.length === 2) {
    return handClassScore(handClass)
  }
  const high = RANK_VALUE[handClass[0] as Rank]
  const low = RANK_VALUE[handClass[1] as Rank]
  const gap = high - low
  const suited = handClass.endsWith('s')
  const gapPenalty = gap <= 2 ? 0 : Math.min(0.18, 0.035 * (gap - 1))
  const offsuitPenalty = suited ? 0 : 0.03
  const wheelAceBonus = suited && high === 14 && low <= 5 ? 0.055 : 0
  return clamp01(handClassScore(handClass) - gapPenalty - offsuitPenalty + wheelAceBonus)
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
    (!node.raiseSizeBuckets || node.raiseSizeBuckets.includes(spot.raiseSizeBucket)) &&
    (!node.aggressorPositions || Boolean(spot.aggressorPosition && node.aggressorPositions.includes(spot.aggressorPosition))) &&
    (node.minimumLimpers === undefined || spot.limperCount >= node.minimumLimpers) &&
    (node.minimumCallers === undefined || spot.callerCount >= node.minimumCallers)
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
  } else if (spot.situation === 'facingOpenWithCallers') {
    const inPosition = spot.position === 'BTN/SB' || spot.position === 'BTN' || spot.position === 'CO'
    target = view.currentBet * (inPosition ? sizing.squeezeInPositionMultiplier : sizing.squeezeOutOfPositionMultiplier)
  } else if (spot.situation === 'facingThreeBet' || spot.situation === 'facingFourBet') {
    target = view.currentBet * sizing.fourBetMultiplier
  }
  return Math.min(action.max, Math.max(action.min, Math.round(target)))
}

function preflopSituation(
  aggressiveActions: number,
  heroActed: boolean,
  limperCount: number,
  callerCount: number,
): NpcPreflopSituation {
  if (aggressiveActions === 0) {
    return limperCount > 0 ? 'facingLimp' : 'unopened'
  }
  if (aggressiveActions === 1) {
    if (heroActed && limperCount > 0) {
      return 'facingRaiseAfterLimp'
    }
    return callerCount > 0 ? 'facingOpenWithCallers' : 'facingOpen'
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
  lastAggressionWasAllIn: boolean,
): NpcPreflopRaiseSizeBucket {
  if (currentBet <= bigBlind) {
    return 'none'
  }
  if (lastAggressionWasAllIn || currentBet >= effectiveStack) {
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
