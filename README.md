# Antebellum

A colonial Carolina plantation economy simulator.

**Play it:** https://lvnovak.github.io/Antebellum/

---

## What This Is

A turn-based browser strategy game set in 17th-century colonial Carolina. The player manages a small plantation under compounding pressures of soil health, labor welfare, debt, weather, and market timing. There is no scripted story — the systems tell it. Failure is a valid outcome.

The game depicts the institution of chattel slavery as a central mechanic because it was the central institution of the colonial Carolina economy. Enslaved people are represented as named individuals, not abstract units. The moral weight is carried by the mechanics, not by explanatory text.

---

## Project Structure

```
/src
  /engine          ← Pure game logic. No UI code here.
    types.ts       ← All data types for the entire game
    constants.ts   ← Every tunable number in one place
    soil.ts        ← Soil food web engine
    labor.ts       ← Worker health and conditions
    market.ts      ← Prices, sales, spoilage
    season.ts      ← Core turn resolver
    achievements.ts← Trophy tracking
  /store
    gameStore.ts   ← Zustand state — connects engine to UI
  /components      ← React UI components
    /map           ← Plantation tile map
    /roster        ← Labor roster
    /ledger        ← Financial dashboard
    /market        ← Storage and market panel
    /summary       ← Season summary and trophy ledger
    /shared        ← Layout, navigation, shared components
/tests
  /engine          ← Unit tests for engine functions
/docs
  antebellum_gdd_v0.4.docx  ← Full game design document
```

**The key rule:** nothing in `/engine` ever imports from `/components` or `/store`. The engine is pure logic. This keeps the codebase readable as it grows.

**If something looks wrong in the game:** start in `/engine/constants.ts`. Every tunable number lives there.

**If the UI looks wrong:** start in `/components`.

**If the game logic is wrong:** start in `/engine/season.ts` (the turn resolver) and work outward to the specific system.

---

## Running Locally

You need [Node.js](https://nodejs.org/) version 18 or higher.

```bash
# Install dependencies (one time)
npm install

# Run the development server
npm run dev
# Then open http://localhost:5173/Antebellum/ in your browser

# Run the test suite
npm test

# Build for production
npm run build
```

---

## Deploying

Deployment is automatic. Push to the `main` branch on GitHub and the game updates within a couple of minutes at https://lvnovak.github.io/Antebellum/

If the deploy fails, check the **Actions** tab on GitHub — it will show what went wrong.

---

## Game Design Document

The full GDD (v0.4) is in `/docs`. It covers all systems in detail including the labor model, soil food web, market mechanics, and design philosophy.

---

## Phase Status

- **Phase 1 (current):** Core loop — single tile, tobacco, hired enslaved labor, basic weather, factor sales, debt model, 2-cabin housing
- **Phase 2:** Full economy — all crops, all labor types, complete soil engine, full storage/market
- **Phase 3:** Achievement layer and UI polish
