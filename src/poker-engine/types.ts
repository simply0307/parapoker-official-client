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
  | { type: 'fold'; seatId: SeatId; source?: PlayerKind }
  | { type: 'check'; seatId: SeatId; source?: PlayerKind }
  | { type: 'call'; seatId: SeatId; source?: PlayerKind }
  | { type: 'bet'; seatId: SeatId; amount: number; source?: PlayerKind }
  | { type: 'raise'; seatId: SeatId; amount: number; source?: PlayerKind }
  | { type: 'allIn'; seatId: SeatId; source?: PlayerKind }

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

export type HandHistoryEvent =
  | {
      type: 'handStarted'
      handId: number
      dealerSeatId: SeatId
      visibility: 'public'
    }
  | {
      type: 'blindPosted'
      handId: number
      seatId: SeatId
      blind: 'small' | 'big'
      amount: number
      visibility: 'public'
    }
  | {
      type: 'holeCardsDealt'
      handId: number
      seatId: SeatId
      cards: Card[]
      visibility: SeatId
    }
  | {
      type: 'actionApplied'
      handId: number
      seatId: SeatId
      action: EngineCommand['type']
      amount: number
      targetContribution: number
      visibility: 'public'
    }
  | {
      type: 'streetAdvanced'
      handId: number
      street: Street
      communityCards: Card[]
      visibility: 'public'
    }
  | {
      type: 'potAwarded'
      handId: number
      winners: ShowdownResult['winners']
      visibility: 'public'
    }
  | {
      type: 'showdown'
      handId: number
      revealedCards: Record<SeatId, Card[]>
      visibility: 'public'
    }
  | {
      type: 'matchComplete'
      winnerSeatId: SeatId
      visibility: 'public'
    }

export interface PublicSeatView {
  id: SeatId
  name: string
  kind: PlayerKind
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
