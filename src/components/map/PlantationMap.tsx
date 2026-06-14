/**
 * PlantationMap.tsx
 *
 * The main overview — shows land parcels AND buildings as separate
 * tappable elements, each opening an info panel below the grid.
 *
 * Land tiles show:
 *   - Terrain icon (uncleared) or crop icon (cleared)
 *   - Soil health color border — shown on ALL cleared tiles
 *   - Clearing progress badge — shown on uncleared tiles, expressed as
 *     an estimated number of seasons remaining at current staffing
 *
 * Buildings show:
 *   - Cabins (always present)
 *   - Smokehouse (once built)
 *
 * As more parcels are purchased, this grid grows — each tile remains
 * independently manageable. This grid IS the land-subdivision view.
 */

import { useState } from 'react'
import { useGameStore } from '@store/gameStore'
import { Tile, CropType, TerrainType, Cabin, CabinCondition, Worker, Storage } from '@engine/types'
import { getSoilColorCategory, getCompositeScore } from '@engine/soil'
import { getTileDisplayLabel } from '@engine/tileUtils'
import {
  STORAGE_CAPACITY_SMOKEHOUSE,
  STORAGE_CAPACITY_STOREHOUSE,
  LABOR_UNITS_PER_WORKER_PER_SEASON,
} from '@engine/constants'

type SelectedItem =
  | { kind: 'tile';    id: string }
  | { kind: 'cabin';   id: string }
  | { kind: 'storage' }
  | { kind: 'compost' }
  | null

export default function PlantationMap() {
  const gameState = useGameStore(s => s.gameState)
  const [selected, setSelected] = useState<SelectedItem>(null)

  if (!gameState) return null

  const { tiles, cabins, storage, workers, compostFacilityBuilt, clearedMaterialOnHand } = gameState
  const smokehouseBuilt = storage.capacity >= STORAGE_CAPACITY_SMOKEHOUSE

  // Count workers assigned to clear tiles and to tend compost
  const clearingWorkersByTile = new Map<string, number>()
  let compostTenders = 0
  for (const w of workers) {
    const task = w.assignedTask
    if (task && task.type === 'ClearLand') {
      clearingWorkersByTile.set(task.tileId, (clearingWorkersByTile.get(task.tileId) ?? 0) + 1)
    }
    if (task && task.type === 'ManageStorage') compostTenders++
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      {/* ── LAND ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-serif text-earth-100 text-xl">Your Land</h2>
          <span className="text-earth-500 text-xs">{tiles.length} parcel{tiles.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {tiles.map((tile: Tile) => (
            <TileCard
              key={tile.id}
              tile={tile}
              workersClearingThisTile={clearingWorkersByTile.get(tile.id) ?? 0}
              isSelected={selected?.kind === 'tile' && selected.id === tile.id}
              onTap={() => setSelected(
                selected?.kind === 'tile' && selected.id === tile.id
                  ? null
                  : { kind: 'tile', id: tile.id }
              )}
            />
          ))}
        </div>

        {/* Soil health legend */}
        <div className="flex gap-3 text-xs text-earth-400 mt-2 flex-wrap">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-soil-good inline-block" /> Good soil</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-soil-fair inline-block" /> Fair soil</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-soil-poor inline-block" /> Poor soil</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-soil-exhausted inline-block" /> Exhausted</span>
        </div>
        <p className="text-earth-600 text-xs mt-1">
          More parcels can be purchased in Plan Season → Acquire Land &amp; Labor.
        </p>
      </div>

      {/* ── BUILDINGS ── */}
      <div>
        <h2 className="font-serif text-earth-100 text-xl mb-2">Buildings</h2>
        <div className="grid grid-cols-5 gap-2">
          {cabins.map((cabin: Cabin) => (
            <BuildingCard
              key={cabin.id}
              icon="🏠"
              label="Cabin"
              isSelected={selected?.kind === 'cabin' && selected.id === cabin.id}
              accentColor={CABIN_CONDITION_COLOR[cabin.condition]}
              onTap={() => setSelected(
                selected?.kind === 'cabin' && selected.id === cabin.id
                  ? null
                  : { kind: 'cabin', id: cabin.id }
              )}
            />
          ))}

          {smokehouseBuilt && (
            <BuildingCard
              icon="🏚"
              label="Smokehouse"
              isSelected={selected?.kind === 'storage'}
              accentColor="border-earth-400"
              onTap={() => setSelected(selected?.kind === 'storage' ? null : { kind: 'storage' })}
            />
          )}

          {compostFacilityBuilt && (
            <BuildingCard
              icon="♻️"
              label="Compost"
              isSelected={selected?.kind === 'compost'}
              accentColor={clearedMaterialOnHand > 0 ? 'border-soil-good' : 'border-earth-600'}
              onTap={() => setSelected(selected?.kind === 'compost' ? null : { kind: 'compost' })}
            />
          )}

          {!smokehouseBuilt && (
            <div className="aspect-square rounded border-2 border-dashed border-earth-700 flex flex-col items-center justify-center text-earth-600 text-xs text-center p-1">
              <span className="text-xl">＋</span>
              <span>Build via Plan Season</span>
            </div>
          )}
        </div>
      </div>

      {/* ── DETAIL PANEL ── */}
      {selected?.kind === 'tile' && (
        <TileDetail
          tile={tiles.find(t => t.id === selected.id)!}
          workersClearingThisTile={clearingWorkersByTile.get(selected.id) ?? 0}
        />
      )}
      {selected?.kind === 'cabin' && (
        <CabinDetail cabin={cabins.find(c => c.id === selected.id)!} workers={workers} />
      )}
      {selected?.kind === 'storage' && (
        <StorageDetail storage={storage} />
      )}
      {selected?.kind === 'compost' && (
        <CompostDetail
          clearedMaterialOnHand={clearedMaterialOnHand}
          compostTenders={compostTenders}
        />
      )}
    </div>
  )
}

// ── Tile card ──────────────────────────────────────────────────────────────

function TileCard({ tile, isSelected, onTap, workersClearingThisTile }: {
  tile: Tile
  isSelected: boolean
  onTap: () => void
  workersClearingThisTile: number
  [key: string]: unknown
}) {
  const soilColor = tile.isCleared ? getSoilColorCategory(tile.soil) : null
  const soilBorder = soilColor ? SOIL_BORDER_CLASSES[soilColor] : 'border-earth-700'

  return (
    <button
      onClick={onTap}
      className={`aspect-square rounded flex flex-col items-center justify-center gap-0.5 border-2 transition-colors bg-earth-800 relative ${
        isSelected ? 'border-earth-300' : soilBorder
      }`}
    >
      {/* Terrain / crop icon */}
      <span className="text-xl leading-none">
        {tile.isCleared
          ? (tile.currentCrop ? CROP_ICONS[tile.currentCrop] : TERRAIN_ICONS[tile.terrain])
          : '🌲'}
      </span>

      {/* Soil health dot — shown on all cleared tiles */}
      {tile.isCleared && soilColor && (
        <span className={`w-2 h-2 rounded-full ${SOIL_DOT_CLASSES[soilColor]}`} />
      )}

      {/* Clearing progress badge — shown on uncleared tiles */}
      {!tile.isCleared && (
        <span className={`absolute bottom-0.5 right-0.5 text-[10px] rounded px-1 leading-tight ${
          workersClearingThisTile > 0 ? 'bg-earth-600 text-earth-100' : 'bg-earth-900 text-earth-400'
        }`}>
          {formatClearingProgress(tile.clearingProgressRemaining)}
        </span>
      )}
    </button>
  )
}

// ── Building card ────────────────────────────────────────────────────────

function BuildingCard({ icon, label, isSelected, accentColor, onTap }: {
  icon: string
  label: string
  isSelected: boolean
  accentColor: string
  onTap: () => void
}) {
  return (
    <button
      onClick={onTap}
      className={`aspect-square rounded flex flex-col items-center justify-center gap-0.5 border-2 transition-colors bg-earth-800 ${
        isSelected ? 'border-earth-300' : accentColor
      }`}
    >
      <span className="text-xl leading-none">{icon}</span>
      <span className="text-[10px] text-earth-400">{label}</span>
    </button>
  )
}

// ── Tile detail panel ──────────────────────────────────────────────────────

function TileDetail({ tile, workersClearingThisTile }: { tile: Tile; workersClearingThisTile: number }) {
  const soilColor = getSoilColorCategory(tile.soil)
  const score     = getCompositeScore(tile.soil)

  return (
    <div className="bg-earth-800 border border-earth-700 rounded p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-earth-100">{getTileDisplayLabel(tile)}</h3>
        {tile.isCleared && (
          <span className={`text-xs px-2 py-0.5 rounded ${SOIL_BADGE_CLASSES[soilColor]}`}>
            Soil: {soilColor.charAt(0).toUpperCase() + soilColor.slice(1)}
          </span>
        )}
      </div>

      {!tile.isCleared && (
        <div className="flex flex-col gap-1">
          <p className="text-earth-400 text-sm">
            Uncleared {tile.terrain.toLowerCase()} land — {tile.clearingProgressRemaining.toFixed(1)} labor-unit(s) of clearing remain.
          </p>
          {workersClearingThisTile > 0 ? (
            <p className="text-earth-300 text-sm">
              {workersClearingThisTile} worker{workersClearingThisTile !== 1 ? 's' : ''} currently clearing —
              {' '}{formatClearingProgress(tile.clearingProgressRemaining)} at this pace.
            </p>
          ) : (
            <p className="text-earth-500 text-xs">
              No one is clearing this parcel. Assign workers to "Clear" in Plan Season.
            </p>
          )}
        </div>
      )}

      {tile.isCleared && (
        <>
          {tile.currentCrop ? (
            <p className="text-earth-300 text-sm">
              Currently planted: <strong>{tile.currentCrop}</strong>
            </p>
          ) : (
            <p className="text-earth-400 text-sm italic">No crop planted this season — ready to plant.</p>
          )}

          {/* Soil health bar — color only, no raw numbers per design */}
          <div className="w-full bg-earth-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full ${SOIL_DOT_CLASSES[soilColor]}`}
              style={{ width: `${Math.max(5, score)}%` }}
            />
          </div>
        </>
      )}

      {tile.hasStumpRot && (
        <p className="text-earth-500 text-xs">
          Stump rot is active — soil life is suppressed for {tile.stumpRotSeasonsLeft} more season(s).
        </p>
      )}

      {tile.isWaterAdjacent && (
        <p className="text-earth-400 text-xs">Water-adjacent — suitable for rice.</p>
      )}

      {/* Yield history */}
      {tile.history && tile.history.length > 0 && (
        <div>
          <p className="text-earth-400 text-xs font-bold mb-1">Field History</p>
          <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto">
            {[...tile.history].reverse().map((entry, i) => (
              <div key={i} className="flex items-center justify-between text-[10px]">
                <span className="text-earth-500">{entry.season}, Yr {entry.year}</span>
                <span className="text-earth-400">{entry.crop ?? 'Fallow'}</span>
                <span className="text-earth-300 font-mono">
                  {entry.yieldProduced > 0 ? `${entry.yieldProduced} units` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Cabin detail panel ──────────────────────────────────────────────────────

function CabinDetail({ cabin, workers }: { cabin: Cabin; workers: Worker[] }) {
  const occupants = workers.filter(w => cabin.occupants.includes(w.id))

  return (
    <div className="bg-earth-800 border border-earth-700 rounded p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-earth-100">Cabin</h3>
        <span className="text-xs px-2 py-0.5 rounded bg-earth-700 text-earth-300">
          Condition: {cabin.condition}
        </span>
      </div>

      <p className="text-earth-400 text-sm">
        {occupants.length} / {cabin.capacity} occupants
      </p>

      {occupants.length > 0 ? (
        <ul className="text-sm text-earth-300 flex flex-col gap-1">
          {occupants.map(w => (
            <li key={w.id}>{w.name} — {w.health}</li>
          ))}
        </ul>
      ) : (
        <p className="text-earth-500 text-xs italic">No one assigned to this cabin yet.</p>
      )}

      {(cabin.condition === CabinCondition.Poor || cabin.condition === CabinCondition.Damaged) && (
        <p className="text-soil-poor text-xs">
          This cabin needs repair. Assign workers to "Cabin Repair" in Plan Season.
        </p>
      )}
    </div>
  )
}

// ── Storage detail panel ────────────────────────────────────────────────────

function StorageDetail({ storage }: { storage: Storage }) {
  const used = Object.values(storage.inventory).reduce((s, q) => s + (q ?? 0), 0)
  const nextTier = storage.capacity >= STORAGE_CAPACITY_STOREHOUSE ? null : STORAGE_CAPACITY_STOREHOUSE
  const filled = Object.entries(storage.inventory).filter(([, q]) => (q ?? 0) > 0)

  return (
    <div className="bg-earth-800 border border-earth-700 rounded p-4 flex flex-col gap-3">
      <h3 className="font-serif text-earth-100">Smokehouse</h3>
      <p className="text-earth-400 text-sm">
        Storage capacity: <strong>{storage.capacity} units</strong>
      </p>
      <div className="w-full bg-earth-700 rounded-full h-2">
        <div
          className="h-2 rounded-full bg-earth-400"
          style={{ width: `${Math.min(100, (used / storage.capacity) * 100)}%` }}
        />
      </div>
      <p className="text-earth-500 text-xs">{used} / {storage.capacity} units used</p>

      {filled.length > 0 ? (
        <ul className="text-sm text-earth-300 flex flex-col gap-1">
          {filled.map(([crop, qty]) => (
            <li key={crop}>{crop}: {qty} units</li>
          ))}
        </ul>
      ) : (
        <p className="text-earth-500 text-xs italic">Empty — nothing in storage yet.</p>
      )}

      {nextTier && (
        <p className="text-earth-500 text-xs">
          A storehouse upgrade ($400-$800) would expand capacity to {nextTier}+ units.
        </p>
      )}
    </div>
  )
}

// ── Compost detail panel ──────────────────────────────────────────────────

function CompostDetail({ clearedMaterialOnHand, compostTenders }: {
  clearedMaterialOnHand: number
  compostTenders: number
}) {
  return (
    <div className="bg-earth-800 border border-earth-700 rounded p-4 flex flex-col gap-3">
      <h3 className="font-serif text-earth-100">Compost Facility</h3>
      <div className="flex justify-between text-sm">
        <span className="text-earth-400">Cleared material stockpile</span>
        <span className={`font-mono font-bold ${clearedMaterialOnHand > 0 ? 'text-soil-good' : 'text-earth-500'}`}>
          {clearedMaterialOnHand} unit{clearedMaterialOnHand !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-earth-400">Workers tending this season</span>
        <span className="font-mono text-earth-200">{compostTenders}</span>
      </div>
      <p className="text-earth-500 text-xs">
        {compostTenders > 0
          ? `${compostTenders} worker${compostTenders !== 1 ? 's' : ''} can apply compost to ${compostTenders} parcel${compostTenders !== 1 ? 's' : ''} this season. Apply via Plan Season → Land & Crops.`
          : 'Assign a worker to "Storage Management" in Plan Season to tend the compost operation.'}
      </p>
      {clearedMaterialOnHand === 0 && (
        <p className="text-earth-600 text-xs italic">
          No material to compost. Clear forest or swamp land to generate cleared material.
        </p>
      )}
    </div>
  )
}



/**
 * Converts remaining clearing labor-units into a human-readable estimate
 * of seasons remaining, given the global per-worker clearing rate.
 * Shown on the tile badge and in the detail panel.
 */
function formatClearingProgress(remaining: number): string {
  if (remaining <= 0) return 'Done'
  const seasonsWithOneWorker = Math.ceil(remaining / LABOR_UNITS_PER_WORKER_PER_SEASON)
  return `${seasonsWithOneWorker}s`
}

// ── Icon and style maps ────────────────────────────────────────────────────

const TERRAIN_ICONS: Record<TerrainType, string> = {
  [TerrainType.Forest]: '🌳',
  [TerrainType.Swamp]:  '🌾',
  [TerrainType.Upland]: '⬜',
}

const CROP_ICONS: Record<CropType, string> = {
  [CropType.Tobacco]:     '🌿',
  [CropType.Rice]:        '🌾',
  [CropType.Corn]:        '🌽',
  [CropType.Cowpeas]:     '🫘',
  [CropType.SweetPotato]: '🍠',
  [CropType.Indigo]:      '💙',
  [CropType.CoverCrop]:   '🌱',
  [CropType.Fallow]:      '◻️',
}

const SOIL_BORDER_CLASSES = {
  good:      'border-soil-good',
  fair:      'border-soil-fair',
  poor:      'border-soil-poor',
  exhausted: 'border-soil-exhausted',
}

const SOIL_DOT_CLASSES = {
  good:      'bg-soil-good',
  fair:      'bg-soil-fair',
  poor:      'bg-soil-poor',
  exhausted: 'bg-soil-exhausted',
}

const SOIL_BADGE_CLASSES = {
  good:      'bg-soil-good/20 text-soil-good',
  fair:      'bg-soil-fair/20 text-soil-fair',
  poor:      'bg-soil-poor/20 text-soil-poor',
  exhausted: 'bg-soil-exhausted/20 text-soil-exhausted',
}

const CABIN_CONDITION_COLOR: Record<CabinCondition, string> = {
  [CabinCondition.Good]:    'border-soil-good',
  [CabinCondition.Fair]:    'border-earth-600',
  [CabinCondition.Poor]:    'border-soil-fair',
  [CabinCondition.Damaged]: 'border-soil-poor',
}
