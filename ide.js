/* 瀏覽器 IDE：編輯（CodeMirror）→ 本機伺服器編譯（tools/ide_server.py）→ Web Serial 燒錄（esptool-js，Apache-2.0）→ 序列埠監看。
   沒有伺服器（GitHub Pages）時只剩「燒錄預編譯的正式韌體」。 */
import { ESPLoader, Transport } from './vendor/esptool-js.bundle.js';

const $ = id => document.getElementById(id);
const log = (el, s) => { el.textContent += s + '\n'; el.scrollTop = el.scrollHeight; };
const L = s => log($('log'), s), M = s => log($('mon'), s);
const api = async (path, body) => { const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}); if (!r.ok) throw new Error(`${path} → ${r.status}`); return r.json(); };

const cm = CodeMirror.fromTextArea($('code'), { mode: 'text/x-c++src', theme: 'material-darker', lineNumbers: true, matchBrackets: true, indentUnit: 2, tabSize: 2, viewportMargin: 50 });
let files = [], cur = null, server = false, images = null, port = null, reader = null, monitoring = false;

// ---------------- 檔案
const curFile = () => files.find(f => f.id === $('file').value);
async function loadFile() {
  cur = curFile(); if (!cur) return;
  const r = await api('/api/ide/file?path=' + encodeURIComponent(cur.path));
  cm.setValue(r.content); cm.clearHistory(); $('savemsg').textContent = cur.path;
  $('sim').disabled = !cur.sim; $('simcard').style.display = cur.sim ? '' : 'none';
}
async function save() {
  if (!cur) return false;
  const r = await api('/api/ide/file', { path: cur.path, content: cm.getValue() });
  $('savemsg').textContent = `已存檔 ${cur.path}（${r.bytes} bytes）`; return true;
}
$('save').onclick = () => save().catch(e => L('存檔失敗：' + e.message));
$('reset').onclick = () => loadFile();
$('file').onchange = loadFile;

// ---------------- 模擬與編譯
$('sim').onclick = async () => {
  $('sim').disabled = true; $('simmsg').textContent = '存檔、重編模擬器中…'; $('simmsg').className = '';
  try { await save(); const r = await api('/api/ide/sim', {}); L(r.log); $('simmsg').textContent = r.ok ? '模擬器已更新（右邊會自己重載）' : '編譯失敗，看下方紀錄'; $('simmsg').className = r.ok ? 'ok' : 'bad'; }
  catch (e) { $('simmsg').textContent = e.message; $('simmsg').className = 'bad'; }
  $('sim').disabled = false;
};
$('build').onclick = async () => {
  $('build').disabled = true; $('buildmsg').textContent = '存檔、arduino-cli 編譯中…（第一次較久）'; $('buildmsg').className = '';
  try {
    await save();
    const r = await api('/api/ide/build', { kind: cur.kind, name: cur.name });
    L(r.log);
    if (r.ok) { images = r.images; $('buildmsg').textContent = `完成：${images.map(i => `${i.name} @0x${i.offset.toString(16)}（${(i.size / 1024).toFixed(0)} KB）`).join('、')}`; $('buildmsg').className = 'ok'; $('flash').disabled = !port; }
    else { $('buildmsg').textContent = '編譯失敗，看下方紀錄'; $('buildmsg').className = 'bad'; }
  } catch (e) { $('buildmsg').textContent = e.message; $('buildmsg').className = 'bad'; }
  $('build').disabled = false;
};

// ---------------- 接裝置：Web Serial；沒看到裝置就給這個作業系統的驅動指引
const OS = /Mac/i.test(navigator.platform) ? 'mac' : /Win/i.test(navigator.platform) ? 'win' : /Linux|X11/i.test(navigator.platform) ? 'linux' : 'other';
const DRIVER = {
  mac: `<b>macOS：</b>T-Display 的 USB 晶片是 <b>CH9102</b>。macOS 12 以上多半免裝驅動；若「連接」清單裡沒有 <code>usbserial</code> 裝置：<br>
   ① 到 WCH 官方下載頁裝 <a href="https://www.wch-ic.com/downloads/CH34XSER_MAC_ZIP.html" target="_blank">CH34XSER_MAC</a>（CH9102 用這個）→ ② 系統設定 → 隱私權與安全性 → 允許 WCH 的系統延伸 → ③ 重新插拔 USB 線，再按「連接」。<br>
   也請確認用的是「資料線」不是純充電線（純充電線插上只會充電，電腦完全看不到裝置）。`,
  win: `<b>Windows：</b>T-Display 的 USB 晶片是 <b>CH9102</b>。① 到 WCH 官方下載頁裝 <a href="https://www.wch-ic.com/downloads/CH343SER_EXE.html" target="_blank">CH343SER</a>（含 CH9102）→
   ② 裝完在「裝置管理員 → 連接埠」會出現 <code>USB-Enhanced-SERIAL CH9102 (COMx)</code> → ③ 重新插拔 USB 線，再按「連接」。<br>也請確認用的是資料線，不是純充電線。`,
  linux: `<b>Linux：</b>核心內建 <code>ch341</code> 驅動，裝置是 <code>/dev/ttyACM0</code> 或 <code>/dev/ttyUSB0</code>。沒有權限時：<code>sudo usermod -aG dialout $USER</code>，登出再登入；若 <code>brltty</code> 搶走裝置，把它移除。`,
  other: `請用 Chrome 或 Edge；T-Display 的 USB 晶片是 CH9102，驅動在 WCH 官網（CH343SER／CH34XSER_MAC）。`,
};
function showDriver(reason) {
  const d = $('drv'); d.style.display = 'block';
  d.innerHTML = `<b>${reason}</b><br>` + DRIVER[OS] + `<br><small>瀏覽器支援：Chrome／Edge 89+ 有 Web Serial；Safari、Firefox 沒有。</small>`;
}
$('connect').onclick = async () => {
  $('drv').style.display = 'none';
  if (!('serial' in navigator)) { $('portmsg').textContent = '這個瀏覽器沒有 Web Serial'; $('portmsg').className = 'bad'; showDriver('這個瀏覽器不支援 Web Serial，請改用 Chrome 或 Edge。'); return; }
  try {
    port = await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x1a86 }, { usbVendorId: 0x10c4 }, { usbVendorId: 0x303a }] });   // WCH CH9102／CP210x／Espressif 原生
    const info = port.getInfo();
    $('portmsg').textContent = `已選擇裝置 VID ${info.usbVendorId?.toString(16) || '?'} PID ${info.usbProductId?.toString(16) || '?'}`; $('portmsg').className = 'ok';
    $('flash').disabled = !images; $('flashpre').disabled = !preManifest; $('monitor').disabled = false;
  } catch (e) {
    $('portmsg').textContent = '沒有選到裝置'; $('portmsg').className = 'warn';
    showDriver('清單裡沒有 T-Display？多半是驅動還沒裝，或用到純充電線。');
  }
};

// ---------------- 燒錄（esptool-js）
const toBinStr = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; };
async function flashImages(imgs) {
  if (!port) { $('flashmsg').textContent = '先按「連接」'; return; }
  await stopMonitor();
  $('flash').disabled = $('flashpre').disabled = true; $('flashmsg').className = ''; $('bar').firstElementChild.style.width = '0';
  const files = [];
  for (const im of imgs) { const b = new Uint8Array(await (await fetch(im.url)).arrayBuffer()); files.push({ data: toBinStr(b), address: im.offset }); L(`讀取 ${im.name}：${b.length} bytes → 0x${im.offset.toString(16)}`); }
  const transport = new Transport(port, true);
  try {
    const term = { clean() {}, writeLine: s => L(s), write: s => { if (s.trim()) L(s.trim()); } };
    const loader = new ESPLoader({ transport, baudrate: 230400, romBaudrate: 115200, terminal: term });
    $('flashmsg').textContent = '連線中（進入燒錄模式）…';
    await loader.main();
    $('flashmsg').textContent = '燒錄中…';
    await loader.writeFlash({ fileArray: files, flashSize: 'keep', flashMode: 'keep', flashFreq: 'keep', eraseAll: false, compress: true,
      reportProgress: (i, written, total) => { $('bar').firstElementChild.style.width = Math.round((i + written / total) / files.length * 100) + '%'; } });
    $('bar').firstElementChild.style.width = '100%';
    try { await loader.hardReset(); } catch { try { await transport.setDTR(false); await transport.setRTS(true); await new Promise(r => setTimeout(r, 100)); await transport.setRTS(false); } catch {} }
    $('flashmsg').textContent = '燒錄完成，板子已重開機'; $('flashmsg').className = 'ok'; L('燒錄完成');
  } catch (e) {
    $('flashmsg').textContent = '燒錄失敗：' + e.message; $('flashmsg').className = 'bad'; L('燒錄失敗：' + e.message);
    L('常見原因：線是純充電線／驅動沒裝／另一個程式占住序列埠（關掉 Arduino IDE 的監看視窗、make monitor）／板子沒進燒錄模式（按住左鍵 GPIO0 再按 RST）。');
  }
  try { await transport.disconnect(); } catch {}
  $('flash').disabled = !images; $('flashpre').disabled = !preManifest;
  setTimeout(() => startMonitor().catch(() => {}), 800);
}
$('flash').onclick = () => flashImages(images);

// 預編譯的正式韌體（網站 firmware/manifest.json；本機伺服器也可能有）
let preManifest = null;
fetch('firmware/manifest.json').then(r => r.ok ? r.json() : null).then(m => { preManifest = m; if (m) { $('flashpre').title = `正式韌體 ${m.built}`; $('flashpre').disabled = !port; } }).catch(() => {});
$('flashpre').onclick = () => flashImages(preManifest.images.map(i => ({ ...i, url: 'firmware/' + i.name })));

// ---------------- 序列埠監看：看到 TIME? 就回時間（接上電腦自動對時）
let writer = null;
async function startMonitor() {
  if (!port || monitoring) return;
  await port.open({ baudRate: 115200 }); monitoring = true; $('monitor').disabled = true; $('stopmon').disabled = false; $('send').disabled = false;
  writer = port.writable.getWriter();
  const dec = new TextDecoderStream(); const closed = port.readable.pipeTo(dec.writable).catch(() => {}); reader = dec.readable.getReader();
  let buf = '';
  M('— 監看中（115200）—');
  (async () => {
    try {
      while (monitoring) {
        const { value, done } = await reader.read(); if (done) break;
        buf += value; let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); M(line);
          if (line.startsWith('TIME?')) { const ep = Math.floor(Date.now() / 1000), tz = -new Date().getTimezoneOffset(); await sendCmd(`time ${ep} ${tz}`); M(`[電腦] 回覆 time ${ep} ${tz}`); }
        }
      }
    } catch (e) { M('監看中斷：' + e.message); }
    await closed;
  })();
}
async function sendCmd(s) { if (writer) await writer.write(new TextEncoder().encode(s + '\n')); }
async function stopMonitor() {
  if (!monitoring) return; monitoring = false;
  try { await reader.cancel(); } catch {} try { writer.releaseLock(); } catch {} try { await port.close(); } catch {}
  $('monitor').disabled = false; $('stopmon').disabled = true; $('send').disabled = true; M('— 已停止 —');
}
$('monitor').onclick = () => startMonitor().catch(e => M('開啟失敗：' + e.message));
$('stopmon').onclick = stopMonitor;
$('send').onclick = () => { const s = $('cmd').value.trim(); if (s) { sendCmd(s); M('> ' + s); $('cmd').value = ''; } };
$('cmd').onkeydown = e => { if (e.key === 'Enter') $('send').onclick(); };

// ---------------- 啟動：有沒有本機伺服器
(async () => {
  try {
    const env = await api('/api/ide/env'); server = true; files = env.files;
    $('file').innerHTML = files.map(f => `<option value="${f.id}">${f.label}</option>`).join('');
    $('env').textContent = `本機伺服器 ✓　arduino-cli ${env.arduino_cli ? '✓' : '✗'}　em++ ${env.em ? '✓' : '✗'}　序列埠 ${env.ports.length ? env.ports.join(' ') : '（沒看到 usbserial 裝置）'}`;
    await loadFile();
  } catch {
    server = false; $('noserver').style.display = 'block'; $('env').textContent = '靜態網站（無編譯伺服器）';
    cm.setValue('// 這裡沒有編譯伺服器，無法編輯後編譯。\n// 在老師的電腦執行 make ide，再開 http://localhost:8787/ide.html\n');
    ['save', 'reset', 'sim', 'build'].forEach(id => $(id).disabled = true); $('file').innerHTML = '<option>（需要本機伺服器）</option>';
    $('simcard').style.display = 'none';
  }
})();
