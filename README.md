# PoB2 Comparitator

Windows PoE2 overlay using the real Path of Building PoE2 calculation engine for build stats and item comparison.

## Architecture

```text
PoE2
  ↓ manual Ctrl+C for an item
Electron overlay
  ↓ JSONL
OverlayWrapper.lua
  ↓
PoB2 HeadlessWrapper.lua
  ↓
real PoB2 calculations
```

PoB2 remains the calculation authority. The overlay does not reimplement PoB calculations.

## Character workflow via local PoB2

The current preferred workflow deliberately does **not** require our own Path of Exile OAuth application. Instead, the user's installed PoB2 handles character authentication and import:

```text
Path of Exile
  ↓ existing PoB2 character import / login
Installed PoB2
  ↓ Save build
local PoB2 XML
  ↓ file watcher
PoB2 Comparitator
  ↓
our bundled PoB2 headless engine
  ↓
Overlay
```

Use `Sync via PoB2` in the overlay:

1. Comparitator launches the installed PoB2 application.
2. Import the character normally inside PoB2.
3. Save the build with `Ctrl+S`.
4. Comparitator detects the newly created or modified XML build and loads it automatically.

PoB2's documented user-data directory for the PoE2 build is `Documents/Path of Building (PoE2)/`, with builds stored below its `Builds` directory. The app also checks common legacy/installed locations. The local executable can be overridden with `POB_INSTALLED_PATH` if automatic detection does not find it.

This integration intentionally does not read or reuse PoB2's OAuth tokens. PoB2 remains responsible for authentication.

## OAuth status

Our own OAuth implementation is currently parked because GGG is not registering new applications at this point in time. The source files remain available as a future backend, but the UI and normal workflow do not depend on them.

## Standalone PoB2 engine

The project bootstraps its own local PoB2 + LuaJIT runtime. The calculator is not installed as a dependency on a user's existing PoB installation.

`npm start` automatically runs the PoB2 setup if the local engine is missing.

The setup script pins PoB2 to a known-good commit so an upstream change cannot silently alter calculation behavior. To deliberately test another PoB2 revision, set `POB2_COMMIT` before setup.

The local `pob/` and `.tools/` directories are ignored by Git and can be recreated at any time.

## Windows setup

Requirements:

- Windows 10/11
- Git for Windows
- Node.js + npm
- WinGet/App Installer

```powershell
npm install
npm start
```

For an explicit setup/test cycle:

```powershell
npm run setup
npm run smoke
npm start
```

## Current overlay workflow

- `Ctrl + Shift + Space` — show/hide overlay
- `Ctrl + Shift + C` — compare the item currently in the clipboard
- `Sync via PoB2` — launch local PoB2 and wait for a saved build
- `Load XML Build` — manual fallback
- `Load PoB2 Clipboard` — manual share-code fallback
- `Recalculate` — force a PoB2 recalculation

Item copying remains manual: copy an item in PoE, then press the comparison hotkey. The app does not synthesize game input or watch the clipboard continuously.

## Skills overview

The overview consumes the skill data exposed by PoB2 and now displays all returned active skills instead of truncating the list to the first six entries. This keeps the overview aligned with PoB2's Skills tab rather than silently hiding lower-DPS skills.

## Smoke test

```powershell
npm run smoke
```

The smoke test starts the real LuaJIT + PoB2 headless bridge and verifies the JSONL calculation path. This keeps PoB/bridge failures separate from Electron UI failures.

## Third-party notice

This product isn't affiliated with or endorsed by Grinding Gear Games in any way.
