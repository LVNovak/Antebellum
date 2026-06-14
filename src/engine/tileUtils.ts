/**
 * tileUtils.ts
 *
 * Shared display utilities for tiles — used by both PlantationMap and
 * SeasonPlanner so tile names are always consistent across the UI.
 */

import { Tile, CropType } from './types'

const CROP_DISPLAY_NAMES: Record<CropType, string> = {
  [CropType.Tobacco]:     'Tobacco',
  [CropType.Rice]:        'Rice',
  [CropType.Corn]:        'Corn',
  [CropType.Cowpeas]:     'Cowpeas',
  [CropType.SweetPotato]: 'Sweet Potato',
  [CropType.Indigo]:      'Indigo',
  [CropType.CoverCrop]:   'Cover Crop',
  [CropType.Fallow]:      'Fallow',
}

/**
 * Returns the display label for a tile based on its current state,
 * not its original terrain type.
 *
 * Uncleared tiles: show terrain type (that's what the player needs to know)
 * Cleared tiles: show current use (terrain is irrelevant once cleared)
 */
export function getTileDisplayLabel(tile: Tile): string {
  if (!tile.isCleared) {
    return `${tile.terrain} (uncleared)`
  }
  if (tile.currentCrop === CropType.Fallow) return 'Fallow — resting'
  if (tile.currentCrop === CropType.CoverCrop) return 'Cover Crop'
  if (tile.currentCrop) return `Field — ${CROP_DISPLAY_NAMES[tile.currentCrop]}`
  return 'Cleared Field'
}

/**
 * Returns the clearing progress description for uncleared tiles.
 */
export function getTileProgressDescription(tile: Tile): string {
  if (tile.isCleared) return ''
  const remaining = tile.clearingProgressRemaining
  return `${remaining.toFixed(1)} labor-unit(s) to clear`
}
