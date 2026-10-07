/* 模擬器主程式：把網頁上的元件接到 WebAssembly 裡的韌體（Module.sim 介面，見 sim/hal_web/hal_web.cpp）。 */
(async () => {
const $ = id => document.getElementById(id);

// ---------- 畫面 ----------
const cv = $('screen'), ctx = cv.getContext('2d'); ctx.scale(3, 3);
const css565 = c => `rgb(${(c >> 11 & 31) * 255 / 31 | 0},${(c >> 5 & 63) * 255 / 63 | 0},${(c & 31) * 255 / 31 | 0})`;
const FONT = { 12: '12px', 16: '16px', 24: 'bold 24px' };
let backlight = 100;

// ---------- 模擬時間 ----------
let simTime = 0, paused = false, speed = 1;
$('speed').onchange = e => speed = +e.target.value;
$('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? '繼續' : '暫停'; $('pause').classList.toggle('on', paused); };
$('nextday').onclick = () => { simTime += 86400000; log('（模擬器）時間 +24 小時'); };
$('reboot').onclick = () => location.reload();

// ---------- 按鍵 ----------
const btn = [false, false]; let bothReleaseAt = -1;   // 同按輔助鈕的放開時刻（模擬時間），速度加快時手勢長短才不會變
const bindKey = (el, idx) => {
  const dn = e => { e.preventDefault(); btn[idx] = true; el.classList.add('down'); };
  const up = () => { btn[idx] = false; el.classList.remove('down'); };
  el.addEventListener('pointerdown', dn); el.addEventListener('pointerup', up); el.addEventListener('pointerleave', up);
};
bindKey($('bl'), 0); bindKey($('br'), 1);
const pressBoth = ms => { btn[0] = btn[1] = true; $('bl').classList.add('down'); $('br').classList.add('down'); bothReleaseAt = simTime + ms; };
const releaseBothIfDue = () => { if (bothReleaseAt >= 0 && simTime >= bothReleaseAt) { bothReleaseAt = -1; btn[0] = btn[1] = false; $('bl').classList.remove('down'); $('br').classList.remove('down'); } };
$('bs').onclick = () => pressBoth(150); $('bb').onclick = () => pressBoth(1000);
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'ArrowLeft') { btn[0] = true; $('bl').classList.add('down'); }
  if (e.key === 'ArrowRight') { btn[1] = true; $('br').classList.add('down'); }
  if (e.key === ' ') { e.preventDefault(); pressBoth(150); }
  if (e.key === 'Enter') pressBoth(1000);
});
document.addEventListener('keyup', e => {
  if (e.key === 'ArrowLeft') { btn[0] = false; $('bl').classList.remove('down'); }
  if (e.key === 'ArrowRight') { btn[1] = false; $('br').classList.remove('down'); }
});

// ---------- 感測器模型 ----------
let pitch = 0, roll = 0, walking = false, shakeUntil = -1, lastAcc = [0, 0, 1];
const pad = $('pad'), dot = pad.querySelector('i');
const setTilt = (p, r) => { pitch = Math.max(-45, Math.min(45, p)); roll = Math.max(-45, Math.min(45, r));
  dot.style.transform = `translate(calc(-50% + ${roll / 45 * 90}px),calc(-50% + ${-pitch / 45 * 90}px))`;
  $('vpitch').textContent = pitch.toFixed(1) + '°'; $('vroll').textContent = roll.toFixed(1) + '°'; };
let dragging = false;
const padXY = e => { const b = pad.getBoundingClientRect(); return [(e.clientX - b.left) / b.width * 2 - 1, (e.clientY - b.top) / b.height * 2 - 1]; };
pad.addEventListener('pointerdown', e => { dragging = true; const [x, y] = padXY(e); setTilt(-y * 45, x * 45); });
pad.addEventListener('pointermove', e => { if (!dragging) return; const [x, y] = padXY(e); setTilt(-y * 45, x * 45); });
pad.addEventListener('pointerup', () => dragging = false); pad.addEventListener('pointerleave', () => dragging = false);
$('flat').onclick = () => setTilt(0, 0);
$('walk').onclick = () => { walking = !walking; $('walk').textContent = walking ? '停止走路' : '開始走路'; $('walk').classList.toggle('on', walking); };
$('shake').onclick = () => shakeUntil = simTime + 150;
$('cad').oninput = e => $('vcad').textContent = e.target.value; $('amp').oninput = e => $('vamp').textContent = (+e.target.value).toFixed(2);
$('bat').oninput = e => $('vbat').textContent = (+e.target.value).toFixed(2);

const accelRead = () => {
  const p = pitch * Math.PI / 180, r = roll * Math.PI / 180;
  const g = [-Math.sin(p), Math.cos(p) * Math.sin(r), Math.cos(p) * Math.cos(r)];
  let f = 1 + (Math.random() - 0.5) * 0.03;
  if (walking) f += +$('amp').value * Math.sin(2 * Math.PI * (+$('cad').value / 60) * simTime / 1000);
  if (simTime < shakeUntil) f += 0.7 * Math.sin(Math.PI * (shakeUntil - simTime) / 150);
  lastAcc = g.map(v => v * f); return lastAcc;
};

// ---------- 蜂鳴器 ----------
let actx = null, osc = null, toneTimer = null, toneLevel = 2; const TONE_GAIN = [0, 0.02, 0.08, 0.25];
const tone = (hz, ms) => {
  const ok = !window.WIRING || WIRING.state.buzzerOk;
  if (!ok) return;
  if (osc) { try { osc.stop(); } catch {} osc = null; }
  clearTimeout(toneTimer); $('buzz').classList.toggle('on', hz > 0);
  if (!hz) return;
  if (!$('mute').checked && toneLevel > 0) {
    actx = actx || new AudioContext();
    osc = actx.createOscillator(); osc.type = 'square'; osc.frequency.value = hz;
    const gain = actx.createGain(); gain.gain.value = TONE_GAIN[toneLevel]; osc.connect(gain).connect(actx.destination); osc.start();
  }
  toneTimer = setTimeout(() => tone(0, 0), ms / speed);
};

// ---------- 儲存（localStorage 模擬 NVS）----------
const KV = 'pedolab:';
const kvAll = () => Object.keys(localStorage).filter(k => k.startsWith(KV)).sort().map(k => [k.slice(KV.length), localStorage[k]]);
const decode = hex => {
  const b = hex.match(/../g).map(h => parseInt(h, 16)); const u8 = new Uint8Array(b);
  if (b.length === 2) return `u16 = ${new DataView(u8.buffer).getUint16(0, true)}`;
  if (b.length === 4) return `u32/i32 = ${new DataView(u8.buffer).getUint32(0, true)}`;
  if (b.at(-1) === 0 && b.slice(0, -1).every(c => c >= 32 && c < 127)) return `字串 "${String.fromCharCode(...b.slice(0, -1))}"`;
  if (b.length === 70) { const dv = new DataView(u8.buffer); const out = []; for (let i = 0; i < 7; i++) { const d = dv.getInt32(i * 10, true); out.push(d < 0 ? '—' : `日${d}:${dv.getUint32(i * 10 + 4, true)}步/${dv.getUint16(i * 10 + 8, true)}顆`); } return '七日 ' + out.join(' '); }
  return `${b.length} bytes`;
};
const renderNvs = () => $('nvsbody').innerHTML = kvAll().map(([k, v]) => `<tr><td class="k">${k}</td><td>${v.length / 2}</td><td class="k">${v.length > 40 ? v.slice(0, 40) + '…' : v}</td><td>${decode(v)}</td></tr>`).join('') || '<tr><td colspan="4">（空）</td></tr>';
$('clearnvs').onclick = () => { if (confirm('清除模擬器的全部儲存資料？')) { kvAll().forEach(([k]) => localStorage.removeItem(KV + k)); renderNvs(); } };

// ---------- 序列埠 ----------
const serial = $('serial');
const log = s => { serial.textContent += `[${(simTime / 1000).toFixed(3).padStart(9)}] ${s}\n`; if (serial.textContent.length > 60000) serial.textContent = serial.textContent.slice(-40000); serial.scrollTop = serial.scrollHeight; };
// 韌體接上電腦會印 TIME? 要時間；模擬器扮演那台電腦，用瀏覽器的時間回 time <epoch> <tz_min>（真機由 tools/sync_time.py --watch 或燒錄頁回）
const origLog = log;
const logHook = s => { if (s.startsWith('TIME?') && $('usb').checked) setTimeout(() => { const ep = Math.floor(Date.now() / 1000), tz = -new Date().getTimezoneOffset();
  api('POST', '/api/time', `epoch=${ep}&tz_min=${tz}`); origLog(`[電腦] 收到 TIME?，回覆 time ${ep} ${tz}`); }, 300); };
$('clearlog').onclick = () => serial.textContent = '';

// ---------- 載入 WebAssembly ----------
const Module = await createSim({
  sim: {
    now: () => simTime,
    beginFrame() {}, endFrame() {},
    fill(c) { ctx.fillStyle = css565(c); ctx.fillRect(0, 0, 240, 135); },
    fillRect(x, y, w, h, c) { ctx.fillStyle = css565(c); ctx.fillRect(x, y, w, h); },
    drawRect(x, y, w, h, c) { ctx.strokeStyle = css565(c); ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1); },
    text(x, y, s, f, c, a) { ctx.fillStyle = css565(c); ctx.font = `${FONT[f] || '16px'} "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif`; ctx.textBaseline = 'top'; ctx.textAlign = ['left', 'center', 'right'][a]; ctx.fillText(s, x, y + (f === 24 ? 1 : 2)); },
    backlight(p) { backlight = p; cv.style.filter = `brightness(${0.15 + p / 100 * 0.85})`; },
    button: id => btn[id],
    accelBegin: () => !window.WIRING || WIRING.state.accelOk,
    accelRead,
    tone, toneVolume(l) { toneLevel = l; },
    kvGet: k => localStorage.getItem(KV + k),
    kvSet(k, hex) { localStorage.setItem(KV + k, hex); renderNvs(); },
    kvRemove(k) { localStorage.removeItem(KV + k); renderNvs(); },
    battery: () => $('nobat').checked ? 0 : $('usb').checked ? 4.9 : +$('bat').value,   // 接上 USB：量到的是 USB 的 4.9 V
    netBegin(ap, pass, sta) { log(`（模擬器）熱點 ${ap} 密碼 ${pass}${sta ? '，另嘗試連 ' + sta : ''}`); },
    staConnected: () => false,
    log: s => { log(s); logHook(s); },
    powerOff() { paused = true; const o = document.createElement('div'); o.id = 'poweroff';
      o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.82);color:#ddd;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;font-size:1.1rem;z-index:99;cursor:pointer';
      o.innerHTML = '<div style="font-size:1.6rem">已關機（深度睡眠）</div><div>真機此時約 0.1～2 mA；時鐘由 RTC 繼續走</div><div style="color:#8fb8c2">點一下＝按右鍵開機（重新載入）</div>';
      o.onclick = () => { localStorage.setItem('pedolab-woke', '1'); location.reload(); }; document.body.appendChild(o); log('（模擬器）已關機，等待右鍵喚醒'); },
    wokeFromSleep: () => localStorage.getItem('pedolab-woke') === '1',
    rtcSet(e) { localStorage.setItem('pedolab-rtc', JSON.stringify({ e, real: Date.now() })); },
    rtcGet() { try { const r = JSON.parse(localStorage.getItem('pedolab-rtc') || 'null'); if (!r) return 0; return r.e + (Date.now() - r.real) / 1000; } catch { return 0; } },
  }
});
const http = Module.cwrap('sim_http', 'number', ['string', 'string', 'string']);
const httpCode = Module.cwrap('sim_http_code', 'number', []), httpType = Module.cwrap('sim_http_type', 'number', []);
const api = (method, path, body = '') => { const p = http(method, path, body); return { code: httpCode(), type: Module.UTF8ToString(httpType()), body: Module.UTF8ToString(p) }; };
window.simFetch = (url, opts = {}) => { const u = new URL(url, 'http://sim/'); const r = api((opts.method || 'GET').toUpperCase(), u.pathname, opts.body ? String(opts.body) : '');
  return Promise.resolve(new Response(r.body, { status: r.code, headers: { 'Content-Type': r.type } })); };
$('ver').textContent = '韌體 v' + Module.UTF8ToString(Module._sim_version()) + '（WebAssembly）';
renderNvs();
Module._sim_setup();
localStorage.removeItem('pedolab-woke');   // 開機讀過喚醒原因後才清掉

// ---------- 儀表板 iframe：切到分頁時才載入（跟真機一樣，有人開網頁才會同步時間），fetch 導回模擬器 ----------
let dashLoaded = false;
const loadDash = () => { if (dashLoaded) return; dashLoaded = true;
  $('dashframe').srcdoc = api('GET', '/').body.replace('</head>', '<script>window.fetch=(u,o)=>parent.simFetch(u,o);</script></head>'); };

// ---------- 波形 ----------
const wave = $('wave'), wctx = wave.getContext('2d'); const sig = []; let thresh = 0.12;
const drawWave = () => {
  const W = wave.width = wave.clientWidth, H = wave.height = 120;
  wctx.fillStyle = '#14161a'; wctx.fillRect(0, 0, W, H);
  const y = v => H / 2 - v * (H / 1.2);
  wctx.strokeStyle = '#555'; wctx.beginPath(); wctx.moveTo(0, y(0)); wctx.lineTo(W, y(0)); wctx.stroke();
  wctx.strokeStyle = '#c7640b'; wctx.setLineDash([4, 4]); wctx.beginPath(); wctx.moveTo(0, y(thresh)); wctx.lineTo(W, y(thresh)); wctx.stroke(); wctx.setLineDash([]);
  wctx.strokeStyle = '#4fd1e0'; wctx.beginPath(); sig.forEach((v, i) => i ? wctx.lineTo(i / 300 * W, y(v)) : wctx.moveTo(0, y(v))); wctx.stroke();
  wctx.fillStyle = '#aaa'; wctx.font = '11px sans-serif'; wctx.fillText(`去除重力後的加速度（g）　虛線＝門檻 ${thresh}`, 6, 12);
};

// ---------- 主迴圈 ----------
let lastReal = performance.now(), lastStatus = 0;
const frame = () => {
  const now = performance.now();
  const dt = Math.min(now - lastReal, 100); lastReal = now;
  if (!paused) {
    let n = Math.min(2000, Math.round(dt * speed / 5));   // 每次最多 2000 圈（10 秒模擬），600× 才跑得滿
    while (n-- > 0) { simTime += 5; releaseBothIfDue(); Module._sim_loop(); }
  }
  if (now - lastStatus > 100) {
    lastStatus = now;
    try { const s = JSON.parse(api('GET', '/api/status').body);
      sig.push(s.step_signal); if (sig.length > 300) sig.shift();
      $('vsteps').textContent = s.steps; $('vacc').textContent = lastAcc.map(v => v.toFixed(2)).join(', ');
      if (Math.random() < 0.05) thresh = JSON.parse(api('GET', '/api/settings').body).k_thresh;
    } catch {}
    drawWave();
    $('simclock').textContent = simTime >= 3600000 ? `${(simTime / 3600000).toFixed(2)} 小時` : `${(simTime / 1000).toFixed(1)} s`;
  }
};
setInterval(() => { frame(); requestAnimationFrame(() => {}); }, 16);   // 計時器驅動模擬（背景分頁、無頭瀏覽器照樣走）；rAF 只是讓瀏覽器持續出畫面

// ---------- 分頁 ----------
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button,.panel>section').forEach(e => e.classList.remove('on'));
  b.classList.add('on'); $(b.dataset.t).classList.add('on');
  if (b.dataset.t === 'dash') loadDash();
  if (b.dataset.t === 'wiring' && window.WIRING) WIRING.render();
});

// ---------- 重編譯後自動重載 ----------
let buildStamp = null;
setInterval(async () => { try { const t = await (await fetch('build.txt')).text(); if (buildStamp && t !== buildStamp) location.reload(); buildStamp = t; } catch {} }, 1500);
})();
