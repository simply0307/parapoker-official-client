import { cardToString, type HandHistoryEvent, type PublicSeatView, type SeatId } from '../poker-engine'
import type { DerivedStatsSnapshot, EventRecord, MatchRecord } from '../persistence'
import type { LocalSoloSessionConfig, LocalSoloSessionSummary } from '../table-controllers/local-single-player/LocalSoloSession'

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
  startedAt: string
  endedAt: string
  dealerSeatId: SeatId
  participantSeatIds: SeatId[]
  blinds: {
    smallBlindSeatId?: SeatId
    bigBlindSeatId?: SeatId
    smallBlind: number
    bigBlind: number
  }
  positions: Record<SeatId, string>
  stackCheckpoints: {
    initial: Record<SeatId, number>
    final: Record<SeatId, number>
  }
  contributions: Record<SeatId, number>
  board: string[]
  revealedCards: Record<SeatId, string[]>
  potSummary: {
    totalContributed: number
    totalAwarded: number
    pots: Array<{
      amount: number
      eligibleSeatIds: SeatId[]
    }>
    refunds: Array<{
      seatId: SeatId
      amount: number
    }>
  }
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
  target_contribution: number
  raise_to?: number
  all_in: boolean
  raw_entry: string
}

export interface ParaPokerSiteImportHandPreview {
  hand_no: number
  hand_code: string
  start_time: string
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
  result: {
    winnerSeatIds: SeatId[]
    finalStacks: Record<SeatId, number>
    finishOrder: Array<{
      seatId: SeatId
      finish: number
      finalStack: number
    }>
    eliminationOrder: SeatId[]
  }
  paraPokerSite: {
    targetVersion: typeof PARA_SITE_IMPORT_TARGET_VERSION
    metadata: {
      sessionCode: string
      seasonCode: string
      tableName: string
      format: string
      handsCount: number
      playersCount: number
      playedAt?: string
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

  const orderedPublicRecords = [...input.publicEvents].sort(compareEventRecords)
  const orderedPublicEvents = orderedPublicRecords.map((record) => record.event)
  const participants = buildParticipants(input)
  const hands = buildHands(orderedPublicRecords, participants, input.match.startingStacks, input.match.blinds)
  const siteHands = hands.map((hand) => toSiteHandPreview(hand, orderedPublicEvents, participants))
  const siteActions = siteHands.flatMap((hand) => hand.actions)
  const packageCreatedAt = input.match.completedAt
    ?? orderedPublicRecords.at(-1)?.recordedAt
    ?? input.match.createdAt
    ?? new Date().toISOString()
  const packageWithoutIntegrity = {
    schemaVersion: COMPLETED_SESSION_PACKAGE_SCHEMA_VERSION,
    source: {
      app: 'parapoker-official-client' as const,
      appVersion: input.appVersion,
      packageCreationVersion: COMPLETED_SESSION_PACKAGE_SCHEMA_VERSION,
      packageCreatedAt,
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
    result: buildResult(input.match, participants),
    paraPokerSite: {
      targetVersion: PARA_SITE_IMPORT_TARGET_VERSION,
      metadata: {
        sessionCode: input.match.matchId,
        seasonCode: 'LOCAL',
        tableName: input.summary.mode === 'six-max' ? 'ParaPoker Six-Max Solo' : 'ParaPoker Heads-Up Solo',
        format: 'ParaPoker completed-session package',
        handsCount: hands.length,
        playersCount: participants.length,
        playedAt: hands[0]?.startedAt ?? packageCreatedAt,
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
    const optionalParaPlayerId = seat.kind === 'human' && blueprintSeat?.playerId && blueprintSeat.playerId !== 'local-human'
      ? blueprintSeat.playerId
      : undefined
    return {
      seatId: seat.id,
      displayName: seat.name,
      kind: seat.kind,
      position: seat.position,
      startingStack: input.match.startingStacks[seat.id] ?? input.config.startingStack,
      finalStack: input.summary.finalStacks[seat.id] ?? seat.stack,
      ...(optionalParaPlayerId ? { optionalParaPlayerId } : {}),
      ...(blueprintSeat?.npcDefinitionId ? { npcDefinitionId: blueprintSeat.npcDefinitionId } : {}),
      ...(blueprintSeat?.npcStrategyProfileId
        ? {
            npcStrategyProfileId: blueprintSeat.npcStrategyProfileId,
            npcStrategyProfileVersion: blueprintSeat.npcStrategyProfileVersion,
          }
        : {}),
    }
  })
}

function buildHands(
  records: EventRecord[],
  participants: CompletedSessionParticipant[],
  startingStacks: Record<SeatId, number>,
  blinds: { smallBlind: number; bigBlind: number },
): CompletedSessionHand[] {
  const byHand = new Map<number, EventRecord[]>()
  for (const record of records) {
    const handRecords = byHand.get(record.handId) ?? []
    handRecords.push(record)
    byHand.set(record.handId, handRecords)
  }

  const stacks = new Map<SeatId, number>(
    participants.map((participant) => [
      participant.seatId,
      startingStacks[participant.seatId] ?? participant.startingStack,
    ]),
  )

  return [...byHand.entries()]
    .sort(([left], [right]) => left - right)
    .map(([handNumber, handRecords]) => {
      const sortedRecords = [...handRecords].sort(compareEventRecords)
      const handEvents = sortedRecords.map((record) => record.event)
      const started = handEvents.find((event) => event.type === 'handStarted')
      const street = [...handEvents].reverse().find((event) => event.type === 'streetAdvanced')
      const showdown = [...handEvents].reverse().find((event) => event.type === 'showdown')
      const awarded = [...handEvents].reverse().find((event) => event.type === 'potAwarded')
      const participantSeatIds = started?.type === 'handStarted' ? started.payload.participantSeatIds : []
      const initialStacks = Object.fromEntries(participantSeatIds.map((seatId) => [seatId, stacks.get(seatId) ?? 0]))
      const contributions = contributionTotals(handEvents, participantSeatIds)
      const potAwards = awarded?.type === 'potAwarded'
        ? awarded.payload.winners.map((winner) => ({
            seatId: winner.seatId,
            amount: winner.amount,
            ...(winner.handName ? { handName: winner.handName } : {}),
            ...(winner.cards ? { cards: winner.cards.map(cardToString) } : {}),
          }))
        : []
      const refunds = awarded?.type === 'potAwarded'
        ? awarded.payload.refunds ?? inferRefunds(contributions, potAwards)
        : []

      for (const seatId of participantSeatIds) {
        const nextStack = (stacks.get(seatId) ?? 0)
          - (contributions[seatId] ?? 0)
          + potAwards.filter((award) => award.seatId === seatId).reduce((sum, award) => sum + award.amount, 0)
          + refunds.filter((refund) => refund.seatId === seatId).reduce((sum, refund) => sum + refund.amount, 0)
        stacks.set(seatId, nextStack)
      }

      const board = street && street.type === 'streetAdvanced'
        ? street.payload.communityCards.map(cardToString)
        : []
      const smallBlindPosted = handEvents.find(
        (event): event is Extract<HandHistoryEvent, { type: 'blindPosted' }> =>
          event.type === 'blindPosted' && event.payload.blind === 'small',
      )
      const bigBlindPosted = handEvents.find(
        (event): event is Extract<HandHistoryEvent, { type: 'blindPosted' }> =>
          event.type === 'blindPosted' && event.payload.blind === 'big',
      )

      return {
        handId: `hand-${handNumber}`,
        handNumber,
        startedAt: sortedRecords[0]?.recordedAt ?? '1970-01-01T00:00:00.000Z',
        endedAt: sortedRecords.at(-1)?.recordedAt ?? sortedRecords[0]?.recordedAt ?? '1970-01-01T00:00:00.000Z',
        dealerSeatId: started && started.type === 'handStarted' ? started.payload.dealerSeatId : '',
        participantSeatIds,
        blinds: {
          smallBlindSeatId: smallBlindPosted?.payload.seatId,
          bigBlindSeatId: bigBlindPosted?.payload.seatId,
          smallBlind: blinds.smallBlind,
          bigBlind: blinds.bigBlind,
        },
        positions: Object.fromEntries(
          participantSeatIds.map((seatId) => [
            seatId,
            participantPosition(participants, seatId),
          ]),
        ),
        stackCheckpoints: {
          initial: initialStacks,
          final: Object.fromEntries(participantSeatIds.map((seatId) => [seatId, stacks.get(seatId) ?? 0])),
        },
        contributions,
        board,
        revealedCards: showdown && showdown.type === 'showdown'
          ? Object.fromEntries(
              Object.entries(showdown.payload.revealedCards).map(([seatId, cards]) => [
                seatId,
                cards.map(cardToString),
              ]),
            )
          : {},
        potSummary: {
          totalContributed: Object.values(contributions).reduce((sum, amount) => sum + amount, 0),
          totalAwarded: potAwards.reduce((sum, award) => sum + award.amount, 0),
          pots: awarded?.type === 'potAwarded'
            ? awarded.payload.pots ?? potAwards.map((award) => ({ amount: award.amount, eligibleSeatIds: participantSeatIds }))
            : [],
          refunds,
        },
        potAwards,
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
    start_time: hand.startedAt,
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
      target_contribution: event.payload.amount,
      all_in: false,
      raw_entry: `"${participantName(participants, event.payload.seatId)}" ${action} ${event.payload.amount}`,
    }
  }

  const action = siteActionName(event.payload.action)
  const targetContribution = event.payload.targetContribution
  const raiseTo = event.payload.action === 'raise' || event.payload.action === 'allIn'
    ? targetContribution
    : undefined
  return {
    hand_no: hand.handNumber,
    hand_code: hand.handId,
    log_order: logOrder,
    street,
    player_name: participantName(participants, event.payload.seatId),
    action,
    amount: event.payload.amount,
    target_contribution: targetContribution,
    ...(raiseTo ? { raise_to: raiseTo } : {}),
    all_in: event.payload.action === 'allIn',
    raw_entry: rawActionEntry(participantName(participants, event.payload.seatId), action, event.payload.amount, raiseTo),
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

function buildResult(match: MatchRecord, participants: CompletedSessionParticipant[]): CompletedSessionPackage['result'] {
  const finishOrder = [...participants]
    .sort((left, right) => right.finalStack - left.finalStack || left.displayName.localeCompare(right.displayName))
    .map((participant, index) => ({
      seatId: participant.seatId,
      finish: index + 1,
      finalStack: participant.finalStack,
    }))

  return {
    winnerSeatIds: match.result?.winnerSeatIds ?? finishOrder.filter((entry) => entry.finish === 1).map((entry) => entry.seatId),
    finalStacks: match.result?.finalStacks ?? Object.fromEntries(participants.map((participant) => [participant.seatId, participant.finalStack])),
    finishOrder,
    eliminationOrder: [...finishOrder]
      .sort((left, right) => left.finalStack - right.finalStack || right.finish - left.finish)
      .map((entry) => entry.seatId),
  }
}

function contributionTotals(events: HandHistoryEvent[], seatIds: SeatId[]): Record<SeatId, number> {
  const contributions = Object.fromEntries(seatIds.map((seatId) => [seatId, 0]))
  for (const event of events) {
    if (event.type === 'blindPosted' || event.type === 'actionApplied') {
      contributions[event.payload.seatId] = (contributions[event.payload.seatId] ?? 0) + event.payload.amount
    }
  }
  return contributions
}

function inferRefunds(
  contributions: Record<SeatId, number>,
  potAwards: CompletedSessionHand['potAwards'],
): CompletedSessionHand['potSummary']['refunds'] {
  const totalContributed = Object.values(contributions).reduce((sum, amount) => sum + amount, 0)
  const totalAwarded = potAwards.reduce((sum, award) => sum + award.amount, 0)
  const refundAmount = totalContributed - totalAwarded
  if (refundAmount <= 0 || potAwards.length !== 1) {
    return []
  }
  return [{ seatId: potAwards[0].seatId, amount: refundAmount }]
}

function participantPosition(participants: CompletedSessionParticipant[], seatId: SeatId): string {
  return participants.find((participant) => participant.seatId === seatId)?.position ?? ''
}

function participantName(participants: CompletedSessionParticipant[], seatId: SeatId): string {
  return participants.find((participant) => participant.seatId === seatId)?.displayName ?? seatId
}

function rawActionEntry(playerName: string, action: string, amount: number, raiseTo?: number): string {
  if (raiseTo) {
    return `"${playerName}" ${action} to ${raiseTo}`
  }
  return `"${playerName}" ${action}${amount ? ` ${amount}` : ''}`
}

function compareEventRecords(left: EventRecord, right: EventRecord): number {
  if (left.handId !== right.handId) {
    return left.handId - right.handId
  }
  return left.sequenceNumber - right.sequenceNumber
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
