import type { CompletedSessionPackage, ParaPokerSiteImportActionPreview } from './completedSessionPackage'

const PARA_SITE_CSV_COLUMNS = [
  'session_number',
  'session_code',
  'season_code',
  'table_name',
  'format',
  'played_at',
  'hand_no',
  'hand_code',
  'start_time',
  'board',
  'winner_name',
  'pot_collected',
  'winning_hand',
  'showdown',
  'raw_result',
  'log_order',
  'street',
  'player_name',
  'action',
  'amount',
  'target_contribution',
  'raise_to',
  'all_in',
  'raw_entry',
] as const

type ParaSiteCsvColumn = typeof PARA_SITE_CSV_COLUMNS[number]

export function completedSessionPackageToParaPokerSiteCsv(completedPackage: CompletedSessionPackage): string {
  const sessionNumber = stableSessionNumber(completedPackage.paraPokerSite.metadata.sessionCode)
  const rows = completedPackage.paraPokerSite.hands.flatMap((hand) => {
    const actions = hand.actions.length > 0
      ? hand.actions
      : [emptyActionForHand(hand.hand_no, hand.hand_code)]
    return actions.map((action) => ({
      session_number: String(sessionNumber),
      session_code: completedPackage.paraPokerSite.metadata.sessionCode,
      season_code: completedPackage.paraPokerSite.metadata.seasonCode,
      table_name: completedPackage.paraPokerSite.metadata.tableName,
      format: completedPackage.paraPokerSite.metadata.format,
      played_at: completedPackage.paraPokerSite.metadata.playedAt ?? completedPackage.source.packageCreatedAt,
      hand_no: String(hand.hand_no),
      hand_code: hand.hand_code,
      start_time: hand.start_time,
      board: hand.board,
      winner_name: hand.winner_name,
      pot_collected: String(hand.pot_collected),
      winning_hand: hand.winning_hand,
      showdown: String(hand.showdown),
      raw_result: hand.raw_result,
      log_order: String(action.log_order),
      street: action.street,
      player_name: action.player_name,
      action: action.action,
      amount: String(action.amount),
      target_contribution: String(action.target_contribution),
      raise_to: action.raise_to === undefined ? '' : String(action.raise_to),
      all_in: String(action.all_in),
      raw_entry: action.raw_entry,
    } satisfies Record<ParaSiteCsvColumn, string>))
  })

  return [
    PARA_SITE_CSV_COLUMNS.join(','),
    ...rows.map((row) => PARA_SITE_CSV_COLUMNS.map((column) => csvCell(row[column])).join(',')),
  ].join('\n')
}

export function stableSessionNumber(sessionCode: string): number {
  let hash = 2166136261
  for (let index = 0; index < sessionCode.length; index += 1) {
    hash ^= sessionCode.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % 2_000_000_000 + 1
}

function emptyActionForHand(handNo: number, handCode: string): ParaPokerSiteImportActionPreview {
  return {
    hand_no: handNo,
    hand_code: handCode,
    log_order: 1,
    street: 'preflop',
    player_name: '',
    action: '',
    amount: 0,
    target_contribution: 0,
    all_in: false,
    raw_entry: '',
  }
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}
