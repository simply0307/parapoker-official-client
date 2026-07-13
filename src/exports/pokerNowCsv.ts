import { type Card, type HandHistoryEvent, type SeatId } from '../poker-engine'
import type { CompletedSessionPackage, CompletedSessionParticipant } from './completedSessionPackage'

interface PokerNowCsvRow {
  entry: string
  at: string
  order: number
}

interface ReplaySeat {
  seatId: SeatId
  displayName: string
  stack: number
}

export function completedSessionPackageToPokerNowCsv(completedPackage: CompletedSessionPackage): string {
  const rows = buildPokerNowCsvRows(completedPackage)
  return [
    'entry,at,order',
    ...rows
      .sort((left, right) => right.order - left.order)
      .map((row) => [csvCell(row.entry), csvCell(row.at), String(row.order)].join(',')),
  ].join('\n')
}

function buildPokerNowCsvRows(completedPackage: CompletedSessionPackage): PokerNowCsvRow[] {
  const rows: PokerNowCsvRow[] = []
  const hands = new Map(completedPackage.hands.map((hand) => [hand.handNumber, hand]))
  const stacks = new Map<SeatId, ReplaySeat>(
    completedPackage.participants.map((participant) => [
      participant.seatId,
      {
        seatId: participant.seatId,
        displayName: participant.displayName,
        stack: participant.startingStack,
      },
    ]),
  )
  const eventGroups = new Map<number, HandHistoryEvent[]>()
  for (const event of completedPackage.orderedPublicEvents) {
    const group = eventGroups.get(event.handId) ?? []
    group.push(event)
    eventGroups.set(event.handId, group)
  }

  for (const handNumber of [...eventGroups.keys()].sort((left, right) => left - right)) {
    const handEvents = [...(eventGroups.get(handNumber) ?? [])].sort(
      (left, right) => left.sequenceNumber - right.sequenceNumber,
    )
    const hand = hands.get(handNumber)
    const handStarted = handEvents.find((event) => event.type === 'handStarted')
    if (handStarted?.type === 'handStarted') {
      rows.push(csvRow({
        entry: `-- starting hand #${handNumber} (id: ${hand?.handId ?? `hand-${handNumber}`}) No Limit Texas Hold'em (dealer: "${entryName(seatName(completedPackage.participants, handStarted.payload.dealerSeatId))}") --`,
        event: handStarted,
        offset: 0,
        completedPackage,
      }))
      rows.push(csvRow({
        entry: `Player stacks: ${stackLine(handStarted.payload.participantSeatIds, stacks)}`,
        event: handStarted,
        offset: 1,
        completedPackage,
      }))
    }

    for (const event of handEvents) {
      const entries = eventToPokerNowEntries(event, completedPackage.participants)
      for (const [index, entry] of entries.entries()) {
        rows.push(csvRow({ entry, event, offset: eventRowOffset(event) + index, completedPackage }))
      }
      updateStacks(event, stacks)
    }

    const lastEvent = handEvents.at(-1)
    if (lastEvent) {
      rows.push(csvRow({
        entry: `-- ending hand #${handNumber} --`,
        event: lastEvent,
        offset: 99,
        completedPackage,
      }))
    }
  }

  for (const participant of completedPackage.participants) {
    rows.push({
      entry: `The player "${entryName(participant.displayName)}" finishes the match with a stack of ${participant.finalStack}.`,
      at: completedPackage.source.packageCreatedAt,
      order: 9_000_000 + participant.finalStack,
    })
  }

  return rows
}

function eventToPokerNowEntries(event: HandHistoryEvent, participants: CompletedSessionParticipant[]): string[] {
  switch (event.type) {
    case 'blindPosted':
      return [`"${entryName(seatName(participants, event.payload.seatId))}" posts a ${event.payload.blind} blind of ${event.payload.amount}`]
    case 'actionApplied':
      return [actionEntry(event, participants)]
    case 'streetAdvanced':
      return [streetEntry(event)]
    case 'showdown':
      return Object.entries(event.payload.revealedCards)
        .map(([seatId, cards]) => `"${entryName(seatName(participants, seatId))}" shows a ${cards.map(cardToDisplayString).join(', ')}.`)
    case 'potAwarded':
      return event.payload.winners
        .map((winner) => {
          const hand = winner.handName ? ` with ${winner.handName}` : ''
          const cards = winner.cards ? ` (combination: ${winner.cards.map(cardToDisplayString).join(', ')})` : ''
          return `"${entryName(seatName(participants, winner.seatId))}" collected ${winner.amount} from pot${hand}${cards}`
        })
    case 'matchComplete':
      return [`"${entryName(seatName(participants, event.payload.winnerSeatId))}" wins the match.`]
    case 'handStarted':
    case 'holeCardsDealt':
      return []
  }
}

function actionEntry(event: Extract<HandHistoryEvent, { type: 'actionApplied' }>, participants: CompletedSessionParticipant[]): string {
  const player = `"${entryName(seatName(participants, event.payload.seatId))}"`
  switch (event.payload.action) {
    case 'fold':
      return `${player} folds`
    case 'check':
      return `${player} checks`
    case 'call':
      return `${player} calls ${event.payload.amount}`
    case 'bet':
      return `${player} bets ${event.payload.amount}`
    case 'raise':
      return `${player} raises to ${event.payload.targetContribution}`
    case 'allIn':
      return `${player} raises to ${event.payload.targetContribution} and goes all in`
  }
}

function streetEntry(event: Extract<HandHistoryEvent, { type: 'streetAdvanced' }>): string {
  const cards = event.payload.communityCards.map(cardToDisplayString)
  switch (event.payload.street) {
    case 'flop':
      return `Flop:  [${cards.join(', ')}]`
    case 'turn':
      return `Turn: ${cards.slice(0, 3).join(', ')} [${cards[3]}]`
    case 'river':
      return `River: ${cards.slice(0, 4).join(', ')} [${cards[4]}]`
    case 'preflop':
    case 'showdown':
      return `${event.payload.street}: ${cards.join(', ')}`
  }
}

function updateStacks(event: HandHistoryEvent, stacks: Map<SeatId, ReplaySeat>) {
  if (event.type === 'blindPosted' || event.type === 'actionApplied') {
    const seat = stacks.get(event.payload.seatId)
    if (seat) {
      seat.stack -= event.payload.amount
    }
  }
  if (event.type === 'potAwarded') {
    for (const winner of event.payload.winners) {
      const seat = stacks.get(winner.seatId)
      if (seat) {
        seat.stack += winner.amount
      }
    }
  }
}

function stackLine(seatIds: SeatId[], stacks: Map<SeatId, ReplaySeat>): string {
  return seatIds
    .map((seatId, index) => {
      const seat = stacks.get(seatId)
      return `#${index + 1} "${entryName(seat?.displayName ?? seatId)}" (${seat?.stack ?? 0})`
    })
    .join(' | ')
}

function csvRow({
  entry,
  event,
  offset,
  completedPackage,
}: {
  entry: string
  event: HandHistoryEvent
  offset: number
  completedPackage: CompletedSessionPackage
}): PokerNowCsvRow {
  return {
    entry,
    at: timestampForEvent(completedPackage.source.packageCreatedAt, event.sequenceNumber, offset),
    order: (event.handId * 1_000_000) + (event.sequenceNumber * 100) + offset,
  }
}

function timestampForEvent(baseTimestamp: string, sequenceNumber: number, offset: number): string {
  const base = Date.parse(baseTimestamp)
  const safeBase = Number.isFinite(base) ? base : 0
  return new Date(safeBase + (sequenceNumber * 1000) + offset).toISOString()
}

function eventRowOffset(event: HandHistoryEvent): number {
  switch (event.type) {
    case 'blindPosted':
      return event.payload.blind === 'small' ? 4 : 5
    case 'showdown':
      return 60
    case 'potAwarded':
      return 90
    case 'matchComplete':
      return 98
    default:
      return 20
  }
}

function seatName(participants: CompletedSessionParticipant[], seatId: SeatId): string {
  return participants.find((participant) => participant.seatId === seatId)?.displayName ?? seatId
}

function entryName(name: string): string {
  return name.replaceAll('"', '""')
}

function cardToDisplayString(card: Card): string {
  const ranks: Record<Card['rank'], string> = {
    T: '10',
    J: 'J',
    Q: 'Q',
    K: 'K',
    A: 'A',
    '2': '2',
    '3': '3',
    '4': '4',
    '5': '5',
    '6': '6',
    '7': '7',
    '8': '8',
    '9': '9',
  }
  const suits: Record<Card['suit'], string> = {
    clubs: 'c',
    diamonds: 'd',
    hearts: 'h',
    spades: 's',
  }
  return `${ranks[card.rank]}${suits[card.suit]}`
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}
