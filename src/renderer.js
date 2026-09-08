const status = document.getElementById('status');
const output = document.getElementById('output');
const file = document.getElementById('file');
const calculate = document.getElementById('calculate');

const statLabels = {
  life: 'Life',
  mana: 'Mana',
  energyShield: 'Energy Shield',
  armour: 'Armour',
  evasion: 'Evasion',
  totalDPS: 'Total DPS',
  averageDamage: 'Average Damage',
};

function formatStat(value) {
  if (value === undefined || value === null) return '—';
  if (typeof value !== 'number') return String(value);
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function renderStats(stats) {
  if (!stats) return;
  for (const key of Object.keys(statLabels)) {
    const element = document.querySelector(`[data-stat="${key}"]`);
    if (element) element.textContent = formatStat(stats[key]);
  }
}

function showResult(result) {
  if (!result?.ok) {
    status.textContent = `Error: ${result?.error || 'Unknown error'}`;
    status.className = 'status error';
    return;
  }
  status.textContent = 'PoB2 connected';
  status.className = 'status ok';
  if (result.stats) renderStats(result.stats);
}

function buildLoaded(result, label) {
  showResult(result);
  if (result.ok) {
    file.textContent = label;
    calculate.disabled = false;
    if (result.stats) renderStats(result.stats);
  }
}

document.getElementById('close').onclick = () => window.pob.hideOverlay();

document.getElementById('paste').onclick = async () => {
  const result = await window.pob.loadClipboardBuild();
  buildLoaded(result, 'Build loaded from clipboard');
};

document.getElementById('load').onclick = async () => {
  const result = await window.pob.selectBuild();
  if (result.canceled) return;
  buildLoaded(result, result.file || 'Build loaded');
};

calculate.onclick = async () => {
  calculate.disabled = true;
  calculate.textContent = 'Calculating…';
  try {
    showResult(await window.pob.calculate());
  } finally {
    calculate.disabled = false;
    calculate.textContent = 'Recalculate';
  }
};

window.pob.onBridgeStatus(showResult);
window.pob.status().then(showResult);
