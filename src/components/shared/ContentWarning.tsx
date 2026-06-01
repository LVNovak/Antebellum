/**
 * ContentWarning.tsx
 *
 * Shown on first launch. Dismissed permanently via LocalStorage.
 * Required per GDD Section 17.
 */

import { useState } from 'react'

const WARNING_KEY = 'antebellum-warning-dismissed'

export default function ContentWarning() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(WARNING_KEY) === 'true'
  )

  if (dismissed) return null

  function handleDismiss() {
    localStorage.setItem(WARNING_KEY, 'true')
    setDismissed(true)
  }

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-6">
      <div className="bg-earth-900 border border-earth-700 rounded max-w-sm w-full p-6 flex flex-col gap-4">
        <h2 className="font-serif text-xl text-earth-100">Before You Begin</h2>
        <p className="text-earth-300 text-sm leading-relaxed">
          This game depicts the institution of chattel slavery as a central mechanic
          because it was the central institution of colonial Carolina's economy.
        </p>
        <p className="text-earth-300 text-sm leading-relaxed">
          Enslaved people are represented as individuals with names, histories, and
          lives — not as abstract units or resources. The system's moral weight is
          carried by the mechanics, not explained away by the text.
        </p>
        <p className="text-earth-400 text-xs leading-relaxed">
          The game also depicts indentured servitude and historical labor conditions
          across racial lines. Player discretion is advised.
        </p>
        <button
          onClick={handleDismiss}
          className="mt-2 w-full py-3 bg-earth-700 border border-earth-500 text-earth-100 font-serif rounded"
        >
          I understand — Continue
        </button>
      </div>
    </div>
  )
}
