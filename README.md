# PoB2 Comparitator

Minimal end-to-end proof of concept for a PoE2 overlay talking to the real Path of Building PoE2 calculator.

## Architecture

Electron overlay → JSONL stdin/stdout → `pob-bridge/OverlayWrapper.lua` → PoB2 `HeadlessWrapper.lua` → real PoB2 calculations.

The PoB2 source is kept outside this repository's application code so upstream updates can be pulled independently.

## Local setup

Requirements:
- Node.js
- npm
- LuaJIT available as `luajit` on PATH
- Git

From the repository root:

```bash
bash scripts/setup-pob.sh
npm install
npm start
```

If LuaJIT or PoB2 lives somewhere else:

```bash
LUAJIT=/path/to/luajit POB2_PATH=/path/to/PathOfBuilding-PoE2 npm start
```

The test flow is intentionally tiny:

1. Start the overlay.
2. Confirm `PoB2 connected`.
3. Click `Load PoB2 Build` and select an exported `.xml` build.
4. Click `Calculate Stats`.
5. The overlay displays values returned by PoB2's calculation output.

## Current scope

This is only the plumbing proof-of-concept. It intentionally does not implement item comparison yet. Once the load/calculate round trip is verified, the next step is `compareItem` using temporary build mutations and the existing PoB2 calculation/comparison machinery.
