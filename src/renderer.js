const status = document.getElementById('status');
const output = document.getElementById('output');
const file = document.getElementById('file');
const calculate = document.getElementById('calculate');

function showResult(result) {
  if (!result?.ok) {
    status.textContent = `Error: ${result?.error || 'Unknown error'}`;
    status.className = 'status error';
    return;
  }
  status.textContent = 'PoB2 connected';
  status.className = 'status ok';
  if (result.stats) output.textContent = JSON.stringify(result.stats, null, 2);
}

document.getElementById('close').onclick = () => window.close();
document.getElementById('load').onclick = async () => {
  const result = await window.pob.selectBuild();
  if (result.canceled) return;
  showResult(result);
  if (result.ok) {
    file.textContent = result.file || 'Build loaded';
    calculate.disabled = false;
    output.textContent = 'Build loaded. Press Calculate Stats.';
  }
};

calculate.onclick = async () => showResult(await window.pob.calculate());

window.pob.onBridgeStatus(showResult);
window.pob.status().then(showResult);
