/* 接線關卡：T-Display + ADXL345 + 蜂鳴器 + 電池/開關。
   做法沿用 circuit-lab：連線 → 併成網路（union-find）→ 逐條規則檢查。檢查結果會影響模擬器。 */
window.WIRING = (() => {
const PARTS = {
  mcu: { label: 'T-Display', sub: 'ESP32 · 3.3 V 邏輯', x: 300, y: 40, w: 160, h: 330, cls: '#dfe7f2', internal: [['GND', 'GND2'], ['GND', 'BATN']], pins: [
    { id: '3V3', n: '3V3', s: 'l', p: .08, k: 'v33' }, { id: 'GND', n: 'GND', s: 'l', p: .20, k: 'gnd' },
    { id: 'G21', n: 'GPIO21', s: 'l', p: .32, k: 'sig' }, { id: 'G22', n: 'GPIO22', s: 'l', p: .44, k: 'sig' },
    { id: 'G25', n: 'GPIO25', s: 'l', p: .56, k: 'sig' }, { id: 'G26', n: 'GPIO26', s: 'l', p: .68, k: 'sig' },
    { id: 'G32', n: 'GPIO32', s: 'l', p: .80, k: 'sig' }, { id: 'G33', n: 'GPIO33', s: 'l', p: .92, k: 'sig' },
    { id: '5V', n: '5V', s: 'r', p: .08, k: 'v5' }, { id: 'GND2', n: 'GND', s: 'r', p: .20, k: 'gnd' },
    { id: 'EN', n: 'EN（重置）', s: 'r', p: .34, k: 'en' },
    { id: 'BATP', n: '電池座＋', s: 'r', p: .80, k: 'batin' }, { id: 'BATN', n: '電池座−', s: 'r', p: .92, k: 'gnd' } ] },
  adxl: { label: 'ADXL345', sub: 'GY-291 · I2C', x: 40, y: 40, w: 150, h: 230, cls: '#e9f2df', pins: [
    { id: 'GND', n: 'GND', s: 'r', p: .10, k: 'gnd' }, { id: 'VCC', n: 'VCC', s: 'r', p: .22, k: 'vin' },
    { id: 'CS', n: 'CS', s: 'r', p: .34, k: 'cs' }, { id: 'INT1', n: 'INT1', s: 'r', p: .46, k: 'int' },
    { id: 'INT2', n: 'INT2', s: 'r', p: .58, k: 'int' }, { id: 'SDO', n: 'SDO', s: 'r', p: .70, k: 'sdo' },
    { id: 'SDA', n: 'SDA', s: 'r', p: .82, k: 'sda' }, { id: 'SCL', n: 'SCL', s: 'r', p: .94, k: 'scl' } ] },
  buz: { label: '蜂鳴器', sub: '無源 · 方波驅動', x: 40, y: 310, w: 150, h: 80, cls: '#f6e7d8', pins: [
    { id: 'P', n: '＋', s: 'r', p: .30, k: 'bzp' }, { id: 'N', n: '−', s: 'r', p: .72, k: 'bzn' } ] },
  bat: { label: '鋰電池', sub: '1000 mAh · 3.7 V', x: 580, y: 300, w: 150, h: 80, cls: '#f2dfe3', pins: [
    { id: 'P', n: '＋', s: 'l', p: .30, k: 'src' }, { id: 'N', n: '−', s: 'l', p: .72, k: 'gnd' } ] },
  sw: { label: '電源開關', sub: '串在正極線', x: 580, y: 160, w: 150, h: 70, cls: '#eee9d8', internal: [['A', 'B']], pins: [
    { id: 'A', n: '1', s: 'l', p: .5, k: 'pass' }, { id: 'B', n: 'B', s: 'b', p: .5, k: 'pass' } ] },
};
PARTS.sw.pins[1].n = '2';
const state = { accelOk: true, buzzerOk: true, checked: false };
let wires = JSON.parse(localStorage.getItem('pedolab-wires') || '[]');   // [["mcu.3V3","adxl.VCC"],...]
let pending = null;
const svg = document.getElementById('svg');

const pinPos = (pid) => { const [p, id] = pid.split('.'); const P = PARTS[p], pin = P.pins.find(x => x.id === id);
  const x = pin.s === 'l' ? P.x : pin.s === 'r' ? P.x + P.w : P.x + P.w * pin.p;
  const y = pin.s === 't' ? P.y : pin.s === 'b' ? P.y + P.h : P.y + P.h * pin.p; return [x, y]; };
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function render() {
  let h = '';
  for (const [k, P] of Object.entries(PARTS)) {
    h += `<g><rect x="${P.x}" y="${P.y}" width="${P.w}" height="${P.h}" rx="8" fill="${P.cls}" stroke="#1a1a18" stroke-width="2"/>
      <text x="${P.x + P.w / 2}" y="${P.y + 22}" text-anchor="middle" font-size="15" font-weight="700">${esc(P.label)}</text>
      <text x="${P.x + P.w / 2}" y="${P.y + 40}" text-anchor="middle" font-size="11" fill="#6a665c">${esc(P.sub)}</text>`;
    for (const pin of P.pins) { const [x, y] = pinPos(k + '.' + pin.id); const id = k + '.' + pin.id;
      const tx = pin.s === 'l' ? x + 10 : pin.s === 'r' ? x - 10 : x, anchor = pin.s === 'l' ? 'start' : pin.s === 'r' ? 'end' : 'middle', ty = pin.s === 'b' ? y - 8 : pin.s === 't' ? y + 14 : y + 4;
      h += `<text x="${tx}" y="${ty}" text-anchor="${anchor}" font-size="11">${esc(pin.n)}</text>
        <circle class="pin" data-id="${id}" cx="${x}" cy="${y}" r="7" fill="${pending === id ? '#c7640b' : '#fff'}" stroke="#1a1a18" stroke-width="2" style="cursor:pointer"/>`; }
    h += '</g>';
  }
  wires.forEach(([a, b], i) => { const [x1, y1] = pinPos(a), [x2, y2] = pinPos(b);
    const col = /GND|\.N$|BATN/.test(a + b) ? '#222' : /3V3|5V|VCC|BATP|bat\.P/.test(a + b) ? '#c0392b' : /SDA/.test(a + b) ? '#2b8a3e' : /SCL/.test(a + b) ? '#0a7f8c' : '#c7640b';
    const mx = (x1 + x2) / 2;
    h += `<path class="wire" data-i="${i}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="${col}" stroke-width="3" style="cursor:pointer"/>`; });
  svg.innerHTML = h;
  svg.querySelectorAll('.pin').forEach(c => c.onclick = () => { const id = c.dataset.id;
    if (!pending) pending = id; else { if (pending !== id && !wires.some(([a, b]) => (a === pending && b === id) || (a === id && b === pending))) wires.push([pending, id]); pending = null; }
    save(); render(); });
  svg.querySelectorAll('.wire').forEach(w => w.onclick = () => { wires.splice(+w.dataset.i, 1); save(); render(); });
}
const save = () => localStorage.setItem('pedolab-wires', JSON.stringify(wires));

// ---------- 網路表 ----------
function nets() {
  const parent = {}; const find = x => parent[x] === undefined ? (parent[x] = x) : parent[x] === x ? x : (parent[x] = find(parent[x]));
  const union = (a, b) => { parent[find(a)] = find(b); };
  for (const [k, P] of Object.entries(PARTS)) { P.pins.forEach(p => find(k + '.' + p.id)); (P.internal || []).forEach(([a, b]) => union(k + '.' + a, k + '.' + b)); }
  wires.forEach(([a, b]) => union(a, b));
  const same = (a, b) => find(a) === find(b);
  const netOf = id => Object.keys(parent).filter(x => find(x) === find(id));
  return { same, netOf };
}

// ---------- 規則 ----------
function check() {
  const { same, netOf } = nets(); const out = [];
  const wiredTo = id => wires.filter(w => w.includes(id)).map(w => w[0] === id ? w[1] : w[0]);
  const swPins = ['sw.A', 'sw.B'];
  const enDirect = wiredTo('mcu.EN');                                   // EN 直接接到哪些腳
  const enToSw = enDirect.some(x => swPins.includes(x));
  const swOther = swPins.filter(x => !enDirect.includes(x));           // 開關另一端
  const enSwitch = enToSw && swOther.some(x => wiredTo(x).some(y => y !== 'mcu.EN' && PARTS.mcu.pins.some(pn => 'mcu.' + pn.id === y && pn.k === 'gnd') || y === 'bat.N' || y === 'adxl.GND' || y === 'buz.N')); const ok = (m) => out.push(['ok', m]), bad = (m) => out.push(['bad', m]), warn = (m) => out.push(['warn', m]);
  const isPower = id => ['mcu.3V3', 'mcu.5V', 'mcu.BATP', 'bat.P'].some(p => same(id, p)), isGnd = id => same(id, 'mcu.GND');
  // 1 短路
  if (same('mcu.3V3', 'mcu.GND') || same('mcu.5V', 'mcu.GND') || same('mcu.3V3', 'mcu.5V') || same('bat.P', 'bat.N')) bad('電源短路：3V3／5V／電池正極與 GND（或彼此）接在一起，一開機就會燒。');
  else ok('沒有電源短路。');
  // 2 GPIO 不能碰電源
  const sigs = PARTS.mcu.pins.filter(p => p.k === 'sig').map(p => 'mcu.' + p.id);
  const badSig = sigs.filter(s => isPower(s) || isGnd(s));
  if (badSig.length) bad(`GPIO 直接接到電源或 GND：${badSig.map(s => s.split('.')[1]).join('、')}。訊號腳不能這樣接。`);
  // 2b EN 腳
  if (enDirect.some(x => x !== 'sw.A' && x !== 'sw.B' && (x.endsWith('.GND') || x === 'mcu.GND2' || x === 'bat.N' || x === 'buz.N' || x === 'mcu.BATN')))
    bad('EN 直接接到 GND：ESP32 會一直被壓在重置狀態，永遠不會開機。要關機請經過開關。');
  else if (enDirect.some(x => ['mcu.3V3', 'mcu.5V', 'mcu.BATP', 'bat.P'].includes(x))) warn('EN 接到電源：板上本來就有上拉，接了沒有作用。');
  else if (enDirect.some(x => sigs.includes(x))) bad('EN 接到 GPIO：重置腳不能當訊號線用。');
  else if (enSwitch) warn('開關接在 EN 與 GND 之間（原作說明書方案）：關機時 ESP32 進重置、插 USB 仍能充電；但板上穩壓器、GY-291 的電源 LED 與仍在量測的 ADXL345 繼續耗電約 2～3 mA，1000 mAh 兩三週會放完。');
  // 3 共地
  const gnds = ['adxl.GND', 'buz.N', 'bat.N'];
  const notG = gnds.filter(g => !isGnd(g));
  if (!notG.length) ok('ADXL345、蜂鳴器、電池都與開發板共地。');
  else bad(`沒有共地：${notG.map(g => ({ 'adxl.GND': 'ADXL345 GND', 'buz.N': '蜂鳴器 −', 'bat.N': '電池 −' })[g]).join('、')} 沒接到 GND。`);
  // 4 ADXL 電源
  let accel = true;
  if (same('adxl.VCC', 'mcu.3V3')) ok('ADXL345 VCC 接 3V3。');
  else if (same('adxl.VCC', 'mcu.5V')) warn('ADXL345 VCC 接 5V：GY-291 模組板上有穩壓器所以能動，但 I2C 準位仍是 3.3 V；建議接 3V3。');
  else { bad('ADXL345 沒有電源（VCC 要接 3V3）。'); accel = false; }
  // 5 I2C
  const sdaOk = same('adxl.SDA', 'mcu.G21'), sclOk = same('adxl.SCL', 'mcu.G22');
  if (same('adxl.SDA', 'mcu.G22') && same('adxl.SCL', 'mcu.G21')) { bad('SDA／SCL 接反了：SDA 要接 GPIO21、SCL 要接 GPIO22。程式會找不到加速度計。'); accel = false; }
  else { if (sdaOk) ok('SDA → GPIO21。'); else { bad('SDA 沒接到 GPIO21。'); accel = false; }
         if (sclOk) ok('SCL → GPIO22。'); else { bad('SCL 沒接到 GPIO22。'); accel = false; } }
  if (same('adxl.SDA', 'adxl.SCL')) { bad('SDA 和 SCL 接在同一條線上。'); accel = false; }
  // 6 位址
  if (same('adxl.SDO', 'mcu.3V3')) { bad('SDO 接到 3V3 → I2C 位址變成 0x1D，程式用的是 0x53，會找不到。SDO 接 GND 或不接。'); accel = false; }
  else if (isGnd('adxl.SDO')) ok('SDO 接 GND → 位址 0x53。');
  else warn('SDO 沒接：GY-291 模組板上已把 SDO 拉低，位址仍是 0x53，可以不接。');
  if (isGnd('adxl.CS')) { bad('CS 接 GND 會切成 SPI 模式，I2C 就不通了。CS 不接（模組已拉高）或接 3V3。'); accel = false; }
  // 7 蜂鳴器
  let buzzer = true;
  if (same('buz.P', 'mcu.G25') && isGnd('buz.N')) ok('蜂鳴器 ＋ → GPIO25、− → GND。');
  else if (same('buz.N', 'mcu.G25') && isGnd('buz.P')) warn('蜂鳴器正負接反：無源蜂鳴器仍會響，但習慣上 ＋ 接 GPIO。');
  else if (isPower('buz.P') || isPower('buz.N')) { bad('蜂鳴器直接接到電源，會一直耗電且無法由程式控制。'); buzzer = false; }
  else { const other = sigs.find(s => same('buz.P', s) && s !== 'mcu.G25'); bad(other ? `蜂鳴器接到 ${other.split('.')[1]}，但程式用的是 GPIO25，不會響。` : '蜂鳴器沒接好（＋ → GPIO25、− → GND）。'); buzzer = false; }
  // 8 電池與開關
  const swA = same('bat.P', 'sw.A') || same('bat.P', 'sw.B'), swB = same('mcu.BATP', 'sw.A') || same('mcu.BATP', 'sw.B');
  const battDirect = wiredTo('bat.P').includes('mcu.BATP');
  if (enSwitch && battDirect) ok('電池 ＋ 直接接電池座＋，由 EN–GND 開關關機（說明書方案）。');
  else if (swA && swB && same('bat.P', 'mcu.BATP') && !enSwitch) ok('電池 ＋ → 開關 → 電池座＋（原作實物方案）：真正零耗電，但關機時插 USB 不會充到電池。');
  else if (same('bat.P', 'mcu.BATP') && !(swA && swB)) warn('電池正極直接接電池座，開關沒有接在任何地方：能動，但無法關機。');
  else if (!same('bat.P', 'mcu.BATP')) bad('電池正極沒有接到電池座＋。');
  if (same('bat.N', 'mcu.BATN') || isGnd('bat.N')) ok('電池 − → 電池座−。'); else bad('電池負極沒接到電池座−。');
  if (isPower('mcu.BATN') ) bad('電池座− 接到電源，會短路。');

  state.accelOk = accel; state.buzzerOk = buzzer; state.checked = true;
  const allOk = !out.some(([t]) => t === 'bad');
  document.getElementById('wres').innerHTML = (allOk ? '<b class="ok">全部通過。</b>' : '<b class="bad">還有錯誤。</b>') +
    `<br>${out.map(([t, m]) => `<span class="${t}">${t === 'ok' ? '✓' : t === 'bad' ? '✗' : '△'} ${m}</span>`).join('<br>')}` +
    `<p class="note">模擬器狀態：加速度計 ${accel ? '可用' : '找不到'}、蜂鳴器 ${buzzer ? '可用' : '不響'}。加速度計是開機時偵測，改完接線請按「重新開機」。</p>`;
}

document.getElementById('check').onclick = check;
document.getElementById('clearwires').onclick = () => { wires = []; pending = null; save(); render(); document.getElementById('wres').textContent = '已清除。'; };
document.getElementById('autowire2').onclick = () => { wires = [['mcu.3V3', 'adxl.VCC'], ['mcu.GND', 'adxl.GND'], ['mcu.G21', 'adxl.SDA'], ['mcu.G22', 'adxl.SCL'],
  ['mcu.G25', 'buz.P'], ['mcu.GND2', 'buz.N'], ['mcu.EN', 'sw.A'], ['sw.B', 'mcu.GND2'], ['bat.P', 'mcu.BATP'], ['bat.N', 'mcu.BATN']]; save(); render(); check(); };
document.getElementById('autowire').onclick = () => { wires = [['mcu.3V3', 'adxl.VCC'], ['mcu.GND', 'adxl.GND'], ['mcu.G21', 'adxl.SDA'], ['mcu.G22', 'adxl.SCL'],
  ['mcu.G25', 'buz.P'], ['mcu.GND2', 'buz.N'], ['bat.P', 'sw.A'], ['sw.B', 'mcu.BATP'], ['bat.N', 'mcu.BATN']]; save(); render(); check(); };
if (wires.length) { render(); check(); } else render();
return { state, render, check };
})();
