export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades'
export type Rank =
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'T'
  | 'J'
  | 'Q'
  | 'K'
  | 'A'

export interface Card {
  rank: Rank
  suit: Suit
}

export type SeatId = string
export type PlayerKind = 'human' | 'npc'
export type PlayerStatus = 'active' | 'folded' | 'all-in' | 'out'
export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'
export type GameStatus = 'waitingForHand' | 'handInProgress' | 'complete'
export type HandStatus = 'active' | 'settled'
export type VisibilityScope = 'public' | SeatId

export interface SeatState {
  id: SeatId
  name: string
  kind: PlayerKind
  stack: number
  status: PlayerStatus
  holeCards: Card[]
}

export interface MatchConfig {
  startingStack: number
  smallBlind: number
  bigBlind: number
  seed: string | number
  seats: Array<{
    id: SeatId
    name: string
    kind: PlayerKind
  }>
  fixedDeck?: Card[]
}

export interface BettingRoundState {
  currentBet: number
  minRaise: number
  actedThisRound: SeatId[]
  streetContributions: Record<SeatId, number>
  totalContributions: Record<SeatId, number>
}

export interface Pot {
  amount: number
  eligibleSeatIds: SeatId[]
}

export interface ShowdownResult {
  winners: Array<{
    seatId: SeatId
    amount: number
    handName?: string
    cards?: Card[]
  }>
  pots: Pot[]
  revealedCards: Record<SeatId, Card[]>
}

export interface HandState extends BettingRoundState {
  id: number
  dealerSeatId: SeatId
  smallBlindSeatId: SeatId
  bigBlindSeatId: SeatId
  street: Street
  deck: Card[]
  communityCards: Card[]
  pendingSeatId?: SeatId
  status: HandStatus
  history: HandHistoryEvent[]
  result?: ShowdownResult
}

export interface GameState {
  config: MatchConfig
  seats: SeatState[]
  status: GameStatus
  handNumber: number
  rngState: number
  dealerSeatId?: SeatId
  hand?: HandState
}

export type LegalAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call'; amount: number }
  | { type: 'bet'; min: number; max: number }
  | { type: 'raise'; min: number; max: number }
  | { type: 'allIn'; amount: number; targetContribution: number }

export type EngineCommand =
  | { type: 'fold'; seatId: SeatId; source?: PlayerKind; commandId?: string }
  | { type: 'check'; seatId: SeatId; source?: PlayerKind; commandId?: string }
  | { type: 'call'; seatId: SeatId; source?: PlayerKind; commandId?: string }
  | { type: 'bet'; seatId: SeatId; amount: number; source?: PlayerKind; commandId?: string }
  | { type: 'raise'; seatId: SeatId; amount: number; source?: PlayerKind; commandId?: string }
  | { type: 'allIn'; seatId: SeatId; source?: PlayerKind; commandId?: string }

export type IllegalActionReason =
  | 'NO_ACTIVE_HAND'
  | 'HAND_ALREADY_SETTLED'
  | 'MATCH_COMPLETE'
  | 'UNKNOWN_SEAT'
  | 'NOT_PENDING_ACTOR'
  | 'SEAT_CANNOT_ACT'
  | 'ACTION_NOT_LEGAL'
  | 'INVALID_AMOUNT'
  | 'INVARIANT_VIOLATION'

export interface EngineError {
  reason: IllegalActionReason
  message: string
  seatId?: SeatId
}

export type EngineResult<T> =
  | { ok: true; state: T; events: HandHistoryEvent[] }
  | { ok: false; state: T; error: EngineError }

export type EventSchemaVersion = 'poker-event-v1'

export type HandHistoryPayload =
  | { type: 'handStarted'; dealerSeatId: SeatId; participantSeatIds: SeatId[] }
  | { type: 'blindPosted'; seatId: SeatId; blind: 'small' | 'big'; amount: number }
  | { type: 'holeCardsDealt'; seatId: SeatId; cards: Card[] }
  | {
      type: 'actionApplied'
      seatId: SeatId
      action: EngineCommand['type']
      amount: number
      targetContribution: number
    }
  | { type: 'streetAdvanced'; street: Street; communityCards: Card[] }
  | { type: 'potAwarded'; winners: ShowdownResult['winners'] }
  | { type: 'showdown'; revealedCards: Record<SeatId, Card[]> }
  | { type: 'matchComplete'; winnerSeatId: SeatId }

type EventEnvelope<TPayload extends HandHistoryPayload> = {
  schemaVersion: EventSchemaVersion
  eventId: string
  sequenceNumber: number
  handId: number
  commandId?: string
  visibility: 'public' | SeatId
  type: TPayload['type']
  payload: Omit<TPayload, 'type'>
}

export type HandHistoryEvent =
  | EventEnvelope<{ type: 'handStarted'; dealerSeatId: SeatId; participantSeatIds: SeatId[] }>
  | EventEnvelope<{ type: 'blindPosted'; seatId: SeatId; blind: 'small' | 'big'; amount: number }>
  | EventEnvelope<{ type: 'holeCardsDealt'; seatId: SeatId; cards: Card[] }>
  | EventEnvelope<{
      type: 'actionApplied'
      seatId: SeatId
      action: EngineCommand['type']
      amount: number
      targetContribution: number
    }>
  | EventEnvelope<{ type: 'streetAdvanced'; street: Street; communityCards: Card[] }>
  | EventEnvelope<{ type: 'potAwarded'; winners: ShowdownResult['winners'] }>
  | EventEnvelope<{ type: 'showdown'; revealedCards: Record<SeatId, Card[]> }>
  | EventEnvelope<{ type: 'matchComplete'; winnerSeatId: SeatId }>

export interface PublicSeatView {
  id: SeatId
  name: string
  kind: PlayerKind
  position?: import('./positions').PositionLabel
  stack: number
  status: PlayerStatus
  streetContribution: number
  totalContribution: number
  isDealer: boolean
  isSmallBlind: boolean
  isBigBlind: boolean
  revealedCards?: Card[]
}

export interface PublicTableView {
  status: GameStatus
  handNumber: number
  street?: Street
  communityCards: Card[]
  pot: number
  currentBet: number
  minRaise: number
  pendingSeatId?: SeatId
  seats: PublicSeatView[]
  events: HandHistoryEvent[]
}

export interface PrivateSeatView extends PublicTableView {
  heroSeatId: SeatId
  holeCards: Card[]
  legalActions: LegalAction[]
}
