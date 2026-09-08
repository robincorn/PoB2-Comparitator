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

## Automatic character workflow

The preferred workflow is now Character Sync:

```text
Path of Exile account
  ↓ OAuth 2.1 + PKCE
PoE character API
  ↓ character JSON
PoB2 import functions
  ↓
PoB2 calculation
  ↓
Overlay
```

On first use:

1. Click `Connect Account`.
2. Authorize the app on the Path of Exile website.
3. Select a character.
4. The character, equipment, skills, passive tree and jewels are imported through PoB2.
5. The successful character snapshot is stored locally.

After that, startup loads the last successful snapshot immediately and attempts a fresh API sync in the background. If the API is unavailable, the cached build remains usable.

OAuth tokens are stored using Electron `safeStorage` on Windows. Passwords and POESESSID values are never collected or stored.

### OAuth client

The application **does not use Path of Building's OAuth client id**. It requires our own registered Path of Exile **Public Client**.

Set the client id outside the source tree:

```powershell
$env:POE_CLIENT_ID = "our-registered-client-id"
$env:POE_CONTACT = "our-contact-address"
npm start
```

The registered redirect URI must be:

```text
http://127.0.0.1:47831/callback
```

GGG requires executable applications that use the API to use a public OAuth client. Public clients must use Authorization Code + PKCE and a local redirect URI. GGG also requires an identifiable OAuth User-Agent and says application credentials must not be embedded in distributed binaries.

Registration is handled by GGG. Their current documentation asks developers to request OAuth access by emailing `oauth@grindinggear.com` with the account name/discriminator, application name, client type, grant types, scopes and redirect URI.

The app deliberately requests only the scope required for character synchronization:

- `account:characters` — retrieve the selected PoE2 character and its build data

No profile, league, trade, stash, or service scopes are required by the current implementation.

The PoB client id is not accepted as a fallback. If `POE_CLIENT_ID` is missing, Character Sync fails with a configuration error instead of silently using PoB credentials.

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
- `Load XML Build` — manual fallback
- `Load PoB2 Clipboard` — manual share-code fallback
- `Recalculate` — force a PoB2 recalculation
- Character Sync — preferred build loading path

Item copying remains manual: copy an item in PoE, then press the comparison hotkey. The app does not synthesize game input or watch the clipboard continuously.

## Persistence

Stored under the Electron application data directory rather than the repository:

- encrypted OAuth token data
- selected character metadata
- last successful character snapshot
- last successful sync timestamp

The snapshot allows the overlay to remain useful while offline or while the API is temporarily unavailable.

## Smoke test

```powershell
npm run smoke
```

The smoke test starts the real LuaJIT + PoB2 headless bridge and verifies the JSONL calculation path. This keeps PoB/bridge failures separate from Electron UI failures.

## Third-party notice

This product isn't affiliated with or endorsed by Grinding Gear Games in any way.
