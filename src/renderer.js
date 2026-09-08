const overlay = document.getElementById('overlay');
const status = document.getElementById('status');
const file = document.getElementById('file');
const calculate = document.getElementById('calculate');
const compare = document.getElementById('compare');
const localPobPath = document.getElementById('local-pob-path');
const localPobSync = document.getElementById('local-pob-sync');
const localPobCancel = document.getElementById('local-pob-cancel');
const localPobStatus = document.getElementById('local-pob-status');
const pinnedKey = 'pob2-comparitator:pinned-tiles';
const pinned = new Set(JSON.parse(localStorage.getItem(pinnedKey) || '[]'));

function escapeHtml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#039;'); }
function formatStat(value) { if (value === undefined || value === null || Number.isNaN(value)) return '—'; if (typeof value !== 'number') return String(value); return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function formatDelta(value) { if (value === undefined || value === null || Number.isNaN(value)) return '—'; if (value === 0) return '±0'; const text = formatStat(Math.abs(value)); return value > 0 ? `+${text}` : `-${text}`; }
function formatPercent(delta, base) { if (!Number.isFinite(delta) || !Number.isFinite(base) || base === 0) return ''; const pct = (delta / Math.abs(base)) * 100; return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`; }
function renderStats(stats) { if (!stats) return; document.getElementById('ehp').textContent = formatStat(stats.effectiveHitPool); document.getElementById('maxhit').textContent = formatStat(stats.effectiveMaxHit); }
function renderSkills(skills) {
  const container = document.getElementById('skills');
  if (!skills?.length) { container.innerHTML = '<div class="empty-state">No calculated active skills found.</div>'; return; }
  const groups = new Map();
  for (const skill of skills) { const key = skill.group ?? 0; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(skill); }
  container.innerHTML = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([group, entries]) => {
    const rows = entries.map(skill => `<div class="skill-row ${skill.support ? 'support-row' : ''}"><div class="skill-name" title="${escapeHtml(skill.name)}">${escapeHtml(skill.name)}</div><div><span>${skill.support ? 'GEM' : 'DPS'}</span><strong>${skill.support ? 'Support' : formatStat(skill.combinedDPS || skill.hitDPS || skill.dotDPS)}</strong></div><div><span>${skill.support ? 'TYPE' : 'AVG'}</span><strong>${skill.support ? 'Support' : formatStat(skill.averageDamage)}</strong></div></div>`).join('');
    return `<div class="skill-group" data-group="${group}">${rows}</div>`;
  }).join('');
}
function renderComparison(result) {
  if (!result) return; const section = document.getElementById('comparison'); section.hidden = false; document.getElementById('item-name').textContent = result.itemName || 'Clipboard Item'; document.getElementById('item-slot').textContent = result.slot || '';
  const base = result.base?.stats || {}; const changed = result.changed?.stats || {};
  for (const [key, oldValue, newValue, delta] of [['ehp', base.effectiveHitPool, changed.effectiveHitPool, result.delta?.effectiveHitPool], ['maxhit', base.effectiveMaxHit, changed.effectiveMaxHit, result.delta?.effectiveMaxHit]]) { document.getElementById(`${key}-base`).textContent = formatStat(oldValue); document.getElementById(`${key}-changed`).textContent = formatStat(newValue); const el = document.getElementById(`${key}-delta`); el.textContent = `${formatDelta(delta)} ${formatPercent(delta, oldValue)}`.trim(); el.className = delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral'; }
  const skillContainer = document.getElementById('skill-comparisons'); const skillDeltas = [...(result.delta?.skills || [])].sort((a, b) => Math.abs(b.dpsDelta || b.dotDelta || 0) - Math.abs(a.dpsDelta || a.dotDelta || 0)).slice(0, 8); skillContainer.innerHTML = skillDeltas.map(skill => `<div class="skill-compare-row"><div class="skill-compare-name" title="${escapeHtml(skill.name)}">${escapeHtml(skill.name)}</div><div><span>DPS</span><strong>${formatStat(skill.baseDPS)} → ${formatStat(skill.changedDPS)}</strong></div><em class="${skill.dpsDelta > 0 ? 'positive' : skill.dpsDelta < 0 ? 'negative' : 'neutral'}">${formatDelta(skill.dpsDelta)} ${formatPercent(skill.dpsDelta, skill.baseDPS)}</em></div>`).join('');
  const defense = [result.delta?.effectiveHitPool, result.delta?.effectiveMaxHit].filter(Number.isFinite); const dps = skillDeltas.map(s => s.dpsDelta).filter(Number.isFinite); const hasDefenseLoss = defense.some(v => v < 0), hasDefenseGain = defense.some(v => v > 0), hasDpsLoss = dps.some(v => v < 0), hasDpsGain = dps.some(v => v > 0); const verdict = document.getElementById('verdict'); let label = 'MIXED'; if ((hasDefenseGain || !defense.length) && (hasDpsGain || !dps.length) && !hasDefenseLoss && !hasDpsLoss) label = 'BETTER'; else if (hasDefenseLoss && hasDpsLoss && !hasDpsGain) label = 'WORSE'; verdict.textContent = label; verdict.className = `verdict ${label.toLowerCase()}`;
}
function showError(error) { status.textContent = `Error: ${error || 'Unknown error'}`; status.className = 'status error'; }
function showResult(result) { if (!result?.ok) { showError(result?.error); return; } status.textContent = 'PoB2 ready · copy item, then Ctrl + Shift + C'; status.className = 'status ok'; renderStats(result.stats); renderSkills(result.skills); }
function buildLoaded(result, label) { showResult(result); if (result.ok) file.textContent = label; }
function setPinned(tileId, value) { if (value) pinned.add(tileId); else pinned.delete(tileId); localStorage.setItem(pinnedKey, JSON.stringify([...pinned])); const tile = document.querySelector(`[data-tile="${tileId}"]`); const button = tile?.querySelector('.pin'); if (tile) tile.classList.toggle('pinned', value); if (button) { button.textContent = value ? '●' : '○'; button.title = value ? 'Unpin tile' : 'Pin tile'; } }
function applyPins() { document.querySelectorAll('.pinnable').forEach(tile => setPinned(tile.dataset.tile, pinned.has(tile.dataset.tile))); }
function setOverlayOpen(open) { document.body.classList.toggle('overlay-open', open); }
function setupInteraction() { document.querySelectorAll('.ui-interactive').forEach(element => { element.addEventListener('mouseenter', () => window.pob.setIgnoreMouseEvents(false)); element.addEventListener('mouseleave', () => window.pob.setIgnoreMouseEvents(true)); }); }
function setLocalPobStatus(state, error) { const labels = { waiting: 'PoB2 launched · import your character there and save the build.', synced: 'Build imported from local PoB2.', cancelled: 'PoB2 sync cancelled.', timeout: 'Timed out waiting for a saved PoB2 build.' }; localPobStatus.textContent = error ? `Sync failed · ${error}` : (labels[state] || 'Open PoB2, import your character there, then save the build.'); localPobStatus.className = `sync-status ${state || ''}`; const waiting = state === 'waiting'; localPobSync.disabled = waiting; localPobCancel.hidden = !waiting; }
async function startLocalPob() { localPobSync.disabled = true; setLocalPobStatus('waiting'); const result = await window.pob.localPobSync(); if (!result?.ok) { setLocalPobStatus('error', result?.error); localPobSync.disabled = false; localPobCancel.hidden = true; } }
async function compareClipboard() { compare.disabled = true; compare.textContent = 'Comparing…'; try { const result = await window.pob.compareClipboardItem(); if (!result?.ok) showError(result?.error); } finally { compare.disabled = false; compare.textContent = 'Compare Clipboard Item'; } }
for (const button of document.querySelectorAll('.pin')) button.addEventListener('click', event => { event.stopPropagation(); const id = button.dataset.pin; setPinned(id, !pinned.has(id)); });
document.getElementById('close').addEventListener('click', () => window.pob.hideOverlay());
document.getElementById('paste').addEventListener('click', async () => buildLoaded(await window.pob.loadClipboardBuild(), 'Clipboard build'));
document.getElementById('load').addEventListener('click', async () => { const result = await window.pob.selectBuild(); if (!result.canceled) buildLoaded(result, result.file || 'XML build'); });
calculate.addEventListener('click', async () => { calculate.disabled = true; calculate.textContent = 'Calculating…'; try { showResult(await window.pob.calculate()); } finally { calculate.disabled = false; calculate.textContent = 'Recalculate'; } });
compare.addEventListener('click', compareClipboard); localPobSync.addEventListener('click', startLocalPob); localPobCancel.addEventListener('click', () => window.pob.localPobCancel());
window.pob.onItemComparisonStart(() => { document.getElementById('comparison').hidden = false; document.getElementById('verdict').textContent = 'CALCULATING'; document.getElementById('verdict').className = 'verdict neutral'; document.getElementById('item-name').textContent = 'Comparing clipboard item…'; });
window.pob.onItemComparison(renderComparison); window.pob.onItemComparisonError(result => showError(result?.error)); window.pob.onOverlayOpened(() => setOverlayOpen(true)); window.pob.onOverlayClosed(() => setOverlayOpen(false)); window.pob.onBridgeStatus(showResult);
window.pob.onLocalPobStatus(info => { setLocalPobStatus(info.state, info.error); }); window.pob.onLocalPobBuild(result => { buildLoaded(result, result.file || 'Local PoB2 build'); setLocalPobStatus('synced'); });
applyPins(); setupInteraction(); window.pob.status().then(showResult); window.pob.localPobInfo().then(info => { localPobPath.textContent = info.executable ? `Detected · ${info.executable}` : 'PoB2 not detected'; });
