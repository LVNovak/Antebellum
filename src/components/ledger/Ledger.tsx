/**
 * Ledger.tsx — Financial dashboard
 */

import { useGameStore } from '@store/gameStore'

export default function Ledger() {
  const gameState = useGameStore(s => s.gameState)
  if (!gameState) return null

  const { finances } = gameState
  const totalDebt = finances.factorAdvanceDebt + finances.mortgageDebt + finances.personalNoteDebt
  const netPosition = finances.cashOnHand - totalDebt

  return (
    <div className="p-4 flex flex-col gap-4">
      <h2 className="font-serif text-earth-100 text-xl">Ledger</h2>

      {/* Cash position */}
      <div className="bg-earth-800 border border-earth-700 rounded p-4">
        <div className="flex justify-between items-center">
          <span className="text-earth-300 text-sm">Cash on hand</span>
          <span className={`font-mono font-bold text-lg ${finances.cashOnHand >= 0 ? 'text-soil-good' : 'text-soil-poor'}`}>
            ${finances.cashOnHand.toFixed(0)}
          </span>
        </div>
        <div className="flex justify-between items-center mt-1">
          <span className="text-earth-300 text-sm">Total debt</span>
          <span className="font-mono text-soil-poor">${totalDebt.toFixed(0)}</span>
        </div>
        <div className="border-t border-earth-700 mt-2 pt-2 flex justify-between items-center">
          <span className="text-earth-200 text-sm font-bold">Net position</span>
          <span className={`font-mono font-bold ${netPosition >= 0 ? 'text-soil-good' : 'text-soil-poor'}`}>
            ${netPosition.toFixed(0)}
          </span>
        </div>
      </div>

      {/* Debt breakdown */}
      {totalDebt > 0 && (
        <div className="bg-earth-800 border border-earth-700 rounded p-4">
          <h3 className="font-serif text-earth-200 text-sm mb-3">Debt Obligations</h3>
          {finances.factorAdvanceDebt > 0 && (
            <DebtRow label="Factor advance" amount={finances.factorAdvanceDebt} />
          )}
          {finances.mortgageDebt > 0 && (
            <DebtRow label="Land mortgage" amount={finances.mortgageDebt} />
          )}
          {finances.personalNoteDebt > 0 && (
            <DebtRow label="Personal note" amount={finances.personalNoteDebt} />
          )}
        </div>
      )}

      {/* Factor relationship */}
      <div className="bg-earth-800 border border-earth-700 rounded p-4">
        <h3 className="font-serif text-earth-200 text-sm mb-1">
          Factor: {finances.factor.name}
        </h3>
        <p className="text-earth-400 text-xs">{finances.factor.city}</p>
        <div className="mt-2 flex justify-between">
          <span className="text-earth-300 text-xs">Relationship</span>
          <span className="text-earth-200 text-xs">{finances.factor.relationshipScore}/100</span>
        </div>
        <div className="w-full bg-earth-700 rounded-full h-1.5 mt-1">
          <div
            className="h-1.5 rounded-full bg-earth-400"
            style={{ width: `${finances.factor.relationshipScore}%` }}
          />
        </div>
      </div>

      {/* Transaction history */}
      <div className="bg-earth-800 border border-earth-700 rounded p-4">
        <h3 className="font-serif text-earth-200 text-sm mb-3">Transaction History</h3>
        {gameState.transactionLog.length === 0 ? (
          <p className="text-earth-500 text-xs italic">No transactions yet.</p>
        ) : (
          <div className="flex flex-col gap-1 max-h-96 overflow-y-auto">
            {[...gameState.transactionLog].reverse().map(tx => (
              <div key={tx.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-earth-800 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="text-earth-300 text-xs truncate">{tx.description}</p>
                  <p className="text-earth-600 text-[10px]">{tx.season}, Year {tx.year}</p>
                </div>
                <div className="text-right shrink-0">
                  {tx.amount !== 0 && (
                    <p className={`font-mono text-xs font-bold ${tx.amount > 0 ? 'text-soil-good' : 'text-soil-poor'}`}>
                      {tx.amount > 0 ? '+' : ''}{tx.amount.toFixed(0)}
                    </p>
                  )}
                  <p className="text-earth-500 text-[10px] font-mono">
                    bal: ${tx.runningBalance.toFixed(0)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function DebtRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-earth-400 text-xs">{label}</span>
      <span className="font-mono text-soil-poor text-sm">${amount.toFixed(0)}</span>
    </div>
  )
}
