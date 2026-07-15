import type { CompletedSessionPackage } from './completedSessionPackage'
import { completedSessionPackageToPokerNowCsv } from './pokerNowCsv'

/**
 * The Para site currently accepts Poker Now-style raw CSV rows and discovers
 * hands from their explicit Hand # boundary entries.
 */
export function completedSessionPackageToParaPokerSiteCsv(completedPackage: CompletedSessionPackage): string {
  return completedSessionPackageToPokerNowCsv(completedPackage)
}
