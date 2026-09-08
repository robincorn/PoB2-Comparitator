#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -d "$ROOT/pob/.git" ]; then
  echo "PoB2 already exists at $ROOT/pob"
  exit 0
fi

git clone --branch dev --depth 1 https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2.git "$ROOT/pob"
echo "PoB2 installed at $ROOT/pob"
