const status = document.getElementById('status');
const file = document.getElementById('file');
const calculate = document.getElementById('calculate');
const compare = document.getElementById('compare');

const summaryStats = ['effectiveHitPool', 'effectiveMaxHit'];
const comparisonStats = ['effectiveHitPool', 'effectiveMaxHit', 'totalDPS', 'averageDamage'];

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
  for (const key of summaryStats) {
    const element = document.querySelector(`[data-stat="${key}"]`);
    if (element) element.textContent = formatStat(stats[key]);
  }
}

function renderSkills(skills) {
  const container = document.getElementById('skills');
  if (!skills?.length) {
    container.innerHTML = '<div class="empty-state">No damaging skills were found in the PoB2 calculation.</div>';
    return;
  }

  const sorted = [...skills].sort((a, b) => (b.combinedDPS || b.hitDPS || 0) - (a.combinedDPS || a.hitDPS || 0));
  const visible = sorted.slice(0, 8);
  container.innerHTML = visible.map((skill) => `
    <div class="skill-row">
      <div class="skill-name" title="${escapeHtml(skill.name)}">${escapeHtml(skill.name)}</div>
      <div class="skill-value"><span>DPS</span><strong>${formatStat(skill.combinedDPS || skill.hitDPS)}</strong></div>
      <div class="skill-value"><span>Avg Hit</span><strong>${formatStat(skill.averageDamage)}</strong></div>
      <div class="skill-value compact"><span>Speed</span><strong>${formatStat(skill.speed)}</strong></div>
    </div>
  `).join('');

  if (sorted.length > visible.length) {
    container.insertAdjacentHTML('beforeend', `<div class="skill-more">+ ${sorted.length - visible.length} more calculated skills</div>`);
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}

function showResult(result) {
  if (!result?.ok) {
    status.textContent = `Error: ${result?.error || 'Unknown error'}`;
    status.className = 'status error';
    return;
  }
  status.textContent = 'PoB2 connected';
  status.className = 'status ok';
  renderStats(result.stats);
  renderSkills(result.skills);
}

function buildLoaded(result, label) {
  showResult(result);
  if (result.ok) {
    file.textContent = label;
    calculate.disabled = false;
    compare.disabled = false;
  }
}

function renderComparison(result) {
  const section = document.getElementById('comparison-results');
  document.getElementById('item-name').textContent = result.itemName || 'Clipboard Item';
  document.getElementById('item-slot').textContent = result.slot ? `Replaced: ${result.slot}` : '';
  section.hidden = false;
  for (const key of comparisonStats) {
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
