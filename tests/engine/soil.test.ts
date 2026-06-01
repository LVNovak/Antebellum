/**
 * soil.test.ts
 *
 * Tests for the soil food web engine.
 * Run with: npm test
 */

import { describe, it, expect } from 'vitest'
import {
  computeYieldModifier,
  isSoilExhausted,
  hasCriticalSoilDeficiency,
  getSoilColorCategory,
  getCompositeScore,
  applySeasonalSoilUpdate,
} from '../../src/engine/soil'
import { SoilHealth, CropType, WeatherEvent, TerrainType } from '../../src/engine/types'

// Helper to build a tile-like object for testing
function makeTile(soil: SoilHealth, crop: CropType | null = null, hasStumpRot = false) {
  return {
    id: 'test-tile',
    terrain: TerrainType.Upland,
    isCleared: true,
    isWaterAdjacent: false,
    soil,
    currentCrop: crop,
    hasStumpRot,
    stumpRotSeasonsLeft: hasStumpRot ? 1 : 0,
    clearingProgressRemaining: 0,
  }
}

// Good healthy soil baseline
const GOOD_SOIL: SoilHealth = {
  organicMatter:     80,
  nitrogen:          75,
  soilFauna:         80,
  moistureRetention: 70,
}

// Exhausted soil — all values at or near zero
const EXHAUSTED_SOIL: SoilHealth = {
  organicMatter:     5,
  nitrogen:          5,
  soilFauna:         5,
  moistureRetention: 5,
}

describe('computeYieldModifier', () => {
  it('returns a value between 0 and 1', () => {
    const result = computeYieldModifier(GOOD_SOIL)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(1)
  })

  it('returns a high modifier for good soil', () => {
    const result = computeYieldModifier(GOOD_SOIL)
    expect(result).toBeGreaterThan(0.60)
  })

  it('returns a low modifier for exhausted soil', () => {
    const result = computeYieldModifier(EXHAUSTED_SOIL)
    expect(result).toBeLessThan(0.20)
  })

  it('returns 0 for all-zero soil', () => {
    const result = computeYieldModifier({
      organicMatter: 0, nitrogen: 0, soilFauna: 0, moistureRetention: 0
    })
    expect(result).toBe(0)
  })
})

describe('isSoilExhausted', () => {
  it('returns false for good soil', () => {
    expect(isSoilExhausted(GOOD_SOIL)).toBe(false)
  })

  it('returns true when all four values are below threshold', () => {
    expect(isSoilExhausted(EXHAUSTED_SOIL)).toBe(true)
  })

  it('returns false if only some values are low', () => {
    const partiallyDepleted: SoilHealth = {
      organicMatter:     5,     // low
      nitrogen:          60,    // fine
      soilFauna:         5,     // low
      moistureRetention: 60,    // fine
    }
    expect(isSoilExhausted(partiallyDepleted)).toBe(false)
  })
})

describe('hasCriticalSoilDeficiency', () => {
  it('returns false for healthy soil', () => {
    expect(hasCriticalSoilDeficiency(GOOD_SOIL)).toBe(false)
  })

  it('returns true if any single value is critically low', () => {
    const nitrogenDepleted: SoilHealth = { ...GOOD_SOIL, nitrogen: 5 }
    expect(hasCriticalSoilDeficiency(nitrogenDepleted)).toBe(true)
  })
})

describe('getSoilColorCategory', () => {
  it('returns good for healthy soil', () => {
    expect(getSoilColorCategory(GOOD_SOIL)).toBe('good')
  })

  it('returns exhausted for exhausted soil', () => {
    expect(getSoilColorCategory(EXHAUSTED_SOIL)).toBe('exhausted')
  })
})

describe('applySeasonalSoilUpdate', () => {
  it('depletes nitrogen when tobacco is planted', () => {
    const tile   = makeTile(GOOD_SOIL, CropType.Tobacco)
    const result = applySeasonalSoilUpdate(tile, WeatherEvent.Normal, false)
    expect(result.nitrogen).toBeLessThan(GOOD_SOIL.nitrogen)
  })

  it('restores nitrogen when cowpeas are planted', () => {
    const depletedSoil: SoilHealth = { ...GOOD_SOIL, nitrogen: 30 }
    const tile   = makeTile(depletedSoil, CropType.Cowpeas)
    const result = applySeasonalSoilUpdate(tile, WeatherEvent.Normal, false)
    expect(result.nitrogen).toBeGreaterThan(depletedSoil.nitrogen)
  })

  it('reduces moisture retention in drought', () => {
    const tile   = makeTile(GOOD_SOIL, CropType.Corn)
    const result = applySeasonalSoilUpdate(tile, WeatherEvent.Drought, false)
    expect(result.moistureRetention).toBeLessThan(GOOD_SOIL.moistureRetention)
  })

  it('applies manure boost when manure is applied', () => {
    const tile   = makeTile(GOOD_SOIL, CropType.Fallow)
    const result = applySeasonalSoilUpdate(tile, WeatherEvent.Normal, true)
    expect(result.organicMatter).toBeGreaterThan(GOOD_SOIL.organicMatter)
  })

  it('never produces values outside 0-100', () => {
    const tile   = makeTile(EXHAUSTED_SOIL, CropType.Tobacco)
    const result = applySeasonalSoilUpdate(tile, WeatherEvent.Drought, false)
    expect(result.organicMatter).toBeGreaterThanOrEqual(0)
    expect(result.nitrogen).toBeGreaterThanOrEqual(0)
    expect(result.soilFauna).toBeGreaterThanOrEqual(0)
    expect(result.moistureRetention).toBeGreaterThanOrEqual(0)
    expect(result.organicMatter).toBeLessThanOrEqual(100)
    expect(result.nitrogen).toBeLessThanOrEqual(100)
    expect(result.soilFauna).toBeLessThanOrEqual(100)
    expect(result.moistureRetention).toBeLessThanOrEqual(100)
  })

  it('suppresses soil fauna with stump rot active', () => {
    const tileNoRot   = makeTile(GOOD_SOIL, CropType.Fallow, false)
    const tileWithRot = makeTile(GOOD_SOIL, CropType.Fallow, true)
    const noRot   = applySeasonalSoilUpdate(tileNoRot,   WeatherEvent.Normal, false)
    const withRot = applySeasonalSoilUpdate(tileWithRot, WeatherEvent.Normal, false)
    expect(withRot.soilFauna).toBeLessThan(noRot.soilFauna)
  })
})
