const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const pobReady = fs.existsSync(path.join(root, 'pob', 'src', 'HeadlessWrapper.lua'));
const luaReady = fs.existsSync(path.join(root, '.tools', 'luajit', 'luajit.exe'));

if (!pobReady || !luaReady) {
  console.log('PoB2 engine is not installed yet. Running setup automatically...');
  const setup = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', path.join(root, 'scripts', 'setup-pob.ps1'),
  ], { stdio: 'inherit', cwd: root, windowsHide: false });
  if (setup.error) throw setup.error;
  if (setup.status !== 0) process.exit(setup.status || 1);
}

const electron = require('electron');
const child = spawnSync(electron, ['.'], { stdio: 'inherit', cwd: root, windowsHide: false });
if (child.error) throw child.error;
process.exit(child.status ?? 1);
