$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PobPath = Join-Path $Root 'pob'
$ToolsPath = Join-Path $Root '.tools'
$LuaDir = Join-Path $ToolsPath 'luajit'
$LuaExe = Join-Path $LuaDir 'luajit.exe'
$VersionFile = Join-Path $ToolsPath 'pob2-commit.txt'

Write-Host '== PoB2 Comparitator setup ==' -ForegroundColor Cyan

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git is required. Install Git for Windows once, then run this script again.'
}

# --- PoB2 -------------------------------------------------------------------
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
$DkJson = Join-Path $PobPath 'runtime\lua\dkjson.lua'
if (-not (Test-Path $Headless)) { throw 'PoB2 checkout is incomplete: src\HeadlessWrapper.lua is missing.' }
if (-not (Test-Path $DkJson)) { throw 'PoB2 checkout is incomplete: runtime\lua\dkjson.lua is missing.' }

$PobCommit = (git -C $PobPath rev-parse HEAD).Trim()
New-Item -ItemType Directory -Force -Path $ToolsPath | Out-Null
Set-Content -Path $VersionFile -Value $PobCommit -Encoding ascii

# --- LuaJIT -----------------------------------------------------------------
# Current PoB2 dev uses LuaJIT 2.1 syntax extensions such as +=. Older
# packaged LuaJIT builds (including the common DEVCOM/WinGet package) do not
# understand those operators, so validate the interpreter before using it.
function Test-LuaJitSyntax([string] $Exe) {
    if (-not (Test-Path $Exe)) { return $false }
    try {
        & $Exe -e 'local x=1; x+=1; assert(x==2)' 2>$null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

$LuaWorks = Test-LuaJitSyntax $LuaExe
if (-not $LuaWorks) {
    Write-Host 'Installed/local LuaJIT is too old for current PoB2 syntax.' -ForegroundColor Yellow
    Write-Host 'Installing current LuaJIT through MSYS2...' -ForegroundColor Yellow

    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw 'WinGet is required to bootstrap a current LuaJIT through MSYS2.'
    }

    winget install --id MSYS2.MSYS2 --exact --silent --accept-package-agreements --accept-source-agreements

    $MsysRoot = Join-Path $env:SystemDrive 'msys64'
    $Bash = Join-Path $MsysRoot 'usr\bin\bash.exe'
    if (-not (Test-Path $Bash)) {
        throw "MSYS2 was installed but bash.exe was not found at $Bash."
    }

    & $Bash -lc 'pacman -Sy --noconfirm && pacman -S --needed --noconfirm mingw-w64-ucrt-x86_64-luajit'
    if ($LASTEXITCODE -ne 0) { throw 'MSYS2 LuaJIT installation failed.' }

    $MsysLuaExe = Join-Path $MsysRoot 'ucrt64\bin\luajit.exe'
    if (-not (Test-Path $MsysLuaExe)) {
        throw "MSYS2 LuaJIT was installed but luajit.exe was not found at $MsysLuaExe."
    }
    if (-not (Test-LuaJitSyntax $MsysLuaExe)) {
        throw 'The installed MSYS2 LuaJIT does not support the LuaJIT 2.1 syntax extensions required by current PoB2.'
    }

    New-Item -ItemType Directory -Force -Path $LuaDir | Out-Null
    Copy-Item $MsysLuaExe $LuaExe -Force

    $MsysBin = Split-Path -Parent $MsysLuaExe
    foreach ($File in @('lua51.dll')) {
        $Source = Join-Path $MsysBin $File
        if (Test-Path $Source) { Copy-Item $Source $LuaDir -Force }
    }

    # The JIT helper modules are needed by PoB2 (e.g. jit.opt.start()).
    $JitCandidates = @(
        (Join-Path $MsysRoot 'ucrt64\share\lua\5.1\jit'),
        (Join-Path $MsysRoot 'ucrt64\share\lua\jit'),
        (Join-Path $MsysRoot 'mingw64\share\lua\5.1\jit')
    ) | Where-Object { Test-Path $_ }
    if ($JitCandidates.Count -gt 0) {
        Copy-Item $JitCandidates[0] (Join-Path $LuaDir 'jit') -Recurse -Force
    }
}

if (-not (Test-LuaJitSyntax $LuaExe)) {
    throw "LuaJIT executable at $LuaExe does not support the LuaJIT 2.1 syntax extensions required by current PoB2."
}

& $LuaExe -v 2>&1 | Select-Object -First 1 | ForEach-Object { Write-Host "LuaJIT: $_" }

Write-Host ''
Write-Host 'Setup complete.' -ForegroundColor Green
Write-Host "PoB2 commit: $PobCommit"
Write-Host "LuaJIT:      $LuaExe"
Write-Host ''
Write-Host 'Next: npm run smoke, then npm start.' -ForegroundColor Cyan
