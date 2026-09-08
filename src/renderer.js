const overlay = document.getElementById('overlay');
const status = document.getElementById('status');
const file = document.getElementById('file');
const calculate = document.getElementById('calculate');
const compare = document.getElementById('compare');
const poeAccount = document.getElementById('poe-account');
const poeConnect = document.getElementById('poe-connect');
const poeCharacter = document.getElementById('poe-character');
const poeSync = document.getElementById('poe-sync');
const poeSyncStatus = document.getElementById('poe-sync-status');
const pinnedKey = 'pob2-comparitator:pinned-tiles';
const pinned = new Set(JSON.parse(localStorage.getItem(pinnedKey) || '[]'));
const characterOptions = new Map();

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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
    container.innerHTML = '<div class="empty-state">No calculated active skills found.</div>';
    return;
  }
  const sorted = [...skills].sort((a, b) => (b.combinedDPS || b.hitDPS || b.dotDPS || 0) - (a.combinedDPS || a.hitDPS || a.dotDPS || 0));
  container.innerHTML = sorted.slice(0, 6).map((skill) => `
    <div class="skill-row">
      <div class="skill-name" title="${escapeHtml(skill.name)}">${escapeHtml(skill.name)}</div>
      <div><span>DPS</span><strong>${formatStat(skill.combinedDPS || skill.hitDPS || skill.dotDPS)}</strong></div>
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
    ['ehp', base.effectiveHitPool, changed.effectiveHitPool, result.delta?.effectiveHitPool],
    ['maxhit', base.effectiveMaxHit, changed.effectiveMaxHit, result.delta?.effectiveMaxHit],
  ];
  for (const [key, oldValue, newValue, delta] of rows) {
    document.getElementById(`${key}-base`).textContent = formatStat(oldValue);
    document.getElementById(`${key}-changed`).textContent = formatStat(newValue);
    const el = document.getElementById(`${key}-delta`);
    el.textContent = `${formatDelta(delta)} ${formatPercent(delta, oldValue)}`.trim();
    el.className = delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral';
  }

  const skillContainer = document.getElementById('skill-comparisons');
  const skillDeltas = [...(result.delta?.skills || [])]
    .sort((a, b) => Math.abs(b.dpsDelta || b.dotDelta || 0) - Math.abs(a.dpsDelta || a.dotDelta || 0))
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
}

function showError(error) {
  status.textContent = `Error: ${error || 'Unknown error'}`;
  status.className = 'status error';
}

function showResult(result) {
  if (!result?.ok) { showError(result?.error); return; }
  status.textContent = 'PoB2 ready · copy item, then Ctrl + Shift + C';
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

function setPoeSyncStatus(state, error) {
  const labels = {
    authorizing: 'Waiting for Path of Exile authorization…',
    syncing: 'Syncing character…',
    synced: 'Synced just now',
    offline: 'Offline · using last successful sync',
    empty: 'Use Character Sync to load your build automatically.',
  };
  poeSyncStatus.textContent = error ? `Sync failed · ${error}` : (labels[state] || state || labels.empty);
  poeSyncStatus.className = `sync-status ${state || ''}`;
}

function renderCharacters(characters, selected) {
  characterOptions.clear();
  poeCharacter.innerHTML = '<option value="">Choose character…</option>';
  for (const character of characters || []) {
    if (!character?.name) continue;
    characterOptions.set(character.name, character);
    const option = document.createElement('option');
    option.value = character.name;
    option.textContent = `${character.name} · ${character.level || 0} · ${character.league || '?'}`;
    poeCharacter.appendChild(option);
  }
  poeCharacter.disabled = !(characters?.length);
  poeSync.disabled = !selected?.name;
  if (selected?.name && characterOptions.has(selected.name)) poeCharacter.value = selected.name;
}

function renderPoeStatus(info) {
  if (!info) return;
  poeAccount.textContent = info.connected ? (info.username || 'Connected') : 'Not connected';
  poeConnect.textContent = info.connected ? 'Disconnect Account' : 'Connect Account';
  if (info.stats) {
    renderStats(info.stats);
    renderSkills(info.skills || []);
  }
  if (info.character) {
    file.textContent = `${info.character.name} · ${info.character.league || 'Unknown league'}`;
  }
  poeSync.disabled = !info.character?.name;
}

async function refreshPoeCharacters() {
  const result = await window.pob.poeListCharacters();
  if (result?.ok) renderCharacters(result.characters, result.selected);
  else if (result?.error) setPoeSyncStatus('error', result.error);
  return result;
}

async function handlePoeConnect() {
  poeConnect.disabled = true;
  poeConnect.textContent = 'Authorizing…';
  try {
    const connected = await window.pob.poeStatus();
    if (connected?.connected) {
      const result = await window.pob.poeDisconnect();
      if (result?.ok) {
        renderPoeStatus({ connected: false });
        renderCharacters([], null);
        setPoeSyncStatus('empty');
      }
      return;
    }
    const result = await window.pob.poeConnect();
    if (!result?.ok) showError(result?.error);
    else renderCharacters(result.characters, result.selected);
  } finally {
    poeConnect.disabled = false;
    poeConnect.textContent = (await window.pob.poeStatus())?.connected ? 'Disconnect Account' : 'Connect Account';
  }
}

async function syncSelectedCharacter() {
  poeSync.disabled = true;
  setPoeSyncStatus('syncing');
  try {
    const result = await window.pob.poeSync();
    if (!result?.ok) showError(result?.error);
    else {
      buildLoaded(result, result.character ? `${result.character.name} · ${result.character.league || 'Unknown league'}` : 'PoE character');
      setPoeSyncStatus(result.cached ? 'offline' : 'synced');
    }
  } finally {
    poeSync.disabled = !poeCharacter.value;
  }
}

async function compareClipboard() {
  compare.disabled = true;
  compare.textContent = 'Comparing…';
  try {
    const result = await window.pob.compareClipboardItem();
    if (!result?.ok) showError(result?.error);
  } finally {
    compare.disabled = false;
    compare.textContent = 'Compare Clipboard Item';
  }
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
compare.addEventListener('click', compareClipboard);
poeConnect.addEventListener('click', handlePoeConnect);
poeSync.addEventListener('click', syncSelectedCharacter);
poeCharacter.addEventListener('change', async () => {
  const character = characterOptions.get(poeCharacter.value);
  if (!character) return;
  poeSync.disabled = true;
  setPoeSyncStatus('syncing');
  const result = await window.pob.poeSelectCharacter(character);
  if (result?.ok) {
    buildLoaded(result, `${character.name} · ${character.league || 'Unknown league'}`);
    setPoeSyncStatus('synced');
  } else {
    showError(result?.error);
    setPoeSyncStatus('error', result?.error);
  }
  poeSync.disabled = false;
});

window.pob.onItemComparisonStart(() => {
  document.getElementById('comparison').hidden = false;
  document.getElementById('verdict').textContent = 'CALCULATING';
  document.getElementById('verdict').className = 'verdict neutral';
  document.getElementById('item-name').textContent = 'Comparing clipboard item…';
});
window.pob.onItemComparison(renderComparison);
window.pob.onItemComparisonError((result) => showError(result?.error));
window.pob.onOverlayOpened(() => setOverlayOpen(true));
window.pob.onOverlayClosed(() => setOverlayOpen(false));
window.pob.onBridgeStatus(showResult);
window.pob.onPoeStatus((info) => {
  renderPoeStatus(info);
  if (info.characters) renderCharacters(info.characters, info.character);
});
window.pob.onPoeSyncStatus((info) => setPoeSyncStatus(info.state, info.error));
window.pob.onPoeCharacter((info) => {
  if (info?.character) {
    file.textContent = `${info.character.name} · ${info.character.league || 'Unknown league'}`;
    poeSync.disabled = false;
  }
});

applyPins();
setupInteraction();
window.pob.status().then(showResult);
window.pob.poeStatus().then(async (info) => {
  renderPoeStatus(info);
  if (info?.connected) await refreshPoeCharacters();
  if (info?.character) setPoeSyncStatus('synced');
});
