import { cardToString, type HandHistoryEvent, type PublicSeatView, type SeatId } from '../poker-engine'
import type { DerivedStatsSnapshot, EventRecord, MatchRecord } from '../persistence'
import type { LocalSoloSessionConfig, LocalSoloSessionSummary } from '../table-controllers/local-single-player/LocalSoloSession'
import { mustNpcDefinition, mustNpcStrategyProfile } from '../npc/roster'

export const COMPLETED_SESSION_PACKAGE_SCHEMA_VERSION = 'para-completed-session-v1' as const
export const PARA_SITE_IMPORT_TARGET_VERSION = 'para-poker-site-import-v1' as const

export interface CompletedSessionParticipant {
  seatId: SeatId
  displayName: string
  kind: 'human' | 'npc'
  position?: string
  startingStack: number
  finalStack: number
  optionalParaPlayerId?: string
  npcDefinitionId?: string
  npcStrategyProfileId?: string
  npcStrategyProfileVersion?: number
}

export interface CompletedSessionHand {
  handId: string
  handNumber: number
  dealerSeatId: SeatId
  participantSeatIds: SeatId[]
  board: string[]
  revealedCards: Record<SeatId, string[]>
  potAwards: Array<{
    seatId: SeatId
    amount: number
    handName?: string
    cards?: string[]
  }>
}

export type CompletedSessionResultSummary = Omit<LocalSoloSessionSummary, 'seed'>

export interface ParaPokerSiteImportActionPreview {
  hand_no: number
  hand_code: string
  log_order: number
  street: string
  player_name: string
  action: string
  amount: number
  all_in: boolean
  raw_entry: string
}

export interface ParaPokerSiteImportHandPreview {
  hand_no: number
  hand_code: string
  board: string
  winner_name: string
  pot_collected: number
  winning_hand: string
  showdown: boolean
  raw_result: string
  actions: ParaPokerSiteImportActionPreview[]
}

export interface CompletedSessionPackage {
  schemaVersion: typeof COMPLETED_SESSION_PACKAGE_SCHEMA_VERSION
  source: {
    app: 'parapoker-official-client'
    appVersion: string
    packageCreationVersion: typeof COMPLETED_SESSION_PACKAGE_SCHEMA_VERSION
    packageCreatedAt: string
    sourceAuthority: 'local-browser' | 'server-authoritative'
    sourceMatchId: string
    sourceTableId: string
    blueprintId: string
    gameVisibility: string
  }
  rules: {
    rulesContractVersion: string
    eventSchemaVersion: string
    mode: string
    format: string
    blinds: {
      smallBlind: number
      bigBlind: number
    }
    startingStack: number
  }
  participants: CompletedSessionParticipant[]
  hands: CompletedSessionHand[]
  orderedPublicEvents: HandHistoryEvent[]
  resultSummary: CompletedSessionResultSummary
  paraPokerSite: {
    targetVersion: typeof PARA_SITE_IMPORT_TARGET_VERSION
    metadata: {
      sessionCode: string
      seasonCode: string
      tableName: string
      format: string
      handsCount: number
      playersCount: number
    }
    players: Array<{
      raw_name: string
      display_name: string
      seat_id: SeatId
      kind: 'human' | 'npc'
      optional_para_player_id?: string
      npc_definition_id?: string
      npc_strategy_profile_id?: string
      npc_strategy_profile_version?: number
    }>
    hands: ParaPokerSiteImportHandPreview[]
    actions: ParaPokerSiteImportActionPreview[]
    sessionResults: Array<{
      player_name: string
      seat_id: SeatId
      finish: number
      final_stack: number
      approved: boolean
    }>
    playerSessionStats: Array<DerivedStatsSnapshot & { player_name: string }>
    rawText: string
  }
  integrity: {
    checksumAlgorithm: 'stable-json-fnv1a32'
    checksum: string
    eventCount: number
    handCount: number
  }
}

export interface BuildCompletedSessionPackageInput {
  match: MatchRecord
  publicEvents: EventRecord[]
  snapshotSeats: PublicSeatView[]
  summary: LocalSoloSessionSummary
  config: LocalSoloSessionConfig
  appVersion: string
}

export function buildCompletedSessionPackage(input: BuildCompletedSessionPackageInput): CompletedSessionPackage {
  if (input.match.status !== 'complete' || !input.match.result) {
    throw new Error('Completed-session export requires a completed match.')
  }

  const orderedPublicEvents = input.publicEvents.map((record) => record.event)
  const participants = buildParticipants(input)
  const hands = buildHands(orderedPublicEvents)
  const siteHands = hands.map((hand) => toSiteHandPreview(hand, orderedPublicEvents, participants))
  const siteActions = siteHands.flatMap((hand) => hand.actions)
  const packageWithoutIntegrity = {
    schemaVersion: COMPLETED_SESSION_PACKAGE_SCHEMA_VERSION,
    source: {
      app: 'parapoker-official-client' as const,
      appVersion: input.appVersion,
      packageCreationVersion: COMPLETED_SESSION_PACKAGE_SCHEMA_VERSION,
      packageCreatedAt: '1970-01-01T00:00:00.000Z',
      sourceAuthority: 'local-browser' as const,
      sourceMatchId: input.match.matchId,
      sourceTableId: input.match.tableId,
      blueprintId: input.config.blueprint?.id ?? `local-${input.summary.mode}-blueprint`,
      gameVisibility: input.config.blueprint?.visibility ?? input.config.visibility ?? 'private',
    },
    rules: {
      rulesContractVersion: input.match.rulesContractVersion,
      eventSchemaVersion: input.match.eventSchemaVersion,
      mode: input.summary.mode,
      format: input.match.format,
      blinds: input.match.blinds,
      startingStack: input.config.startingStack,
    },
    participants,
    hands,
    orderedPublicEvents,
    resultSummary: sanitizeSummary(input.summary),
    paraPokerSite: {
      targetVersion: PARA_SITE_IMPORT_TARGET_VERSION,
      metadata: {
        sessionCode: input.match.matchId,
        seasonCode: 'LOCAL',
        tableName: input.summary.mode === 'six-max' ? 'ParaPoker Six-Max Solo' : 'ParaPoker Heads-Up Solo',
        format: 'ParaPoker completed-session package',
        handsCount: hands.length,
        playersCount: participants.length,
      },
      players: participants.map((participant) => ({
        raw_name: participant.displayName,
        display_name: participant.displayName,
        seat_id: participant.seatId,
        kind: participant.kind,
        ...(participant.optionalParaPlayerId ? { optional_para_player_id: participant.optionalParaPlayerId } : {}),
        ...(participant.npcDefinitionId ? { npc_definition_id: participant.npcDefinitionId } : {}),
        ...(participant.npcStrategyProfileId ? { npc_strategy_profile_id: participant.npcStrategyProfileId } : {}),
        ...(participant.npcStrategyProfileVersion ? { npc_strategy_profile_version: participant.npcStrategyProfileVersion } : {}),
      })),
      hands: siteHands,
      actions: siteActions,
      sessionResults: buildSessionResults(participants),
      playerSessionStats: input.summary.stats.map((stat) => ({
        ...stat,
        player_name: participantName(participants, stat.seatId),
      })),
      rawText: siteHandsToRawText(siteHands, hands, participants),
    },
  }

  const checksum = stableChecksum(packageWithoutIntegrity)
  return {
    ...packageWithoutIntegrity,
    integrity: {
      checksumAlgorithm: 'stable-json-fnv1a32',
      checksum,
      eventCount: orderedPublicEvents.length,
      handCount: hands.length,
    },
  }
}

function siteHandsToRawText(
  siteHands: ParaPokerSiteImportHandPreview[],
  hands: CompletedSessionHand[],
  participants: CompletedSessionParticipant[],
): string {
  return siteHands.flatMap((siteHand) => {
    const hand = hands.find((candidate) => candidate.handNumber === siteHand.hand_no)
    const lines = [`Hand #${siteHand.hand_no} ${siteHand.hand_code}`]
    lines.push(...siteHand.actions.map((action) => action.raw_entry))
    if (hand?.board.length) {
      lines.push(`Board: ${hand.board.join(' ')}`)
    }
    if (hand && Object.keys(hand.revealedCards).length > 0) {
      for (const [seatId, cards] of Object.entries(hand.revealedCards)) {
        lines.push(`"${participantName(participants, seatId)}" shows ${cards.join(' ')}`)
      }
    }
    for (const award of hand?.potAwards ?? []) {
      lines.push(`"${participantName(participants, award.seatId)}" collected ${award.amount} from pot`)
    }
    return lines
  }).join('\n')
}

function sanitizeSummary(summary: LocalSoloSessionSummary): CompletedSessionResultSummary {
  const { seed: _seed, ...publicSummary } = summary
  return publicSummary
}

function buildParticipants(input: BuildCompletedSessionPackageInput): CompletedSessionParticipant[] {
  const blueprintSeats = input.config.blueprint?.seats ?? []
  return input.snapshotSeats.map((seat) => {
    const blueprintSeat = blueprintSeats.find((entry) => entry.seatId === seat.id)
    const npcDefinition = blueprintSeat?.npcDefinitionId ? mustNpcDefinition(blueprintSeat.npcDefinitionId) : undefined
    const npcProfile = npcDefinition ? mustNpcStrategyProfile(npcDefinition.strategyProfileId) : undefined
    return {
      seatId: seat.id,
      displayName: seat.name,
      kind: seat.kind,
      position: seat.position,
      startingStack: input.match.startingStacks[seat.id] ?? input.config.startingStack,
      finalStack: input.summary.finalStacks[seat.id] ?? seat.stack,
      ...(npcDefinition ? { npcDefinitionId: npcDefinition.id } : {}),
      ...(npcProfile ? { npcStrategyProfileId: npcProfile.id, npcStrategyProfileVersion: npcProfile.version } : {}),
    }
  })
}

function buildHands(events: HandHistoryEvent[]): CompletedSessionHand[] {
  const byHand = new Map<number, HandHistoryEvent[]>()
  for (const event of events) {
    const handEvents = byHand.get(event.handId) ?? []
    handEvents.push(event)
    byHand.set(event.handId, handEvents)
  }

  return [...byHand.entries()].map(([handNumber, handEvents]) => {
    const started = handEvents.find((event) => event.type === 'handStarted')
    const street = [...handEvents].reverse().find((event) => event.type === 'streetAdvanced')
    const showdown = [...handEvents].reverse().find((event) => event.type === 'showdown')
    const awarded = [...handEvents].reverse().find((event) => event.type === 'potAwarded')
    const board = street && street.type === 'streetAdvanced'
      ? street.payload.communityCards.map(cardToString)
      : []

    return {
      handId: `hand-${handNumber}`,
      handNumber,
      dealerSeatId: started && started.type === 'handStarted' ? started.payload.dealerSeatId : '',
      participantSeatIds: started && started.type === 'handStarted' ? started.payload.participantSeatIds : [],
      board,
      revealedCards: showdown && showdown.type === 'showdown'
        ? Object.fromEntries(
            Object.entries(showdown.payload.revealedCards).map(([seatId, cards]) => [
              seatId,
              cards.map(cardToString),
            ]),
          )
        : {},
      potAwards: awarded && awarded.type === 'potAwarded'
        ? awarded.payload.winners.map((winner) => ({
            seatId: winner.seatId,
            amount: winner.amount,
            ...(winner.handName ? { handName: winner.handName } : {}),
            ...(winner.cards ? { cards: winner.cards.map(cardToString) } : {}),
          }))
        : [],
    }
  })
}

function toSiteHandPreview(
  hand: CompletedSessionHand,
  events: HandHistoryEvent[],
  participants: CompletedSessionParticipant[],
): ParaPokerSiteImportHandPreview {
  const handEvents = events.filter((event) => event.handId === hand.handNumber)
  const actions: ParaPokerSiteImportActionPreview[] = []
  let currentStreet = 'preflop'
  for (const event of handEvents) {
    if (event.type === 'streetAdvanced') {
      currentStreet = event.payload.street
    }
    if (event.type === 'blindPosted' || event.type === 'actionApplied') {
      actions.push(toSiteActionPreview(event, hand, participants, actions.length + 1, currentStreet))
    }
  }
  const biggestAward = [...hand.potAwards].sort((left, right) => right.amount - left.amount)[0]
  const winnerName = biggestAward ? participantName(participants, biggestAward.seatId) : ''

  return {
    hand_no: hand.handNumber,
    hand_code: hand.handId,
    board: hand.board.join(' '),
    winner_name: winnerName,
    pot_collected: biggestAward?.amount ?? 0,
    winning_hand: biggestAward?.handName ?? '',
    showdown: Object.keys(hand.revealedCards).length > 0,
    raw_result: hand.potAwards.map((award) => `${participantName(participants, award.seatId)} won ${award.amount}`).join('; '),
    actions,
  }
}

function toSiteActionPreview(
  event: Extract<HandHistoryEvent, { type: 'blindPosted' | 'actionApplied' }>,
  hand: CompletedSessionHand,
  participants: CompletedSessionParticipant[],
  logOrder: number,
  street: string,
): ParaPokerSiteImportActionPreview {
  if (event.type === 'blindPosted') {
    const action = event.payload.blind === 'small' ? 'posts small blind' : 'posts big blind'
    return {
      hand_no: hand.handNumber,
      hand_code: hand.handId,
      log_order: logOrder,
      street,
      player_name: participantName(participants, event.payload.seatId),
      action,
      amount: event.payload.amount,
      all_in: false,
      raw_entry: `"${participantName(participants, event.payload.seatId)}" ${action} ${event.payload.amount}`,
    }
  }

  const action = siteActionName(event.payload.action)
  return {
    hand_no: hand.handNumber,
    hand_code: hand.handId,
    log_order: logOrder,
    street,
    player_name: participantName(participants, event.payload.seatId),
    action,
    amount: event.payload.amount,
    all_in: event.payload.action === 'allIn',
    raw_entry: `"${participantName(participants, event.payload.seatId)}" ${action}${event.payload.amount ? ` ${event.payload.amount}` : ''}`,
  }
}

function siteActionName(action: string): string {
  switch (action) {
    case 'fold':
      return 'folds'
    case 'check':
      return 'checks'
    case 'call':
      return 'calls'
    case 'bet':
      return 'bets'
    case 'raise':
      return 'raises'
    case 'allIn':
      return 'bets'
    default:
      return action
  }
}

function buildSessionResults(participants: CompletedSessionParticipant[]) {
  return [...participants]
    .sort((left, right) => right.finalStack - left.finalStack || left.displayName.localeCompare(right.displayName))
    .map((participant, index) => ({
      player_name: participant.displayName,
      seat_id: participant.seatId,
      finish: index + 1,
      final_stack: participant.finalStack,
      approved: false,
    }))
}

function participantName(participants: CompletedSessionParticipant[], seatId: SeatId): string {
  return participants.find((participant) => participant.seatId === seatId)?.displayName ?? seatId
}

export function stableChecksum(value: unknown): string {
  const json = stableStringify(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
