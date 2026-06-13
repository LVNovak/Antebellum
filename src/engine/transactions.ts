/**
 * transactions.ts
 *
 * Small helper for recording financial transactions.
 *
 * Every action that changes cashOnHand should call recordTransaction()
 * to append an entry to the transaction log. This is the single place
 * that defines what a transaction record looks like, so the Ledger UI
 * can render a consistent history regardless of what caused the change.
 */

import { Transaction, Season } from './types'

/**
 * Builds a new Transaction record.
 *
 * @param description   - plain-language description, e.g. "Hired Solomon (Enslaved, Hired-Out)"
 * @param amount         - positive for income, negative for expense
 * @param newCashOnHand  - the cashOnHand value AFTER applying this transaction
 * @param season / year  - when this happened
 */
export function recordTransaction(params: {
  description:   string
  amount:        number
  newCashOnHand: number
  season:        Season
  year:          number
}): Transaction {
  return {
    id:             Math.random().toString(36).slice(2, 10),
    season:         params.season,
    year:           params.year,
    description:    params.description,
    amount:         params.amount,
    runningBalance: params.newCashOnHand,
  }
}
