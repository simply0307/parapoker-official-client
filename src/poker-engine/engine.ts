import { assertUniqueCards, freshDeck, shuffleDeck } from './cards'
import { compareHandValues, evaluateBestHand } from './handEvaluator'
import { constructPots } from './pots'
import type {
  Card,
  EngineCommand,
  EngineError,
  EngineResult,
  GameState,
  HandHistoryEvent,
  HandHistoryPayload,
  HandState,
  LegalAction,
  MatchConfig,
  PlayerKind,
  PlayerStatus,
  PrivateSeatView,
  PublicSeatView,
  PublicTableView,
  SeatId,
  SeatState,
  ShowdownResult,
  Street,
} from './types'

export const DEFAULT_CONFIG: MatchConfig = {
  startingStack: 200,
  smallBlind: 1,
  bigBlind: 2,
  seed: 'parapoker-dev',
  seats: [
    { id: 'human', name: 'You', kind: 'human' },
    { id: 'npc-1', name: 'ParaBot', kind: 'npc' },
  ],
}

export function createGame(config: Partial<MatchConfig> = {}): GameState {
  const merged: MatchConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    seats: config.seats ?? DEFAULT_CONFIG.seats,
  }

  return {
    config: merged,
    seats: merged.seats.map((seat) => ({
      ...seat,
      stack: merged.startingStack,
      status: 'active',
      holeCards: [],
    })),
    status: 'waitingForHand',
    handNumber: 0,
    rngState: typeof merged.seed === 'number' ? merged.seed : hashStringState(String(merged.seed)),
  }
}

export function startNextHand(state: GameState): EngineResult<GameState> {
  if (state.status === 'complete') {
    return error(state, 'MATCH_COMPLETE', 'The match is already complete.')
  }
  if (state.status === 'handInProgress' && state.hand?.status === 'active') {
    return error(state, 'HAND_ALREADY_SETTLED', 'The current hand has not settled yet.')
  }

  const nextState = clone(state)
  const activeSeats = nextState.seats.filter((seat) => seat.stack > 0)
  if (activeSeats.length < 2) {
    nextState.status = 'complete'
    return error(nextState, 'MATCH_COMPLETE', 'At least two funded seats are required to start a hand.')
  }
  const fixedDeckError = validateFixedDeck(nextState.config.fixedDeck, activeSeats.length)
  if (fixedDeckError) {
    return error(state, 'INVARIANT_VIOLATION', fixedDeckError)
  }

  nextState.handNumber += 1
  for (const seat of nextState.seats) {
    seat.holeCards = []
    seat.status = seat.stack > 0 ? 'active' : 'out'
  }

  const dealerSeatId = chooseNextDealer(nextState)
  const bigBlindSeatId = nextSeatId(nextState.seats, dealerSeatId, (seat) => seat.stack > 0)
  const smallBlindSeatId = dealerSeatId
  const shuffled = nextState.config.fixedDeck
    ? { deck: nextState.config.fixedDeck.map((card) => ({ ...card })), rngState: nextState.rngState }
    : shuffleDeck(freshDeck(), nextState.rngState)

  nextState.rngState = shuffled.rngState
  nextState.dealerSeatId = dealerSeatId
  nextState.status = 'handInProgress'

  const hand: HandState = {
    id: nextState.handNumber,
    dealerSeatId,
    smallBlindSeatId,
    bigBlindSeatId,
    street: 'preflop',
    deck: shuffled.deck,
    communityCards: [],
    currentBet: 0,
    minRaise: nextState.config.bigBlind,
    actedThisRound: [],
    streetContributions: emptyContributionMap(nextState.seats),
    totalContributions: emptyContributionMap(nextState.seats),
    pendingSeatId: smallBlindSeatId,
    status: 'active',
    history: [],
  }

  nextState.hand = hand
  appendEvent(hand, { type: 'handStarted', dealerSeatId }, 'public')
  postBlind(nextState, smallBlindSeatId, nextState.config.smallBlind, 'small')
  postBlind(nextState, bigBlindSeatId, nextState.config.bigBlind, 'big')
  dealHoleCards(nextState)
  settleOrAdvanceIfNoActionIsPossible(nextState)

  return { ok: true, state: nextState, events: hand.history }
}

export function getLegalActions(state: GameState, seatId: SeatId): LegalAction[] {
  const hand = state.hand
  const seat = state.seats.find((candidate) => candidate.id === seatId)
  if (!hand || hand.status !== 'active' || state.status !== 'handInProgress') {
    return []
  }
  if (!seat || hand.pendingSeatId !== seatId || !canSeatAct(seat)) {
    return []
  }

  const contribution = hand.streetContributions[seatId] ?? 0
  const toCall = Math.max(0, hand.currentBet - contribution)
  const hasAlreadyActed = hand.actedThisRound.includes(seatId)
  const canRaiseNow = toCall === 0 || !hasAlreadyActed
  const actions: LegalAction[] = []

  if (toCall > 0) {
    actions.push({ type: 'fold' })
    actions.push({ type: 'call', amount: Math.min(toCall, seat.stack) })
  } else {
    actions.push({ type: 'check' })
  }

  if (seat.stack > 0) {
    const targetContribution = contribution + seat.stack
    if (toCall === 0) {
      const minBet = Math.min(state.config.bigBlind, seat.stack)
      actions.push({ type: 'bet', min: contribution + minBet, max: targetContribution })
    } else if (seat.stack > toCall && canRaiseNow) {
      const minRaiseTarget = hand.currentBet + hand.minRaise
      if (targetContribution >= minRaiseTarget) {
        actions.push({ type: 'raise', min: minRaiseTarget, max: targetContribution })
      }
    }
    if (targetContribution <= hand.currentBet || canRaiseNow) {
      actions.push({ type: 'allIn', amount: seat.stack, targetContribution })
    }
  }

  return dedupeActions(actions)
}

export function applyAction(state: GameState, command: EngineCommand): EngineResult<GameState> {
  const hand = state.hand
  if (!hand || state.status !== 'handInProgress') {
    return error(state, 'NO_ACTIVE_HAND', 'There is no active hand.', command.seatId)
  }
  if (hand.status !== 'active') {
    return error(state, 'HAND_ALREADY_SETTLED', 'This hand is already settled.', command.seatId)
  }
  if (hand.pendingSeatId !== command.seatId) {
    return error(state, 'NOT_PENDING_ACTOR', 'Only the pending actor may act.', command.seatId)
  }

  const seat = state.seats.find((candidate) => candidate.id === command.seatId)
  if (!seat) {
    return error(state, 'UNKNOWN_SEAT', 'The submitted seat does not exist.', command.seatId)
  }
  if (!canSeatAct(seat)) {
    return error(state, 'SEAT_CANNOT_ACT', 'This seat cannot act.', command.seatId)
  }

  const legalActions = getLegalActions(state, command.seatId)
  const legalAction = findMatchingLegalAction(legalActions, command)
  if (!legalAction) {
    return error(state, 'ACTION_NOT_LEGAL', 'The submitted action is not legal.', command.seatId)
  }

  const nextState = clone(state)
  const nextHand = requireHand(nextState)
  const nextSeat = requireSeat(nextState, command.seatId)
  const previousBet = nextHand.currentBet
  const previousContribution = nextHand.streetContributions[command.seatId] ?? 0
  const targetContribution = getTargetContribution(nextState, command, legalAction)

  if (targetContribution < previousContribution || targetContribution - previousContribution > nextSeat.stack) {
    return error(state, 'INVALID_AMOUNT', 'The submitted amount is outside this seat stack.', command.seatId)
  }

  const committed = targetContribution - previousContribution
  if (command.type === 'fold') {
    nextSeat.status = 'folded'
  } else {
    nextSeat.stack -= committed
    nextHand.streetContributions[command.seatId] = targetContribution
    nextHand.totalContributions[command.seatId] =
      (nextHand.totalContributions[command.seatId] ?? 0) + committed
    if (nextSeat.stack === 0) {
      nextSeat.status = 'all-in'
    }
  }

  updateBettingRoundAfterAction(nextState, command.seatId, targetContribution, previousBet)

  appendEvent(
    nextHand,
    {
      type: 'actionApplied',
      seatId: command.seatId,
      action: command.type,
      amount: command.type === 'fold' || command.type === 'check' ? 0 : committed,
      targetContribution,
    },
    'public',
    command.commandId,
  )

  const eventsBeforeProgress = nextHand.history.length
  progressHand(nextState, command.seatId)
  const emittedEvents = requireHand(nextState).history.slice(eventsBeforeProgress - 1)

  return { ok: true, state: nextState, events: emittedEvents }
}

export function getPublicView(state: GameState): PublicTableView {
  const hand = state.hand
  return clone({
    status: state.status,
    handNumber: state.handNumber,
    street: hand?.street,
    communityCards: hand?.communityCards ?? [],
    pot: hand ? totalPot(hand) : 0,
    currentBet: hand?.currentBet ?? 0,
    minRaise: hand?.minRaise ?? state.config.bigBlind,
    pendingSeatId: hand?.pendingSeatId,
    seats: state.seats.map((seat) => toPublicSeatView(state, seat)),
    events: filterEventsForSeat(hand?.history ?? [], 'public'),
  })
}

export function getSeatView(state: GameState, seatId: SeatId): PrivateSeatView {
  const publicView = getPublicView(state)
  const seat = state.seats.find((candidate) => candidate.id === seatId)

  return clone({
    ...publicView,
    heroSeatId: seatId,
    holeCards: seat?.holeCards ?? [],
    legalActions: getLegalActions(state, seatId),
    events: filterEventsForSeat(state.hand?.history ?? [], seatId),
  })
}

export function replayCommands(initialState: GameState, commands: EngineCommand[]): EngineResult<GameState> {
  let current = clone(initialState)
  const emitted: HandHistoryEvent[] = []

  for (const command of commands) {
    const result = applyAction(current, command)
    if (!result.ok) {
      return result
    }
    current = result.state
    emitted.push(...result.events)
  }

  return { ok: true, state: current, events: emitted }
}

export function replayHandFromConfig(
  config: Partial<MatchConfig>,
  commands: EngineCommand[],
): EngineResult<GameState> {
  const started = startNextHand(createGame(clone(config)))
  if (!started.ok) {
    return started
  }

  let current = started.state
  for (const command of clone(commands)) {
    const result = applyAction(current, command)
    if (!result.ok) {
      return result
    }
    current = result.state
  }

  return { ok: true, state: current, events: current.hand?.history ?? [] }
}

function progressHand(state: GameState, actedSeatId: SeatId): void {
  const hand = requireHand(state)
  const contenders = state.seats.filter((seat) => seat.status !== 'folded' && seat.status !== 'out')

  if (contenders.length === 1) {
    settleUncontested(state, contenders[0].id)
    return
  }

  const ableToAct = contenders.filter(canSeatAct)
  if (canRunOutWithoutMoreAction(state, contenders, ableToAct)) {
    runoutAndSettle(state)
    return
  }

  const nextActor = findNextActor(state, actedSeatId)
  if (nextActor) {
    hand.pendingSeatId = nextActor
    return
  }

  advanceStreetOrSettle(state)
}

function advanceStreetOrSettle(state: GameState): void {
  const hand = requireHand(state)
  if (hand.street === 'river') {
    settleShowdown(state)
    return
  }

  hand.street = nextStreet(hand.street)
  hand.currentBet = 0
  hand.minRaise = state.config.bigBlind
  hand.actedThisRound = []
  hand.streetContributions = emptyContributionMap(state.seats)
  dealCommunityToStreet(hand)
  appendEvent(hand, { type: 'streetAdvanced', street: hand.street, communityCards: hand.communityCards }, 'public')

  if (state.seats.filter((seat) => seat.status !== 'folded' && seat.status !== 'out').every((seat) => !canSeatAct(seat))) {
    runoutAndSettle(state)
    return
  }

  const firstActor = firstPostflopActor(state)
  hand.pendingSeatId = firstActor
  if (!firstActor) {
    runoutAndSettle(state)
  }
}

function runoutAndSettle(state: GameState): void {
  const hand = requireHand(state)
  while (hand.street !== 'river') {
    hand.street = nextStreet(hand.street)
    dealCommunityToStreet(hand)
    appendEvent(hand, { type: 'streetAdvanced', street: hand.street, communityCards: hand.communityCards }, 'public')
  }
  settleShowdown(state)
}

function settleUncontested(state: GameState, winnerSeatId: SeatId): void {
  const hand = requireHand(state)
  const winner = requireSeat(state, winnerSeatId)
  const amount = totalPot(hand)
  winner.stack += amount
  hand.pendingSeatId = undefined
  hand.status = 'settled'
  hand.result = {
    winners: [{ seatId: winnerSeatId, amount }],
    pots: [{ amount, eligibleSeatIds: [winnerSeatId] }],
    revealedCards: {},
  }
  appendEvent(hand, { type: 'potAwarded', winners: hand.result.winners }, 'public')
  finishHand(state)
}

function settleShowdown(state: GameState): void {
  const hand = requireHand(state)
  const contenders = state.seats.filter((seat) => seat.status !== 'folded' && seat.status !== 'out')
  const pots = constructPots(hand.totalContributions, contenders.map((seat) => seat.id))
  for (const refund of pots.refunds) {
    requireSeat(state, refund.seatId).stack += refund.amount
  }
  const evaluated = contenders.map((seat) => ({
    seat,
    value: evaluateBestHand([...seat.holeCards, ...hand.communityCards]),
  }))
  const awards = pots.pots.flatMap((pot) => awardPot(state, pot.amount, pot.eligibleSeatIds, evaluated))

  const revealedCards = Object.fromEntries(contenders.map((seat) => [seat.id, seat.holeCards]))
  const result: ShowdownResult = {
    winners: awards,
    pots: pots.pots,
    revealedCards,
  }

  hand.pendingSeatId = undefined
  hand.status = 'settled'
  hand.street = 'showdown'
  hand.result = result
  appendEvent(hand, { type: 'showdown', revealedCards }, 'public')
  appendEvent(hand, { type: 'potAwarded', winners: awards }, 'public')
  finishHand(state)
}

function awardPot(
  state: GameState,
  amount: number,
  eligibleSeatIds: SeatId[],
  evaluated: Array<{
    seat: SeatState
    value: ReturnType<typeof evaluateBestHand>
  }>,
): ShowdownResult['winners'] {
  const eligible = evaluated.filter((candidate) => eligibleSeatIds.includes(candidate.seat.id))
  const best = eligible.reduce((currentBest, candidate) =>
    compareHandValues(candidate.value, currentBest.value) > 0 ? candidate : currentBest,
  )
  const winners = eligible.filter((candidate) => compareHandValues(candidate.value, best.value) === 0)
  const baseAward = Math.floor(amount / winners.length)
  let oddChips = amount % winners.length
  const orderedWinnerIds = orderFromSeat(state.seats, requireHand(state).dealerSeatId)
    .map((seat) => seat.id)
    .filter((seatId) => winners.some((winner) => winner.seat.id === seatId))

  return winners.map((winner) => {
    const receivesOddChip = oddChips > 0 && orderedWinnerIds[0] === winner.seat.id
    if (receivesOddChip) {
      oddChips -= 1
      orderedWinnerIds.shift()
    }
    const wonAmount = baseAward + (receivesOddChip ? 1 : 0)
    winner.seat.stack += wonAmount
    return {
      seatId: winner.seat.id,
      amount: wonAmount,
      handName: winner.value.name,
      cards: winner.value.cards,
    }
  })
}

function settleOrAdvanceIfNoActionIsPossible(state: GameState): void {
  const hand = requireHand(state)
  const contenders = state.seats.filter((seat) => seat.status !== 'folded' && seat.status !== 'out')
  const ableToAct = contenders.filter(canSeatAct)

  if (canRunOutWithoutMoreAction(state, contenders, ableToAct)) {
    runoutAndSettle(state)
    return
  }

  if (hand.pendingSeatId && !canSeatAct(requireSeat(state, hand.pendingSeatId))) {
    const nextActor = findNextActor(state, hand.pendingSeatId)
    if (nextActor) {
      hand.pendingSeatId = nextActor
      return
    }
    advanceStreetOrSettle(state)
  }
}

function finishHand(state: GameState): void {
  const fundedSeats = state.seats.filter((seat) => seat.stack > 0)
  for (const seat of state.seats) {
    if (seat.stack === 0) {
      seat.status = 'out'
    }
  }

  if (fundedSeats.length <= 1) {
    state.status = 'complete'
    const winner = fundedSeats[0]
    if (winner && state.hand) {
      appendEvent(state.hand, { type: 'matchComplete', winnerSeatId: winner.id }, 'public')
    }
  } else {
    state.status = 'waitingForHand'
  }
}

function findNextActor(state: GameState, fromSeatId: SeatId): SeatId | undefined {
  const hand = requireHand(state)
  const orderedSeats = orderAfterSeat(state.seats, fromSeatId)
  return orderedSeats.find((seat) => {
    if (!canSeatAct(seat)) {
      return false
    }
    const contribution = hand.streetContributions[seat.id] ?? 0
    return contribution < hand.currentBet || !hand.actedThisRound.includes(seat.id)
  })?.id
}

function firstPostflopActor(state: GameState): SeatId | undefined {
  const hand = requireHand(state)
  return orderAfterSeat(state.seats, hand.dealerSeatId).find(canSeatAct)?.id
}

function updateBettingRoundAfterAction(
  state: GameState,
  seatId: SeatId,
  targetContribution: number,
  previousBet: number,
): void {
  const hand = requireHand(state)
  if (targetContribution > previousBet) {
    const raiseAmount = targetContribution - previousBet
    const isOpeningBet = previousBet === 0
    const isFullBetOrRaise = isOpeningBet ? targetContribution >= state.config.bigBlind : raiseAmount >= hand.minRaise
    hand.currentBet = targetContribution
    if (isFullBetOrRaise) {
      hand.minRaise = isOpeningBet ? state.config.bigBlind : raiseAmount
      hand.actedThisRound = [seatId]
      return
    }
  }
  addActedSeat(hand, seatId)
}

function findMatchingLegalAction(actions: LegalAction[], command: EngineCommand): LegalAction | undefined {
  return actions.find((action) => {
    if (action.type !== command.type) {
      return false
    }
    if ((command.type === 'bet' || command.type === 'raise') && (action.type === 'bet' || action.type === 'raise')) {
      return Number.isInteger(command.amount) && command.amount >= action.min && command.amount <= action.max
    }
    return true
  })
}

function getTargetContribution(state: GameState, command: EngineCommand, legalAction: LegalAction): number {
  const hand = requireHand(state)
  const contribution = hand.streetContributions[command.seatId] ?? 0
  if (command.type === 'fold' || command.type === 'check') {
    return contribution
  }
  if (command.type === 'call' && legalAction.type === 'call') {
    return contribution + legalAction.amount
  }
  if ((command.type === 'bet' || command.type === 'raise') && 'amount' in command) {
    return command.amount
  }
  if (command.type === 'allIn' && legalAction.type === 'allIn') {
    return legalAction.targetContribution
  }
  return contribution
}

function postBlind(state: GameState, seatId: SeatId, blindAmount: number, blind: 'small' | 'big'): void {
  const hand = requireHand(state)
  const seat = requireSeat(state, seatId)
  const amount = Math.min(blindAmount, seat.stack)
  seat.stack -= amount
  if (seat.stack === 0) {
    seat.status = 'all-in'
  }
  hand.streetContributions[seatId] = amount
  hand.totalContributions[seatId] = amount
  hand.currentBet = Math.max(hand.currentBet, amount)
  appendEvent(hand, { type: 'blindPosted', seatId, blind, amount }, 'public')
}

function dealHoleCards(state: GameState): void {
  const hand = requireHand(state)
  const order = orderFromSeat(state.seats, hand.smallBlindSeatId).filter((seat) => seat.stack > 0 || seat.status !== 'out')
  for (let round = 0; round < 2; round += 1) {
    for (const seat of order) {
      seat.holeCards.push(drawOne(hand))
    }
  }
  for (const seat of order) {
    appendEvent(hand, { type: 'holeCardsDealt', seatId: seat.id, cards: seat.holeCards }, seat.id)
  }
}

function dealCommunityToStreet(hand: HandState): void {
  const targetCount: Record<Street, number> = {
    preflop: 0,
    flop: 3,
    turn: 4,
    river: 5,
    showdown: 5,
  }
  while (hand.communityCards.length < targetCount[hand.street]) {
    hand.communityCards.push(drawOne(hand))
  }
}

function drawOne(hand: HandState): Card {
  const card = hand.deck.shift()
  if (!card) {
    throw new Error('The deck ran out of cards.')
  }
  return card
}

function toPublicSeatView(state: GameState, seat: SeatState): PublicSeatView {
  const hand = state.hand
  return {
    id: seat.id,
    name: seat.name,
    kind: seat.kind,
    stack: seat.stack,
    status: seat.status,
    streetContribution: hand?.streetContributions[seat.id] ?? 0,
    totalContribution: hand?.totalContributions[seat.id] ?? 0,
    isDealer: hand?.dealerSeatId === seat.id,
    isSmallBlind: hand?.smallBlindSeatId === seat.id,
    isBigBlind: hand?.bigBlindSeatId === seat.id,
    revealedCards: hand?.result?.revealedCards[seat.id],
  }
}

function filterEventsForSeat(events: HandHistoryEvent[], seatId: SeatId | 'public'): HandHistoryEvent[] {
  return events.filter((event) => event.visibility === 'public' || event.visibility === seatId)
}

function chooseNextDealer(state: GameState): SeatId {
  if (!state.dealerSeatId) {
    return state.seats.find((seat) => seat.stack > 0)?.id ?? state.seats[0].id
  }
  return nextSeatId(state.seats, state.dealerSeatId, (seat) => seat.stack > 0)
}

function nextSeatId(seats: SeatState[], fromSeatId: SeatId, predicate: (seat: SeatState) => boolean): SeatId {
  const next = orderAfterSeat(seats, fromSeatId).find(predicate)
  if (!next) {
    throw new Error('No eligible next seat found.')
  }
  return next.id
}

function orderAfterSeat(seats: SeatState[], fromSeatId: SeatId): SeatState[] {
  const startIndex = seats.findIndex((seat) => seat.id === fromSeatId)
  return [...seats.slice(startIndex + 1), ...seats.slice(0, startIndex + 1)]
}

function orderFromSeat(seats: SeatState[], fromSeatId: SeatId): SeatState[] {
  const startIndex = seats.findIndex((seat) => seat.id === fromSeatId)
  return [...seats.slice(startIndex), ...seats.slice(0, startIndex)]
}

function nextStreet(street: Street): Street {
  if (street === 'preflop') {
    return 'flop'
  }
  if (street === 'flop') {
    return 'turn'
  }
  return 'river'
}

function canSeatAct(seat: SeatState): boolean {
  return seat.status === 'active' && seat.stack > 0
}

function canRunOutWithoutMoreAction(state: GameState, contenders: SeatState[], ableToAct: SeatState[]): boolean {
  if (ableToAct.length === 0) {
    return true
  }
  if (ableToAct.length !== 1 || !contenders.some((seat) => seat.status === 'all-in')) {
    return false
  }
  const hand = requireHand(state)
  const onlyActor = ableToAct[0]
  return (hand.streetContributions[onlyActor.id] ?? 0) >= hand.currentBet
}

function addActedSeat(hand: HandState, seatId: SeatId): void {
  if (!hand.actedThisRound.includes(seatId)) {
    hand.actedThisRound.push(seatId)
  }
}

function totalPot(hand: HandState): number {
  return Object.values(hand.totalContributions).reduce((sum, amount) => sum + amount, 0)
}

function validateFixedDeck(deck: Card[] | undefined, activeSeatCount: number): string | undefined {
  if (!deck) {
    return undefined
  }
  const minimumCards = activeSeatCount * 2 + 5
  if (deck.length < minimumCards) {
    return `A fixed deck must contain at least ${minimumCards} cards for this hand.`
  }
  if (!assertUniqueCards(deck)) {
    return 'A fixed deck cannot contain duplicate cards.'
  }
  return undefined
}

function emptyContributionMap(seats: SeatState[]): Record<SeatId, number> {
  return Object.fromEntries(seats.map((seat) => [seat.id, 0]))
}

function dedupeActions(actions: LegalAction[]): LegalAction[] {
  return actions.filter((action, index) => {
    if (action.type !== 'allIn') {
      return true
    }
    return actions.findIndex((candidate) => candidate.type === 'allIn') === index
  })
}

function requireHand(state: GameState): HandState {
  if (!state.hand) {
    throw new Error('Expected an active hand.')
  }
  return state.hand
}

function requireSeat(state: GameState, seatId: SeatId): SeatState {
  const seat = state.seats.find((candidate) => candidate.id === seatId)
  if (!seat) {
    throw new Error(`Unknown seat ${seatId}.`)
  }
  return seat
}

function appendEvent(
  hand: HandState,
  payload: HandHistoryPayload,
  visibility: 'public' | SeatId,
  commandId?: string,
): HandHistoryEvent {
  const sequenceNumber = hand.history.length + 1
  const { type, ...eventPayload } = payload
  const event = {
    schemaVersion: 'poker-event-v1',
    eventId: `hand-${hand.id}-event-${sequenceNumber}`,
    sequenceNumber,
    handId: hand.id,
    ...(commandId ? { commandId } : {}),
    visibility,
    type,
    payload: eventPayload,
  } as HandHistoryEvent

  hand.history.push(event)
  return event
}

function error<T extends GameState>(
  state: T,
  reason: EngineError['reason'],
  message: string,
  seatId?: SeatId,
): EngineResult<T> {
  return { ok: false, state, error: { reason, message, seatId } }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function hashStringState(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2_147_483_647
  }
  return hash || 1
}

export function assertSerializableState(state: GameState): boolean {
  const copy = clone(state)
  const cards = [
    ...state.seats.flatMap((seat) => seat.holeCards),
    ...(state.hand?.communityCards ?? []),
    ...(state.hand?.deck ?? []),
  ]
  return JSON.stringify(copy) === JSON.stringify(state) && assertUniqueCards(cards)
}

export function playerKindForSeat(state: GameState, seatId: SeatId): PlayerKind | undefined {
  return state.seats.find((seat) => seat.id === seatId)?.kind
}

export function playerStatusForSeat(state: GameState, seatId: SeatId): PlayerStatus | undefined {
  return state.seats.find((seat) => seat.id === seatId)?.status
}
