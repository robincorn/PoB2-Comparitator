const overlay = document.getElementById('overlay');
const status = document.getElementById('status');
const file = document.getElementById('file');
const calculate = document.getElementById('calculate');
const pinnedKey = 'pob2-comparitator:pinned-tiles';
const pinned = new Set(JSON.parse(localStorage.getItem(pinnedKey) || '[]'));
let comparisonTimer;

function formatStat(value) {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  if (typeof value !== 'number') return String(value);
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDelta(value) {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  if (value === 0) return '±0';
  const text = formatStat(Math.abs(value));
  return value > 0 ? `+${text}` : `-${text}`;
}

function formatPercent(delta, base) {
  if (!Number.isFinite(delta) || !Number.isFinite(base) || base === 0) return '';
  const pct = (delta / Math.abs(base)) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function renderStats(stats) {
  if (!stats) return;
  document.getElementById('ehp').textContent = formatStat(stats.effectiveHitPool);
  document.getElementById('maxhit').textContent = formatStat(stats.effectiveMaxHit);
}

function renderSkills(skills) {
  const container = document.getElementById('skills');
  if (!skills?.length) {
    container.innerHTML = '<div class="empty-state">No damaging skills found.</div>';
    return;
  }
  const sorted = [...skills].sort((a, b) => (b.combinedDPS || b.hitDPS || 0) - (a.combinedDPS || a.hitDPS || 0));
  container.innerHTML = sorted.slice(0, 6).map((skill) => `
    <div class="skill-row">
      <div class="skill-name" title="${escapeHtml(skill.name)}">${escapeHtml(skill.name)}</div>
      <div><span>DPS</span><strong>${formatStat(skill.combinedDPS || skill.hitDPS)}</strong></div>
      <div><span>AVG</span><strong>${formatStat(skill.averageDamage)}</strong></div>
    </div>
  `).join('');
}

function renderComparison(result) {
  if (!result) return;
  const section = document.getElementById('comparison');
  section.hidden = false;
  document.getElementById('item-name').textContent = result.itemName || 'Clipboard Item';
  document.getElementById('item-slot').textContent = result.slot ? result.slot : '';

  const base = result.base?.stats || {};
  const changed = result.changed?.stats || {};
  const rows = [
    ['ehp', 'Effective Hit Pool', base.effectiveHitPool, changed.effectiveHitPool, result.delta?.effectiveHitPool],
    ['maxhit', 'Effective Max Hit', base.effectiveMaxHit, changed.effectiveMaxHit, result.delta?.effectiveMaxHit],
  ];
  for (const [key, _label, oldValue, newValue, delta] of rows) {
    document.getElementById(`${key}-base`).textContent = formatStat(oldValue);
    document.getElementById(`${key}-changed`).textContent = formatStat(newValue);
    const el = document.getElementById(`${key}-delta`);
    el.textContent = `${formatDelta(delta)} ${formatPercent(delta, oldValue)}`.trim();
    el.className = delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral';
  }

  const skillContainer = document.getElementById('skill-comparisons');
  const skillDeltas = [...(result.delta?.skills || [])]
    .sort((a, b) => Math.abs(b.dpsDelta || 0) - Math.abs(a.dpsDelta || 0))
    .slice(0, 4);
  skillContainer.innerHTML = skillDeltas.map((skill) => `
    <div class="skill-compare-row">
      <div class="skill-compare-name" title="${escapeHtml(skill.name)}">${escapeHtml(skill.name)}</div>
      <div><span>DPS</span><strong>${formatStat(skill.baseDPS)} → ${formatStat(skill.changedDPS)}</strong></div>
      <em class="${skill.dpsDelta > 0 ? 'positive' : skill.dpsDelta < 0 ? 'negative' : 'neutral'}">${formatDelta(skill.dpsDelta)} ${formatPercent(skill.dpsDelta, skill.baseDPS)}</em>
    </div>
  `).join('');

  const defense = [result.delta?.effectiveHitPool, result.delta?.effectiveMaxHit].filter(Number.isFinite);
  const dps = skillDeltas.map((skill) => skill.dpsDelta).filter(Number.isFinite);
  const hasDefenseLoss = defense.some((value) => value < 0);
  const hasDefenseGain = defense.some((value) => value > 0);
  const hasDpsLoss = dps.some((value) => value < 0);
  const hasDpsGain = dps.some((value) => value > 0);
  const verdict = document.getElementById('verdict');
  let label = 'MIXED';
  if ((hasDefenseGain || !defense.length) && (hasDpsGain || !dps.length) && !hasDefenseLoss && !hasDpsLoss) label = 'BETTER';
  else if (hasDefenseLoss && hasDpsLoss && !hasDpsGain) label = 'WORSE';
  verdict.textContent = label;
  verdict.className = `verdict ${label.toLowerCase()}`;

  clearTimeout(comparisonTimer);
  if (!pinned.has('comparison')) {
    comparisonTimer = setTimeout(() => { if (!pinned.has('comparison')) section.hidden = true; }, 9000);
  }
}

function showError(error) {
  status.textContent = `Error: ${error || 'Unknown error'}`;
  status.className = 'status error';
}

function showResult(result) {
  if (!result?.ok) { showError(result?.error); return; }
  status.textContent = 'PoB2 ready · clipboard watcher active';
  status.className = 'status ok';
  renderStats(result.stats);
  renderSkills(result.skills);
}

function buildLoaded(result, label) {
  showResult(result);
  if (result.ok) file.textContent = label;
}

function setPinned(tileId, value) {
  if (value) pinned.add(tileId); else pinned.delete(tileId);
  localStorage.setItem(pinnedKey, JSON.stringify([...pinned]));
  const tile = document.querySelector(`[data-tile="${tileId}"]`);
  const button = tile?.querySelector('.pin');
  if (tile) tile.classList.toggle('pinned', value);
  if (button) { button.textContent = value ? '●' : '○'; button.title = value ? 'Unpin tile' : 'Pin tile'; }
}

function applyPins() {
  document.querySelectorAll('.pinnable').forEach((tile) => setPinned(tile.dataset.tile, pinned.has(tile.dataset.tile)));
}

function setOverlayOpen(open) {
  document.body.classList.toggle('overlay-open', open);
}

function setupInteraction() {
  document.querySelectorAll('.ui-interactive').forEach((element) => {
    element.addEventListener('mouseenter', () => window.pob.setIgnoreMouseEvents(false));
    element.addEventListener('mouseleave', () => window.pob.setIgnoreMouseEvents(true));
  });
}

for (const button of document.querySelectorAll('.pin')) {
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const id = button.dataset.pin;
    setPinned(id, !pinned.has(id));
  });
}

document.getElementById('close').addEventListener('click', () => window.pob.hideOverlay());
document.getElementById('paste').addEventListener('click', async () => buildLoaded(await window.pob.loadClipboardBuild(), 'Clipboard build'));
document.getElementById('load').addEventListener('click', async () => {
  const result = await window.pob.selectBuild();
  if (!result.canceled) buildLoaded(result, result.file || 'XML build');
});
calculate.addEventListener('click', async () => {
  calculate.disabled = true;
  calculate.textContent = 'Calculating…';
  try { showResult(await window.pob.calculate()); } finally { calculate.disabled = false; calculate.textContent = 'Recalculate'; }
});

window.pob.onAutoComparison(renderComparison);
window.pob.onAutoComparisonError((result) => showError(result?.error));
window.pob.onOverlayOpened(() => setOverlayOpen(true));
window.pob.onOverlayClosed(() => setOverlayOpen(false));
window.pob.onBridgeStatus(showResult);
applyPins();
setupInteraction();
window.pob.status().then(showResult);
