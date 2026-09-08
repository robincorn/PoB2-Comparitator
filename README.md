# PoB2 Comparitator

Minimal end-to-end proof of concept for a Windows PoE2 overlay talking to the real Path of Building PoE2 calculation engine.

## Architecture

`PoE2 → Electron overlay → JSONL → OverlayWrapper.lua → PoB2 HeadlessWrapper.lua → real PoB2 calculations`

PoB2 itself is **not modified**. The project keeps the PoB2 checkout local and disposable so we can update it independently.

## Windows setup

The goal is deliberately simple: install the normal development tools once, then let the project bootstrap its own PoB2 + LuaJIT runtime.

Requirements:
- Windows 10/11
- Git for Windows
- Node.js + npm
- WinGet/App Installer (normally already present on modern Windows)

From the repository root:

```powershell
npm install
npm run setup
npm run smoke
npm start
```

Or double-click `scripts\setup-pob.cmd` for the PoB2/LuaJIT setup step.

`setup` does the rest:

1. Downloads PoB2 `dev` into `pob/` if it is missing.
2. Updates an existing `pob/` checkout to the current upstream `dev`.
3. Records the exact PoB2 commit in `.tools\pob2-commit.txt`.
4. Installs LuaJIT through WinGet only if the project-local runtime is missing.
5. Copies the LuaJIT executable/runtime into `.tools\luajit` so the overlay does not depend on your global PATH.
6. Configures PoB2's `runtime/*.dll` automatically when the bridge starts.

The local `pob/` and `.tools/` directories are ignored by Git and are safe to recreate.

## Smoke test

Before opening Electron, run:

```powershell
npm run smoke
```

This starts the real LuaJIT + PoB2 headless bridge and sends a JSONL `getStatus` request. A successful result looks like:

```text
SMOKE TEST PASSED: PoB2 <version> (<branch>)
```

This isolates PoB2/bridge problems from Electron problems.

## Updating

Run:

```powershell
npm run setup
npm run smoke
```

`setup` refreshes the PoB2 checkout without touching our overlay code. The exact revision is recorded locally so a known-good PoB2 version can later be pinned for releases.

## Overlay test flow

1. Start the overlay.
2. Confirm the PoB2 connection status.
3. Click `Load PoB2 Build` and select an exported `.xml` build.
4. Click `Calculate Stats`.
5. Confirm that the displayed values come from PoB2's calculation output.

The bridge has a timeout so a broken PoB2 process cannot leave the UI waiting forever. Startup/runtime errors are reported back to the overlay.

## Current scope

This is intentionally only the plumbing proof-of-concept. It does not implement item comparison yet.

Once the load/calculate round trip works on Windows, the next step is `compareItem`: apply a temporary item mutation, run the real PoB2 calculation, read the delta, then restore the original build.
