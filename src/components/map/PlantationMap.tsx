/**
 * PlantationMap.tsx
 *
 * The main land view — a grid of tiles showing the plantation.
 *
 * Each tile shows:
 *   - Terrain type icon
 *   - Current crop (if any)
 *   - Soil health color (green/yellow/red/grey) — never numeric values
 *   - Cleared vs. uncleared state
 *
 * Tapping a tile opens a detail panel for that tile.
 * Soil health is communicated by color only — numbers never shown to player.
 */

import { useState } from 'react'
import { useGameStore } from '@store/gameStore'
import { Tile, CropType, TerrainType } from '@engine/types'
import { getSoilColorCategory } from '@engine/soil'

export default function PlantationMap() {
  const gameState    = useGameStore(s => s.gameState)
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null)

  if (!gameState) return null

  const selectedTile = gameState.tiles.find(t => t.id === selectedTileId) ?? null

  return (
    <div className="p-4 flex flex-col gap-4">
      <h2 className="font-serif text-earth-100 text-xl">Your Land</h2>

      {/* Tile grid */}
      <div className="grid grid-cols-5 gap-2">
        {gameState.tiles.map(tile => (
          <TileCard
            key={tile.id}
            tile={tile}
            isSelected={tile.id === selectedTileId}
            onTap={() => setSelectedTileId(tile.id === selectedTileId ? null : tile.id)}
          />
        ))}
      </div>

      {/* Soil health legend */}
      <div className="flex gap-3 text-xs text-earth-400">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-soil-good inline-block" /> Good</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-soil-fair inline-block" /> Fair</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-soil-poor inline-block" /> Poor</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-soil-exhausted inline-block" /> Exhausted</span>
      </div>

      {/* Tile detail panel */}
      {selectedTile && <TileDetail tile={selectedTile} />}
    </div>
  )
}

// ── Tile card ──────────────────────────────────────────────────────────────

function TileCard({
  tile, isSelected, onTap
}: {
  tile: Tile
  isSelected: boolean
  onTap: () => void
}) {
  const soilColor  = tile.isCleared ? getSoilColorCategory(tile.soil) : 'exhausted'
  const soilBorder = SOIL_BORDER_CLASSES[soilColor]

  return (
    <button
      onClick={onTap}
      className={`aspect-square rounded flex flex-col items-center justify-center gap-0.5 border-2 transition-colors bg-earth-800 ${
        isSelected ? 'border-earth-300' : soilBorder
      }`}
    >
      {/* Terrain / crop icon */}
      <span className="text-xl leading-none">
        {tile.isCleared
          ? (tile.currentCrop ? CROP_ICONS[tile.currentCrop] : TERRAIN_ICONS[tile.terrain])
          : '🌲'}
      </span>

      {/* Soil health dot — color only, no number */}
      {tile.isCleared && (
        <span className={`w-2 h-2 rounded-full ${SOIL_DOT_CLASSES[soilColor]}`} />
      )}
    </button>
  )
}

// ── Tile detail panel ──────────────────────────────────────────────────────

function TileDetail({ tile }: { tile: Tile }) {
  const soilColor = getSoilColorCategory(tile.soil)

  return (
    <div className="bg-earth-800 border border-earth-700 rounded p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-earth-100">{TERRAIN_LABELS[tile.terrain]}</h3>
        {tile.isCleared && (
          <span className={`text-xs px-2 py-0.5 rounded ${SOIL_BADGE_CLASSES[soilColor]}`}>
            Soil: {soilColor.charAt(0).toUpperCase() + soilColor.slice(1)}
          </span>
        )}
      </div>

      {!tile.isCleared && (
        <p className="text-earth-400 text-sm">
          Uncleared land. {tile.clearingProgressRemaining} labor-season(s) of clearing remain.
        </p>
      )}

      {tile.isCleared && tile.currentCrop && (
        <p className="text-earth-300 text-sm">
          Currently planted: <strong>{tile.currentCrop}</strong>
        </p>
      )}

      {tile.isCleared && !tile.currentCrop && (
        <p className="text-earth-400 text-sm italic">No crop planted this season.</p>
      )}

      {tile.hasStumpRot && (
        <p className="text-earth-500 text-xs">
          Stump rot is active — soil life is suppressed. {tile.stumpRotSeasonsLeft} season(s) remaining.
        </p>
      )}

      {tile.isWaterAdjacent && (
        <p className="text-earth-400 text-xs">Water-adjacent — suitable for rice.</p>
      )}
    </div>
  )
}

// ── Icon and style maps ────────────────────────────────────────────────────

const TERRAIN_ICONS: Record<TerrainType, string> = {
  [TerrainType.Forest]: '🌳',
  [TerrainType.Swamp]:  '🌾',
  [TerrainType.Upland]: '⬜',
}

const TERRAIN_LABELS: Record<TerrainType, string> = {
  [TerrainType.Forest]: 'Forest Parcel',
  [TerrainType.Swamp]:  'Wetland Parcel',
  [TerrainType.Upland]: 'Upland Parcel',
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
