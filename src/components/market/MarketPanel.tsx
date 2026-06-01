/**
 * MarketPanel.tsx — Storage inventory and market prices
 */

import { useGameStore } from '@store/gameStore'
import { CropType } from '@engine/types'

const CROP_LABELS: Partial<Record<CropType, string>> = {
  [CropType.Tobacco]:     'Tobacco',
  [CropType.Rice]:        'Rice',
  [CropType.Indigo]:      'Indigo',
  [CropType.Corn]:        'Corn',
  [CropType.Cowpeas]:     'Cowpeas',
  [CropType.SweetPotato]: 'Sweet Potato',
}

export default function MarketPanel() {
  const gameState = useGameStore(s => s.gameState)
  if (!gameState) return null

  const { storage, market, finances } = gameState
  const totalStored = Object.values(storage.inventory).reduce((s, q) => s + (q ?? 0), 0)
  const storageUsed = totalStored
  const storagePct  = storage.capacity > 0 ? Math.round((storageUsed / storage.capacity) * 100) : 0

  return (
    <div className="p-4 flex flex-col gap-4">
      <h2 className="font-serif text-earth-100 text-xl">Storage & Market</h2>

      {/* Storage capacity */}
      <div className="bg-earth-800 border border-earth-700 rounded p-4">
        <div className="flex justify-between mb-1">
          <span className="text-earth-300 text-sm">Storage</span>
          <span className="text-earth-400 text-xs">{storageUsed} / {storage.capacity} units</span>
        </div>
        {storage.capacity === 0 ? (
          <p className="text-soil-poor text-xs">No storage built — crops rot at harvest. Build a smokehouse.</p>
        ) : (
          <div className="w-full bg-earth-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full ${storagePct > 80 ? 'bg-soil-poor' : 'bg-earth-400'}`}
              style={{ width: `${Math.min(100, storagePct)}%` }}
            />
          </div>
        )}
      </div>

      {/* Current inventory */}
      {totalStored > 0 && (
        <div className="bg-earth-800 border border-earth-700 rounded p-4">
          <h3 className="font-serif text-earth-200 text-sm mb-3">In Storage</h3>
          {(Object.entries(storage.inventory) as [CropType, number][])
            .filter(([, qty]) => qty > 0)
            .map(([crop, qty]) => {
              const price = market.prices[crop] ?? 0
              const value = qty * price
              return (
                <div key={crop} className="flex justify-between items-center py-1.5 border-b border-earth-700 last:border-0">
                  <div>
                    <span className="text-earth-200 text-sm">{CROP_LABELS[crop] ?? crop}</span>
                    <span className="text-earth-500 text-xs ml-2">{qty} units</span>
                  </div>
                  <div className="text-right">
                    <div className="text-earth-300 text-xs">${price.toFixed(2)}/unit</div>
                    <div className="text-earth-200 text-sm font-mono">${value.toFixed(0)}</div>
                  </div>
                </div>
              )
            })
          }
        </div>
      )}

      {/* Market prices */}
      <div className="bg-earth-800 border border-earth-700 rounded p-4">
        <h3 className="font-serif text-earth-200 text-sm mb-3">Current Prices</h3>
        {(Object.entries(market.prices) as [CropType, number][]).map(([crop, price]) => (
          <div key={crop} className="flex justify-between py-1">
            <span className="text-earth-300 text-sm">{CROP_LABELS[crop] ?? crop}</span>
            <span className="text-earth-200 text-sm font-mono">${price.toFixed(2)}</span>
          </div>
        ))}
      </div>

      {/* Queued sales */}
      {finances.queuedSales.length > 0 && (
        <div className="bg-earth-800 border border-earth-700 rounded p-4">
          <h3 className="font-serif text-earth-200 text-sm mb-3">Queued Sales</h3>
          {finances.queuedSales.map(sale => (
            <div key={sale.id} className="text-earth-400 text-xs py-1">
              {sale.quantity} units of {sale.crop}
              {sale.minPriceFloor ? ` (floor: $${sale.minPriceFloor})` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
