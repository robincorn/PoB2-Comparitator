const status = document.getElementById('status');
const file = document.getElementById('file');
const calculate = document.getElementById('calculate');
const compare = document.getElementById('compare');

const statLabels = { life:'Life', mana:'Mana', energyShield:'Energy Shield', armour:'Armour', evasion:'Evasion', totalDPS:'Total DPS', averageDamage:'Average Damage' };

function formatStat(value) {
  if (value === undefined || value === null) return '—';
  if (typeof value !== 'number') return String(value);
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDelta(value) {
  if (value === undefined || value === null) return '—';
  if (value === 0) return '±0';
  const text = formatStat(Math.abs(value));
  return value > 0 ? `+${text}` : `-${text}`;
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
    compare.disabled = false;
    if (result.stats) renderStats(result.stats);
  }
}

function renderComparison(result) {
  const section = document.getElementById('comparison-results');
  document.getElementById('item-name').textContent = result.itemName || 'Clipboard Item';
  document.getElementById('item-slot').textContent = result.slot ? `Replaced: ${result.slot}` : '';
  section.hidden = false;
  for (const key of Object.keys(statLabels)) {
    document.getElementById(`delta-${key}-base`).textContent = formatStat(result.base?.[key]);
    document.getElementById(`delta-${key}-changed`).textContent = formatStat(result.changed?.[key]);
    const deltaElement = document.getElementById(`delta-${key}`);
    const value = result.delta?.[key] ?? 0;
    deltaElement.textContent = formatDelta(value);
    deltaElement.className = value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
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

compare.onclick = async () => {
  compare.disabled = true;
  compare.textContent = 'Comparing…';
  try {
    const result = await window.pob.compareClipboardItem();
    if (result?.ok) {
      status.textContent = 'Comparison calculated by PoB2';
      status.className = 'status ok';
      renderComparison(result.result);
    } else {
      showResult(result);
    }
  } finally {
    compare.disabled = false;
    compare.textContent = 'Compare Clipboard';
  }
};

calculate.onclick = async () => {
  calculate.disabled = true;
  calculate.textContent = 'Calculating…';
  try { showResult(await window.pob.calculate()); }
  finally { calculate.disabled = false; calculate.textContent = 'Recalculate'; }
};

window.pob.onBridgeStatus(showResult);
window.pob.status().then(showResult);
