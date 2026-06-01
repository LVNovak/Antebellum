/**
 * StartScreen.tsx
 *
 * Shown when no game is in progress.
 * Lets the player start a new game or load a saved one.
 * New game flow: choose name → choose origin → choose starting capital → begin.
 */

import { useState } from 'react'
import { useGameStore } from '@store/gameStore'
import { Origin, StartingCapital } from '@engine/types'

type Step = 'home' | 'newgame'

export default function StartScreen() {
  const startNewGame = useGameStore(s => s.startNewGame)
  const loadGame     = useGameStore(s => s.loadGame)
  const isPlaying    = useGameStore(s => s.isPlaying)

  const [step, setStep]                     = useState<Step>('home')
  const [playerName, setPlayerName]         = useState('')
  const [origin, setOrigin]                 = useState<Origin>(Origin.LotteryWinner)
  const [capital, setCapital]               = useState<StartingCapital>(StartingCapital.CashBuyer)
  const [hasSavedGame]                      = useState(() => !!localStorage.getItem('antebellum-save-v1'))

  function handleStart() {
    if (!playerName.trim()) return
    startNewGame({ playerName: playerName.trim(), origin, startingCapital: capital })
  }

  if (step === 'newgame') {
    return (
      <div className="min-h-screen bg-earth-900 flex flex-col items-center justify-start p-6 gap-6 overflow-y-auto">
        <h1 className="font-serif text-3xl text-earth-100 mt-8">New Plantation</h1>

        {/* Player name */}
        <div className="w-full max-w-sm">
          <label className="block text-earth-300 text-sm mb-1">Your name</label>
          <input
            type="text"
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
            placeholder="Enter your name"
            className="w-full bg-earth-800 border border-earth-600 text-earth-100 px-3 py-2 rounded font-serif"
          />
        </div>

        {/* Origin */}
        <div className="w-full max-w-sm">
          <label className="block text-earth-300 text-sm mb-2">Land grant origin</label>
          <div className="flex flex-col gap-2">
            {ORIGIN_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setOrigin(opt.value)}
                className={`text-left px-4 py-3 rounded border transition-colors ${
                  origin === opt.value
                    ? 'bg-earth-600 border-earth-400 text-earth-100'
                    : 'bg-earth-800 border-earth-700 text-earth-300'
                }`}
              >
                <div className="font-bold text-sm">{opt.label}</div>
                <div className="text-xs mt-0.5 opacity-75">{opt.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Starting capital */}
        <div className="w-full max-w-sm">
          <label className="block text-earth-300 text-sm mb-2">Starting capital</label>
          <div className="flex flex-col gap-2">
            {CAPITAL_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setCapital(opt.value)}
                className={`text-left px-4 py-3 rounded border transition-colors ${
                  capital === opt.value
                    ? 'bg-earth-600 border-earth-400 text-earth-100'
                    : 'bg-earth-800 border-earth-700 text-earth-300'
                }`}
              >
                <div className="font-bold text-sm">{opt.label}</div>
                <div className="text-xs mt-0.5 opacity-75">{opt.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Begin */}
        <div className="w-full max-w-sm flex gap-3 pb-8">
          <button
            onClick={() => setStep('home')}
            className="flex-1 py-3 border border-earth-600 text-earth-300 rounded font-serif"
          >
            Back
          </button>
          <button
            onClick={handleStart}
            disabled={!playerName.trim()}
            className="flex-1 py-3 bg-earth-600 text-earth-100 rounded font-serif font-bold disabled:opacity-40"
          >
            Begin
          </button>
        </div>
      </div>
    )
  }

  // Home step
  return (
    <div className="min-h-screen bg-earth-900 flex flex-col items-center justify-center p-8 gap-8">
      <div className="text-center">
        <h1 className="font-serif text-5xl text-earth-100 mb-2">Antebellum</h1>
        <p className="text-earth-400 text-sm italic">A colonial Carolina plantation economy simulator</p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={() => setStep('newgame')}
          className="w-full py-4 bg-earth-700 border border-earth-500 text-earth-100 font-serif text-lg rounded"
        >
          New Plantation
        </button>

        {hasSavedGame && (
          <button
            onClick={() => loadGame()}
            className="w-full py-4 bg-earth-800 border border-earth-600 text-earth-200 font-serif text-lg rounded"
          >
            Continue
          </button>
        )}
      </div>

      <p className="text-earth-600 text-xs text-center max-w-xs">
        This game depicts the institution of chattel slavery as a central mechanic
        because it was the central institution of colonial Carolina's economy.
      </p>
    </div>
  )
}

const ORIGIN_OPTIONS: { value: Origin; label: string; description: string }[] = [
  {
    value: Origin.VeteranWarrant,
    label: "Veteran's Bounty Warrant",
    description: '160 acres of frontier land. Low cash. No debt. Unknown soil.',
  },
  {
    value: Origin.PlanterSon,
    label: 'Younger Son of a Planter',
    description: '80 acres, partially cleared. Moderate cash. Good soil hints.',
  },
  {
    value: Origin.LotteryWinner,
    label: 'Land Lottery Winner',
    description: '40 acres, completely unknown. No cash. A true gamble.',
  },
  {
    value: Origin.ImmigrantEntrepreneur,
    label: 'Immigrant Entrepreneur',
    description: '40 acres. High starting cash but a small personal debt.',
  },
]

const CAPITAL_OPTIONS: { value: StartingCapital; label: string; description: string }[] = [
  {
    value: StartingCapital.CashBuyer,
    label: 'Cash Buyer',
    description: '$800–$1,200 cash. No credit line. Slow to scale.',
  },
  {
    value: StartingCapital.FinancedEntry,
    label: 'Financed Entry',
    description: '$200–$400 cash plus a factor advance. Debt from day one.',
  },
  {
    value: StartingCapital.FamilyLoan,
    label: 'Family Loan',
    description: '$400–$600 cash plus a personal note. Moderate pressure.',
  },
]
