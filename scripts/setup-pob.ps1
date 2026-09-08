$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PobPath = Join-Path $Root 'pob'
$LuaDir = Join-Path $Root '.tools\luajit'
$LuaExe = Join-Path $LuaDir 'luajit.exe'

Write-Host '== PoB2 Comparitator setup ==' -ForegroundColor Cyan

# --- Git / PoB2 -------------------------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git is required. Install Git for Windows once, then run this script again.'
}

if (Test-Path (Join-Path $PobPath '.git')) {
    Write-Host 'Updating PoB2 checkout...' -ForegroundColor Yellow
    git -C $PobPath fetch --depth 1 origin dev
    git -C $PobPath checkout -q dev
    git -C $PobPath reset --hard -q origin/dev
} elseif (Test-Path $PobPath) {
    throw "The path '$PobPath' exists but is not a Git checkout. Remove it and run setup again."
} else {
    Write-Host 'Downloading PoB2...' -ForegroundColor Yellow
    git clone --branch dev --depth 1 https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2.git $PobPath
}

$Headless = Join-Path $PobPath 'src\HeadlessWrapper.lua'
if (-not (Test-Path $Headless)) {
    throw 'PoB2 checkout is incomplete: src\HeadlessWrapper.lua is missing.'
}

# --- LuaJIT -----------------------------------------------------------------
# Keep LuaJIT local to this project. We do not modify PATH.
if (-not (Test-Path $LuaExe)) {
    Write-Host 'LuaJIT not found locally. Installing it through WinGet...' -ForegroundColor Yellow

    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw 'WinGet is required to bootstrap LuaJIT automatically. Install/update App Installer, then run setup again.'
    }

    winget install --id DEVCOM.LuaJIT --exact --silent --accept-package-agreements --accept-source-agreements

    # WinGet installs globally. Copy the executable + DLL + Lua support files into
    # our project-local tools directory so the app is self-contained afterwards.
    $Candidates = @(
        (Join-Path $env:ProgramFiles 'LuaJIT\luajit.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'LuaJIT\luajit.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\LuaJIT\luajit.exe')
    ) | Where-Object { $_ -and (Test-Path $_) }

    if ($Candidates.Count -eq 0) {
        $Found = Get-ChildItem -Path $env:LOCALAPPDATA,$env:ProgramFiles -Filter luajit.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($Found) { $Candidates = @($Found.FullName) }
    }

    if ($Candidates.Count -eq 0) {
        throw 'LuaJIT was installed, but luajit.exe could not be located. Set LUAJIT to the full executable path and run npm start.'
    }

    New-Item -ItemType Directory -Force -Path $LuaDir | Out-Null
    $InstalledLua = $Candidates[0]
    Copy-Item $InstalledLua $LuaExe -Force

    $LuaRoot = Split-Path -Parent $InstalledLua
    foreach ($File in @('lua51.dll')) {
        $Source = Join-Path $LuaRoot $File
        if (Test-Path $Source) { Copy-Item $Source $LuaDir -Force }
    }

    # Copy the LuaJIT standard Lua/JIT modules if the package ships them.
    foreach ($DirName in @('lua', 'jit')) {
        $SourceDir = Join-Path $LuaRoot $DirName
        if (Test-Path $SourceDir) { Copy-Item $SourceDir $LuaDir -Recurse -Force }
    }
}

if (-not (Test-Path $LuaExe)) {
    throw "LuaJIT executable missing: $LuaExe"
}

Write-Host ''
Write-Host 'Setup complete.' -ForegroundColor Green
Write-Host "PoB2:   $PobPath"
Write-Host "LuaJIT: $LuaExe"
Write-Host ''
Write-Host 'Next: npm install, then npm start.' -ForegroundColor Cyan
