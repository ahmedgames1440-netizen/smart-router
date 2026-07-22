/* ============================================================
   راوتر السعودية الذكي — مدير الشبكة الذكي للبيت
   كل القياسات هنا حقيقية 100% (لا أرقام عشوائية):
   Ping / Jitter / فقدان الحزم / سرعة تحميل / سرعة رفع /
   Bufferbloat / DNS / بصمة الاتصال — عبر خوادم Cloudflare
   وواجهات المتصفح القياسية.
   ============================================================ */
'use strict';

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* حالة عامة يشاركها المعالج (قيم حقيقية مقاسة) */
const App = { fastestDns: null, gateway: null };

function toast(msg, ms = 2800) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ============================================================
   محرك القياس الحقيقي
   ============================================================ */
const PING_TARGETS = {
  cf:     'https://speed.cloudflare.com/__down?bytes=1000',
  google: 'https://www.gstatic.com/generate_204',
  ms:     'https://www.msftconnecttest.com/connecttest.txt'
};

async function pingOnce(server = 'cf', timeout = 4000) {
  const base = PING_TARGETS[server];
  const url = base + (base.includes('?') ? '&' : '?') + 't=' + performance.now();
  const ctrl = new AbortController();
  const kill = setTimeout(() => ctrl.abort(), timeout);
  const t0 = performance.now();
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
    return Math.round(performance.now() - t0);
  } catch (e) {
    return null;
  } finally {
    clearTimeout(kill);
  }
}

async function pingSample(n = 6, server = 'cf') {
  const results = [];
  for (let i = 0; i < n; i++) {
    results.push(await pingOnce(server));
    await sleep(110);
  }
  const ok = results.filter(v => v !== null);
  if (!ok.length) return { avg: null, jitter: null, loss: 100, best: null, samples: results };
  const avg = Math.round(ok.reduce((s, v) => s + v, 0) / ok.length);
  const jitter = ok.length > 1
    ? Math.round(ok.slice(1).reduce((s, v, i) => s + Math.abs(v - ok[i]), 0) / (ok.length - 1))
    : 0;
  const loss = Math.round((results.length - ok.length) / results.length * 100);
  return { avg, jitter, loss, best: Math.min(...ok), samples: results };
}

/* سرعة التحميل الحقيقية (Cloudflare) */
async function downloadTest(onProgress) {
  const SIZES = [1e6, 5e6, 10e6, 25e6];
  let best = 0;
  for (let i = 0; i < SIZES.length; i++) {
    const bytes = SIZES[i];
    const t0 = performance.now();
    try {
      const res = await fetch(`https://speed.cloudflare.com/__down?bytes=${bytes}&t=${performance.now()}`, { cache: 'no-store' });
      const reader = res.body.getReader();
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        const secs = (performance.now() - t0) / 1000;
        const mbps = (received * 8 / 1e6) / Math.max(secs, .05);
        best = Math.max(best, mbps);
        onProgress && onProgress(mbps, (i + received / bytes) / SIZES.length);
      }
    } catch (e) { /* نكمل */ }
  }
  return Math.round(best * 10) / 10;
}

/* سرعة الرفع الحقيقية (POST إلى Cloudflare) */
async function uploadTest(onProgress) {
  const SIZES = [2e6, 6e6, 6e6];
  let best = 0;
  for (let i = 0; i < SIZES.length; i++) {
    const bytes = SIZES[i];
    const body = new Uint8Array(bytes);
    const t0 = performance.now();
    try {
      await fetch(`https://speed.cloudflare.com/__up?t=${performance.now()}`, { method: 'POST', body, cache: 'no-store' });
      const secs = (performance.now() - t0) / 1000;
      const mbps = (bytes * 8 / 1e6) / Math.max(secs, .05);
      best = Math.max(best, mbps);
      onProgress && onProgress(mbps, (i + 1) / SIZES.length);
    } catch (e) { /* نكمل */ }
  }
  return Math.round(best * 10) / 10;
}

/* Bufferbloat: زمن الاستجابة تحت الحِمل مقابل الخمول (اختبار حقيقي) */
async function bufferbloatTest(onPhase) {
  onPhase && onPhase('idle');
  const idle = await pingSample(6);
  onPhase && onPhase('load');

  let stop = false;
  const loader = (async () => {
    // نشبع خط التحميل لخلق حِمل حقيقي
    for (let k = 0; k < 3 && !stop; k++) {
      try {
        const res = await fetch(`https://speed.cloudflare.com/__down?bytes=100000000&t=${performance.now()}`, { cache: 'no-store' });
        const reader = res.body.getReader();
        while (!stop) { const { done } = await reader.read(); if (done) break; }
        try { await reader.cancel(); } catch (e) {}
      } catch (e) {}
    }
  })();

  const loaded = [];
  const start = performance.now();
  while (performance.now() - start < 5000) {
    const v = await pingOnce('cf', 3000);
    if (v !== null) loaded.push(v);
  }
  stop = true;
  try { await loader; } catch (e) {}

  const loadedAvg = loaded.length ? Math.round(loaded.reduce((s, v) => s + v, 0) / loaded.length) : null;
  const bloat = (idle.avg !== null && loadedAvg !== null) ? Math.max(0, loadedAvg - idle.avg) : null;
  let grade = '—';
  if (bloat !== null) grade = bloat < 30 ? 'A' : bloat < 60 ? 'B' : bloat < 100 ? 'C' : bloat < 200 ? 'D' : 'F';
  return { idle: idle.avg, loaded: loadedAvg, bloat, grade };
}

/* بصمة الاتصال الحقيقية عبر Cloudflare (CORS مفعّل) */
async function getMeta() {
  const res = await fetch('https://speed.cloudflare.com/meta?t=' + performance.now(), { cache: 'no-store' });
  return await res.json();
}

/* عنوان IP المحلي عبر WebRTC (حقيقي — قد يخفيه المتصفح لأسباب خصوصية) */
function getLocalIP(timeout = 1600) {
  return new Promise(resolve => {
    let done = false;
    const finish = ips => { if (done) return; done = true; resolve(ips); };
    try {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      const found = new Set();
      pc.createDataChannel('x');
      pc.onicecandidate = e => {
        if (!e || !e.candidate) { cleanup(); return; }
        const m = /(\d{1,3}(?:\.\d{1,3}){3})|([a-f0-9]{0,4}(?::[a-f0-9]{0,4}){4,})/i.exec(e.candidate.candidate);
        if (m) {
          const ip = m[0];
          if (!/\.local$/i.test(ip)) found.add(ip);
        }
      };
      pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => {});
      const timer = setTimeout(cleanup, timeout);
      function cleanup() {
        clearTimeout(timer);
        try { pc.close(); } catch (e) {}
        // نقبل فقط عناوين الشبكة المحلية الخاصة — لا نعرض عنواناً عاماً كأنه محلي
        const priv = [...found].find(ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(ip));
        finish(priv || null);
      }
    } catch (e) { finish(null); }
  });
}

function connInfo() {
  const c = navigator.connection || {};
  return {
    type: c.effectiveType ? c.effectiveType.toUpperCase() : (navigator.onLine ? 'WiFi/شبكة' : '—'),
    downlink: c.downlink || null,
    rtt: c.rtt || null,
    save: c.saveData || false
  };
}

/* ============================================================
   التنقّل
   ============================================================ */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    tab.classList.add('active');
    $('view-' + tab.dataset.view).classList.add('active');
    if (tab.dataset.view === 'device' && !Device.loaded) Device.load();
    if (tab.dataset.view === 'gaming' && $('gamingToggle').checked) Gaming.ensureLoop();
  });
});

/* ============================================================
   1) الرئيسية
   ============================================================ */
const Home = {
  score: null,
  last: {},

  async refresh() {
    $('netStatusLabel').textContent = 'جارٍ قياس الشبكة…';
    const p = await pingSample(6);
    this.last.ping = p;

    $('statPing').textContent = p.avg ?? '—';
    $('statJitter').textContent = p.jitter ?? '—';

    this.recomputeScore();

    const st = $('netStatusLabel');
    if (!navigator.onLine || p.avg === null) { st.textContent = '⛔ غير متصل بالإنترنت'; st.className = 'net-status bad'; }
    else if (this.score >= 75) { st.textContent = `✅ متصل — استجابة ${p.avg}ms`; st.className = 'net-status ok'; }
    else if (this.score >= 45) { st.textContent = `⚠️ اتصال متوسط — ${p.avg}ms`; st.className = 'net-status warn'; }
    else { st.textContent = `🔴 اتصال ضعيف — ${p.avg}ms`; st.className = 'net-status bad'; }
    return p;
  },

  recomputeScore() {
    const p = this.last.ping;
    if (!p || p.avg === null) { this.setRing(null); return; }
    let s = 100;
    s -= clamp((p.avg - 50) * 0.4, 0, 40);
    s -= clamp((p.jitter || 0) * 0.8, 0, 20);
    s -= p.loss * 2;
    if (this.last.down >= 50) s += 8;
    if (this.last.down > 0 && this.last.down < 10) s -= 12;
    if (this.last.bloat != null) s -= clamp(this.last.bloat * 0.15, 0, 22);
    this.setRing(clamp(Math.round(s), 5, 100));
  },

  setRing(score) {
    this.score = score;
    const ring = $('ringFill');
    const C = 2 * Math.PI * 84;
    ring.style.strokeDashoffset = C - C * ((score || 0) / 100);
    ring.style.stroke = !score ? 'var(--bad)' : score >= 75 ? 'var(--good)' : score >= 45 ? 'var(--mid)' : 'var(--bad)';
    $('healthScore').textContent = score || '؟';
    $('healthLabel').textContent = !score ? 'لا يوجد اتصال' : score >= 75 ? 'الشبكة ممتازة' : score >= 45 ? 'الشبكة متوسطة' : 'الشبكة ضعيفة';
  },

  /* التحليل الحقيقي — كل بند مبني على رقم مقاس فعلياً */
  buildAnalysis() {
    const p = this.last.ping || {};
    const items = [];
    if (p.avg === null) {
      items.push({ ico: '⛔', t: 'لا يوجد اتصال', d: 'تعذّر الوصول للإنترنت — تحقق من الراوتر وكيبل الألياف.' });
    } else {
      if (p.avg > 120) items.push({ ico: '🐢', t: `زمن استجابة مرتفع (${p.avg}ms)`, d: 'اقترب من الراوتر أو استخدم نطاق 5GHz أو سلك شبكة. تحقق من عدم وجود تحميل كثيف على الشبكة.' });
      if ((p.jitter || 0) > 25) items.push({ ico: '📉', t: `تذبذب عالٍ (Jitter ${p.jitter}ms)`, d: 'إشارة غير مستقرة — تداخل موجات أو ازدحام. جرّب تقريب الجهاز أو تغيير قناة الراوتر.' });
      if (p.loss > 0) items.push({ ico: '📦', t: `فقدان حزم ${p.loss}%`, d: 'يسبب تقطيعاً في المكالمات والألعاب — مؤشر تداخل أو ضعف إشارة في موقعك.' });
      if (this.last.bloat != null && this.last.bloat >= 100) items.push({ ico: '🌊', t: `Bufferbloat عالٍ (+${this.last.bloat}ms تحت الحِمل)`, d: 'الاستجابة تنهار وقت التحميل — فعّل SQM/QoS في الراوتر لتثبيت الـ Ping. هذا سبب رئيسي للّاق أثناء التحميلات.' });
      if (this.last.up != null && this.last.down != null && this.last.up > 0 && this.last.up < this.last.down * 0.05)
        items.push({ ico: '⬆️', t: `رفع منخفض جداً (${this.last.up}Mbps)`, d: 'قد يعيق المكالمات المرئية ورفع الملفات — تحقق من نوع باقتك.' });
      if (!items.length) items.push({ ico: '✨', t: 'شبكتك بحالة ممتازة!', d: `لا مشاكل مكتشفة — استجابة ${p.avg}ms${this.last.down ? ` وسرعة ${this.last.down}Mbps` : ''}.` });
    }
    const list = $('analysisList');
    list.innerHTML = '';
    items.forEach(it => {
      const div = document.createElement('div');
      div.className = 'bn-item';
      div.innerHTML = `<span class="bn-ico">${it.ico}</span><div style="flex:1"><b>${it.t}</b><p>${it.d}</p></div>`;
      list.appendChild(div);
    });
  }
};
$('btnQuick').addEventListener('click', async () => {
  const b = $('btnQuick');
  if (b.classList.contains('working')) return;
  b.classList.add('working'); $('quickLabel').textContent = 'جارٍ الفحص…';
  await Home.refresh();
  Home.buildAnalysis();
  b.classList.remove('working'); $('quickLabel').textContent = 'فحص سريع';
  toast(`⚡ فحص سريع: استجابة ${Home.last.ping.avg ?? '—'}ms`);
});

/* الاختبار الكامل: تحميل + رفع + bufferbloat */
$('btnFullTest').addEventListener('click', async () => {
  const btn = $('btnFullTest');
  if (btn.disabled) return;
  btn.disabled = true; btn.textContent = 'جارٍ القياس…';
  $('fullResults').classList.add('hidden');
  ['frDown', 'frUp', 'frBloat', 'frGrade'].forEach(id => $(id).textContent = '…');

  // تحميل
  $('speedPhase').textContent = '⬇️ قياس سرعة التحميل الفعلية…';
  const down = await downloadTest((cur, prog) => {
    $('speedNow').textContent = cur.toFixed(1);
    $('speedBarFill').style.width = Math.min(100, prog * 100) + '%';
  });
  Home.last.down = down;
  $('statDown').textContent = down || '—';
  $('frDown').textContent = down ? down + ' Mbps' : 'فشل';

  // رفع
  $('speedPhase').textContent = '⬆️ قياس سرعة الرفع الفعلية…';
  $('speedBarFill').style.width = '0%';
  const up = await uploadTest((cur, prog) => {
    $('speedNow').textContent = cur.toFixed(1);
    $('speedBarFill').style.width = Math.min(100, prog * 100) + '%';
  });
  Home.last.up = up;
  $('statUp').textContent = up || '—';
  $('frUp').textContent = up ? up + ' Mbps' : 'فشل';

  // bufferbloat
  $('speedPhase').textContent = '🌊 قياس الاستقرار تحت الحِمل (Bufferbloat)…';
  const bb = await bufferbloatTest(phase => {
    $('speedPhase').textContent = phase === 'idle' ? '🌊 قياس الاستجابة في الخمول…' : '🌊 قياس الاستجابة أثناء تحميل كثيف…';
  });
  Home.last.bloat = bb.bloat;
  $('frBloat').textContent = bb.bloat != null ? '+' + bb.bloat + 'ms' : '—';
  $('frGrade').textContent = bb.grade;
  $('frGrade').className = 'grade-' + (bb.grade === 'A' || bb.grade === 'B' ? 'good' : bb.grade === 'C' ? 'mid' : 'bad');

  $('fullResults').classList.remove('hidden');
  const verdict = down >= 80 ? 'سرعة ممتازة 👑' : down >= 25 ? 'سرعة جيدة ✅' : 'سرعة منخفضة ⚠️';
  $('speedPhase').textContent = `اكتمل: تحميل ${down} • رفع ${up} Mbps • استقرار ${bb.grade} — ${verdict}`;
  $('speedNow').textContent = down.toFixed(1);
  $('speedBarFill').style.width = '100%';

  Home.recomputeScore();
  Home.buildAnalysis();
  btn.disabled = false; btn.textContent = 'إعادة الاختبار';
  toast(`✅ اكتمل: ⬇️${down} ⬆️${up} Mbps • Bufferbloat ${bb.grade}`);
});

/* ============================================================
   2) جهازي والاتصال — بيانات حقيقية
   ============================================================ */
const Device = {
  loaded: false,

  async load() {
    this.loaded = true;
    await this.fingerprint();
    this.specs();
  },

  async fingerprint() {
    const grid = $('fpGrid');
    grid.innerHTML = '<div class="fp-row"><span>جارٍ جلب بيانات الاتصال…</span></div>';
    let meta = {};
    try { meta = await getMeta(); } catch (e) { meta = {}; }
    const localIP = await getLocalIP();
    const info = connInfo();
    const isV6 = meta.clientIp && meta.clientIp.includes(':');
    const colo = meta.colo && typeof meta.colo === 'object'
      ? `${meta.colo.city || meta.colo.iata || ''}${meta.colo.iata ? ' (' + meta.colo.iata + ')' : ''}`.trim()
      : (meta.colo || '—');

    const rows = [
      ['🌐 عنوان IP العام', meta.clientIp || 'غير متاح'],
      ['🏢 مزود الخدمة', meta.asOrganization || '—'],
      ['📍 الموقع', [meta.city, meta.country].filter(Boolean).join('، ') || '—'],
      ['🛰️ أقرب مركز Cloudflare', colo || '—'],
      ['🏠 عنوان IP المحلي', localIP || 'مخفي بواسطة المتصفح (خصوصية)'],
      ['🔀 دعم IPv6', isV6 ? 'نعم ✓ (متصل عبر IPv6)' : 'يستخدم IPv4'],
      ['📡 بروتوكول HTTP', meta.httpProtocol || '—'],
      ['📶 نوع الاتصال', info.type + (info.rtt ? ` • RTT ~${info.rtt}ms` : '')]
    ];
    grid.innerHTML = rows.map(([k, v]) => `<div class="fp-row"><span>${k}</span><b>${v}</b></div>`).join('');

    // رابط لوحة الراوتر بناءً على IP المحلي إن توفر (وإلا الافتراضي الشائع)
    const gw = localIP && /^(10\.|192\.168\.|172\.)/.test(localIP) ? localIP.replace(/\.\d+$/, '.1') : '192.168.1.1';
    App.gateway = gw;
    const link = $('routerLink');
    link.href = 'http://' + gw + '/';
    link.textContent = `🔧 فتح لوحة الراوتر (${gw})`;
  },

  specs() {
    const nav = navigator;
    const scr = window.screen;
    const rows = [
      ['💻 النظام', nav.platform || '—'],
      ['⚙️ أنوية المعالج', (nav.hardwareConcurrency || '—') + ' نواة'],
      ['🧠 الذاكرة التقريبية', nav.deviceMemory ? nav.deviceMemory + ' GB' : 'غير متاح'],
      ['🖥️ دقة الشاشة', `${scr.width}×${scr.height} @${window.devicePixelRatio}x`],
      ['🌍 اللغة', nav.language || '—'],
      ['🔋 البطارية', 'جارٍ الفحص…'],
      ['🌐 الحالة', nav.onLine ? 'متصل ✓' : 'غير متصل ✗']
    ];
    const grid = $('specGrid');
    grid.innerHTML = rows.map(([k, v]) => `<div class="fp-row"><span>${k}</span><b>${v}</b></div>`).join('');
    if (nav.getBattery) {
      nav.getBattery().then(b => {
        const bEl = grid.querySelectorAll('.fp-row b')[5];
        if (bEl) bEl.textContent = `${Math.round(b.level * 100)}% ${b.charging ? '⚡ يشحن' : ''}`;
      }).catch(() => {});
    } else {
      grid.querySelectorAll('.fp-row b')[5].textContent = 'غير متاح على هذا الجهاز';
    }
  }
};
$('btnRefreshFP').addEventListener('click', () => { Device.fingerprint(); toast('🔄 جارٍ تحديث بيانات الاتصال'); });

/* مقياس DNS الحقيقي */
const DNS_PROVIDERS = [
  { name: 'Cloudflare', ip: '1.1.1.1', url: n => `https://cloudflare-dns.com/dns-query?name=${n}&type=A`, headers: { accept: 'application/dns-json' } },
  { name: 'Google', ip: '8.8.8.8', url: n => `https://dns.google/resolve?name=${n}&type=A`, headers: {} },
  { name: 'DNS.SB', ip: '185.222.222.222', url: n => `https://doh.sb/dns-query?name=${n}&type=A`, headers: { accept: 'application/dns-json' } }
];

async function dnsBench(provider) {
  const times = [];
  for (let i = 0; i < 4; i++) {
    const name = `t${Math.floor(performance.now())}${i}.cloudflare.com`;
    const t0 = performance.now();
    const ctrl = new AbortController();
    const kill = setTimeout(() => ctrl.abort(), 5000);
    try {
      await fetch(provider.url(name), { headers: provider.headers, cache: 'no-store', signal: ctrl.signal });
      times.push(performance.now() - t0);
    } catch (e) { return null; }
    finally { clearTimeout(kill); }
    await sleep(60);
  }
  times.sort((a, b) => a - b);
  return Math.round(times[Math.floor(times.length / 2)]);
}

$('btnDnsBench').addEventListener('click', async () => {
  const btn = $('btnDnsBench');
  btn.disabled = true; btn.textContent = 'يقيس…';
  const list = $('dnsList');
  list.innerHTML = DNS_PROVIDERS.map(p => `<div class="dns-row" data-p="${p.name}"><span>${p.name} <small>${p.ip}</small></span><b>…</b></div>`).join('');
  const results = [];
  for (const p of DNS_PROVIDERS) {
    const ms = await dnsBench(p);
    results.push({ name: p.name, ms });
    const row = list.querySelector(`[data-p="${p.name}"] b`);
    row.textContent = ms == null ? 'غير متاح' : ms + ' ms';
  }
  const valid = results.filter(r => r.ms != null).sort((a, b) => a.ms - b.ms);
  if (valid.length) {
    const best = valid[0];
    App.fastestDns = { name: best.name, ip: DNS_PROVIDERS.find(p => p.name === best.name).ip, ms: best.ms };
    list.querySelectorAll('.dns-row').forEach(r => {
      if (r.dataset.p === best.name) r.classList.add('best');
    });
    const rec = document.createElement('div');
    rec.className = 'advice-box';
    rec.style.marginTop = '12px';
    rec.innerHTML = `✅ <b>الأسرع لك: ${best.name} (${best.ms}ms)</b> — لتسريع فتح المواقع، اضبط DNS الراوتر على <b>${DNS_PROVIDERS.find(p => p.name === best.name).ip}</b>.`;
    list.appendChild(rec);
  }
  btn.disabled = false; btn.textContent = 'إعادة القياس';
});

/* ============================================================
   3) التغطية — قياس Ping + سرعة حقيقية لكل غرفة
   ============================================================ */
const ROOMS = [
  { id: 'majlis', ico: '🛋️', name: 'المجلس' },
  { id: 'salah', ico: '🏠', name: 'الصالة' },
  { id: 'kitchen', ico: '🍳', name: 'المطبخ' },
  { id: 'bed1', ico: '🛏️', name: 'غرفة النوم 1' },
  { id: 'hall', ico: '🚪', name: 'الممر' },
  { id: 'bed2', ico: '🛏️', name: 'غرفة النوم 2' },
  { id: 'office', ico: '💼', name: 'المكتب' },
  { id: 'dining', ico: '🍽️', name: 'الطعام' },
  { id: 'yard', ico: '🌳', name: 'الحوش' }
];

const Coverage = {
  selected: null,
  results: {},

  init() {
    try { this.results = JSON.parse(localStorage.getItem('sr_coverage') || '{}'); } catch (e) { this.results = {}; }
    const map = $('homeMap');
    ROOMS.forEach(r => {
      const div = document.createElement('div');
      div.className = 'room';
      div.id = 'room-' + r.id;
      div.innerHTML = `<span>${r.ico}</span><b>${r.name}</b><small>—</small>`;
      div.addEventListener('click', () => this.select(r.id));
      map.appendChild(div);
    });
    Object.keys(this.results).forEach(id => this.paint(id));
    this.updateAdvice();
    $('btnMeasureRoom').addEventListener('click', () => this.measure());
  },

  select(id) {
    this.selected = id;
    document.querySelectorAll('.room').forEach(el => el.classList.remove('selected'));
    $('room-' + id).classList.add('selected');
    const room = ROOMS.find(r => r.id === id);
    const btn = $('btnMeasureRoom');
    btn.disabled = false;
    btn.textContent = `📶 قياس الإشارة في «${room.name}»`;
  },

  paint(id) {
    const el = $('room-' + id);
    const res = this.results[id];
    if (!el || !res) return;
    el.classList.remove('q-good', 'q-mid', 'q-bad');
    el.classList.add(res.score >= 70 ? 'q-good' : res.score >= 40 ? 'q-mid' : 'q-bad');
    el.querySelector('small').textContent = `${res.score}%${res.down ? ' • ' + res.down + 'M' : ''}`;
  },

  async measure() {
    if (!this.selected) return;
    const btn = $('btnMeasureRoom');
    const room = ROOMS.find(r => r.id === this.selected);
    btn.disabled = true;
    btn.textContent = '⏱️ قياس الاستجابة…';
    const p = await pingSample(5);
    btn.textContent = '⬇️ قياس السرعة هنا…';
    // قياس سرعة سريع حقيقي (عيّنة 5MB)
    let down = 0;
    const t0 = performance.now();
    try {
      const res = await fetch(`https://speed.cloudflare.com/__down?bytes=5000000&t=${performance.now()}`, { cache: 'no-store' });
      const reader = res.body.getReader();
      let rec = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; rec += value.length; }
      down = Math.round((rec * 8 / 1e6) / ((performance.now() - t0) / 1000) * 10) / 10;
    } catch (e) { down = 0; }

    let score = 0;
    if (p.avg !== null) {
      score = 100 - clamp((p.avg - 50) * 0.45, 0, 50) - clamp((p.jitter || 0) * 0.6, 0, 20) - p.loss * 2;
      if (down > 0 && down < 10) score -= 15;
      if (down >= 50) score += 8;
      score = clamp(Math.round(score), 5, 100);
    }
    this.results[this.selected] = { score, ping: p.avg ?? '⛔', down };
    localStorage.setItem('sr_coverage', JSON.stringify(this.results));
    this.paint(this.selected);
    this.updateAdvice();
    toast(score >= 70 ? `✅ «${room.name}»: ممتازة (${score}% • ${down}Mbps)` :
          score >= 40 ? `⚠️ «${room.name}»: متوسطة (${score}% • ${down}Mbps)` :
          `🔴 «${room.name}»: ضعيفة (${score}% • ${down}Mbps)`);
    btn.disabled = false; btn.textContent = `📶 قياس الإشارة في «${room.name}»`;
  },

  updateAdvice() {
    const entries = Object.entries(this.results);
    const ul = $('coverageAdvice');
    if (entries.length < 3) {
      ul.innerHTML = `<li>قِس ${Math.max(0, 3 - entries.length)} غرف إضافية ليقارن التطبيق بين مواقعك ويقترح أفضل مكان للراوتر.</li>`;
      return;
    }
    const sorted = entries.map(([id, r]) => ({ room: ROOMS.find(x => x.id === id), ...r })).sort((a, b) => b.score - a.score);
    const best = sorted[0], worst = sorted[sorted.length - 1];
    const avg = Math.round(sorted.reduce((s, r) => s + r.score, 0) / sorted.length);
    const tips = [
      `<b>أقوى تغطية:</b> ${best.room.name} (${best.score}%${best.down ? ' • ' + best.down + 'Mbps' : ''}).`,
      `<b>أضعف تغطية:</b> ${worst.room.name} (${worst.score}%${worst.down ? ' • ' + worst.down + 'Mbps' : ''}) — ${worst.score < 40 ? 'ننصح بمقوّي إشارة Mesh هنا.' : 'مقبولة ويمكن تحسينها.'}`,
      `<b>متوسط تغطية البيت:</b> ${avg}% ${avg >= 70 ? '👑 ممتاز' : avg >= 50 ? '— جيد' : '— يحتاج تحسين'}`,
      `<b>التوصية:</b> ${avg < 60 ? 'انقل الراوتر لمنتصف البيت وارفعه عن الأرض ~1.5م بعيداً عن الجدران السميكة والمعادن.' : 'مكان الراوتر مناسب — استخدم 5GHz للأجهزة القريبة و2.4GHz للغرف البعيدة.'}`
    ];
    ul.innerHTML = tips.map(t => `<li>${t}</li>`).join('');
  }
};

/* ============================================================
   4) وضع الألعاب — Ping حي حقيقي
   ============================================================ */
const Gaming = {
  running: false, server: 'cf', history: [], sent: 0, lost: 0,

  ensureLoop() { if ($('gamingToggle').checked && !this.running) this.loop(); },

  async loop() {
    this.running = true;
    while ($('gamingToggle').checked) {
      const v = await pingOnce(this.server, 3000);
      this.sent++;
      if (v === null) this.lost++;
      else { this.history.push(v); if (this.history.length > 60) this.history.shift(); }
      this.draw();
      this.updateStats(v);
      await sleep(700);
    }
    this.running = false;
  },

  updateStats(last) {
    const h = this.history;
    $('gamePing').textContent = last ?? '⛔';
    if (!h.length) return;
    const avg = Math.round(h.reduce((s, v) => s + v, 0) / h.length);
    const jitter = h.length > 1 ? Math.round(h.slice(1).reduce((s, v, i) => s + Math.abs(v - h[i]), 0) / (h.length - 1)) : 0;
    $('gAvg').textContent = avg + 'ms';
    $('gBest').textContent = Math.min(...h) + 'ms';
    $('gJitter').textContent = jitter + 'ms';
    $('gLoss').textContent = Math.round(this.lost / Math.max(1, this.sent) * 100) + '%';
    const grade = $('gameGrade');
    if (avg <= 40 && jitter <= 12) { grade.textContent = '👑 تقييم S — مثالي للألعاب التنافسية'; grade.className = 'game-grade s'; }
    else if (avg <= 80) { grade.textContent = '✅ تقييم B — جيد لمعظم الألعاب'; grade.className = 'game-grade b'; }
    else { grade.textContent = '⚠️ تقييم C — قد تواجه لاق'; grade.className = 'game-grade c'; }
  },

  draw() {
    const cv = $('pingCanvas'); const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const h = this.history;
    if (!h.length) return;
    const max = Math.max(100, ...h);
    ctx.strokeStyle = 'rgba(147,164,195,.15)'; ctx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach(f => { ctx.beginPath(); ctx.moveTo(0, H * f); ctx.lineTo(W, H * f); ctx.stroke(); });
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(34,211,238,.5)'); grad.addColorStop(1, 'rgba(34,211,238,0)');
    ctx.beginPath();
    h.forEach((v, i) => {
      const x = (i / Math.max(1, h.length - 1)) * W;
      const y = H - (v / max) * (H - 14) - 6;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  }
};
$('gamingToggle').addEventListener('change', e => {
  if (e.target.checked) {
    toast('🎮 بدأت المراقبة الحية — قياس Ping فعلي كل 0.7 ثانية');
    Gaming.history = []; Gaming.sent = 0; Gaming.lost = 0;
    Gaming.ensureLoop();
  } else {
    toast('توقفت المراقبة');
    $('gameGrade').textContent = 'شغّل المراقبة لقياس Ping الحي فعلياً';
    $('gameGrade').className = 'game-grade';
  }
});
$('serverRow').addEventListener('click', e => {
  const btn = e.target.closest('.server-btn');
  if (!btn) return;
  document.querySelectorAll('.server-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  Gaming.server = btn.dataset.server;
  Gaming.history = []; Gaming.sent = 0; Gaming.lost = 0;
  toast(`🌍 تم التبديل لخادم ${btn.firstChild.textContent.trim()}`);
});

/* ============================================================
   5) التشخيص الشامل — كله حقيقي
   ============================================================ */
const DIAG_STEPS = [
  { id: 'net', name: 'الاتصال بالإنترنت', ico: '🌐' },
  { id: 'dns', name: 'أسرع خادم DNS', ico: '🧭' },
  { id: 'ping', name: 'زمن الاستجابة (Ping)', ico: '⏱️' },
  { id: 'jitter', name: 'استقرار الاتصال (Jitter)', ico: '📊' },
  { id: 'loss', name: 'فقدان الحزم', ico: '📦' },
  { id: 'down', name: 'سرعة التحميل', ico: '⬇️' },
  { id: 'up', name: 'سرعة الرفع', ico: '⬆️' },
  { id: 'bloat', name: 'الاستقرار تحت الحِمل (Bufferbloat)', ico: '🌊' }
];

const Diagnose = {
  lastReport: '',
  async run() {
    const btn = $('btnDiagnose');
    btn.disabled = true; btn.textContent = 'جارٍ الفحص…';
    $('diagReportCard').classList.add('hidden');
    const wrap = $('diagSteps'); wrap.innerHTML = '';
    const els = {};
    DIAG_STEPS.forEach(s => {
      const div = document.createElement('div');
      div.className = 'dstep';
      div.innerHTML = `<span class="ds-ico">${s.ico}</span><span class="ds-name">${s.name}</span><span class="ds-val">بالانتظار…</span>`;
      wrap.appendChild(div); els[s.id] = div;
    });
    const set = (id, state, val) => { els[id].className = 'dstep ' + state; els[id].querySelector('.ds-val').textContent = val; };
    const go = id => { els[id].classList.add('running'); els[id].querySelector('.ds-ico').textContent = '⏳'; };
    const back = id => { els[id].querySelector('.ds-ico').textContent = DIAG_STEPS.find(s => s.id === id).ico; };
    const rep = { time: new Date().toLocaleString('ar-SA'), items: [], problems: [] };

    // 1) إنترنت
    go('net');
    const online = navigator.onLine && (await pingOnce('google')) !== null;
    back('net'); set('net', online ? 'ok' : 'fail', online ? 'متصل ✓' : 'منقطع ✗');
    rep.items.push(`الاتصال بالإنترنت: ${online ? 'متصل' : 'منقطع'}`);
    if (!online) rep.problems.push('لا يوجد اتصال — أعد تشغيل الراوتر، تأكد من كيبل الألياف، ثم اتصل بمزود الخدمة إن استمر.');

    // 2) DNS
    go('dns');
    let bestDns = null;
    for (const p of DNS_PROVIDERS) {
      const ms = await dnsBench(p);
      if (ms != null && (!bestDns || ms < bestDns.ms)) bestDns = { name: p.name, ip: p.ip, ms };
    }
    back('dns');
    if (bestDns) App.fastestDns = bestDns;
    set('dns', bestDns ? (bestDns.ms < 120 ? 'ok' : 'warn') : 'fail', bestDns ? `${bestDns.name} ${bestDns.ms}ms` : 'فشل');
    rep.items.push(`أسرع DNS: ${bestDns ? bestDns.name + ' (' + bestDns.ms + 'ms)' : 'غير متاح'}`);
    if (bestDns && bestDns.ms >= 120) rep.problems.push(`استجابة DNS بطيئة — اضبط DNS الراوتر على ${bestDns.ip} (${bestDns.name}).`);

    // 3-5) Ping
    go('ping');
    const p = await pingSample(8);
    back('ping');
    if (p.avg === null) {
      set('ping', 'fail', 'فشل'); set('jitter', 'fail', '—'); set('loss', 'fail', '100%');
    } else {
      set('ping', p.avg <= 90 ? 'ok' : p.avg <= 200 ? 'warn' : 'fail', p.avg + 'ms');
      set('jitter', (p.jitter || 0) <= 20 ? 'ok' : 'warn', p.jitter + 'ms');
      set('loss', p.loss === 0 ? 'ok' : p.loss <= 10 ? 'warn' : 'fail', p.loss + '%');
    }
    rep.items.push(`Ping: ${p.avg ?? '—'}ms | Jitter: ${p.jitter ?? '—'}ms | فقدان الحزم: ${p.loss}%`);
    if (p.avg > 200) rep.problems.push('زمن استجابة مرتفع — اقترب من الراوتر أو استخدم 5GHz/سلك، وتحقق من التحميلات الكثيفة.');
    if (p.loss > 10) rep.problems.push('فقدان حزم مرتفع — مؤشر تداخل موجات أو مشكلة لدى مزود الخدمة.');

    // 6) تحميل
    go('down');
    const down = await downloadTest(cur => els.down.querySelector('.ds-val').textContent = cur.toFixed(1) + ' Mbps');
    back('down'); set('down', down >= 25 ? 'ok' : down > 0 ? 'warn' : 'fail', down > 0 ? down + ' Mbps' : 'فشل');
    rep.items.push(`سرعة التحميل: ${down} Mbps`);
    if (down > 0 && down < 25) rep.problems.push('التحميل أقل من المتوقع — قارنه بسرعة باقتك؛ إن كان الفرق كبيراً اطلب فحص خط من المزود.');

    // 7) رفع
    go('up');
    const up = await uploadTest(cur => els.up.querySelector('.ds-val').textContent = cur.toFixed(1) + ' Mbps');
    back('up'); set('up', up >= 10 ? 'ok' : up > 0 ? 'warn' : 'fail', up > 0 ? up + ' Mbps' : 'فشل');
    rep.items.push(`سرعة الرفع: ${up} Mbps`);

    // 8) bufferbloat
    go('bloat');
    const bb = await bufferbloatTest(ph => els.bloat.querySelector('.ds-val').textContent = ph === 'idle' ? 'قياس الخمول…' : 'قياس تحت الحِمل…');
    back('bloat');
    set('bloat', bb.grade === 'A' || bb.grade === 'B' ? 'ok' : bb.grade === 'C' ? 'warn' : 'fail', bb.bloat != null ? `+${bb.bloat}ms (${bb.grade})` : 'فشل');
    rep.items.push(`Bufferbloat: +${bb.bloat ?? '—'}ms تحت الحِمل (تقييم ${bb.grade})`);
    if (bb.bloat != null && bb.bloat >= 100) rep.problems.push('Bufferbloat عالٍ — الاستجابة تنهار وقت التحميل. فعّل SQM/QoS في الراوتر لتثبيت الـ Ping (أهم إصلاح للّاق).');

    // مزامنة نتائج الرئيسية
    Home.last.down = down; Home.last.up = up; Home.last.bloat = bb.bloat; Home.last.ping = p;
    $('statDown').textContent = down || '—'; $('statUp').textContent = up || '—';
    Home.recomputeScore(); Home.buildAnalysis();

    // التقرير
    const el = $('diagReport');
    const status = rep.problems.length === 0
      ? '<b style="color:var(--good)">✅ النتيجة: شبكتك سليمة — لا مشاكل مكتشفة.</b>'
      : `<b style="color:var(--mid)">⚠️ النتيجة: وُجدت ${rep.problems.length} ملاحظة — الحلول بالأسفل.</b>`;
    el.innerHTML =
      `${status}\n\n<b>📊 القياسات الحقيقية:</b>\n` + rep.items.map(i => '• ' + i).join('\n') +
      (rep.problems.length ? `\n\n<b>🔧 المشاكل والحلول:</b>\n` + rep.problems.map((x, i) => `${i + 1}. ${x}`).join('\n') : '') +
      `\n\n<b>🕐 وقت الفحص:</b> ${rep.time}`;
    $('diagReportCard').classList.remove('hidden');
    this.lastReport = `تقرير فحص الشبكة — راوتر السعودية الذكي\n${rep.time}\n\nالقياسات:\n${rep.items.map(i => '- ' + i).join('\n')}\n\n${rep.problems.length ? 'المشاكل والحلول:\n' + rep.problems.map((x, i) => `${i + 1}. ${x}`).join('\n') : 'لا توجد مشاكل — الشبكة سليمة.'}`;
    btn.disabled = false; btn.textContent = 'إعادة الفحص';
    toast(rep.problems.length ? `🩺 اكتمل الفحص — ${rep.problems.length} ملاحظة` : '🩺 اكتمل الفحص — شبكتك سليمة');
  }
};
$('btnDiagnose').addEventListener('click', () => Diagnose.run());
$('btnCopyReport').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(Diagnose.lastReport || ''); toast('📋 نُسخ التقرير — أرسله للدعم الفني'); }
  catch (e) { toast('تعذّر النسخ'); }
});

/* ============================================================
   معالج ضبط الراوتر — يحوّل القياسات الحقيقية لخطوات عملية
   ============================================================ */
const Wizard = {
  step: 0, steps: [], before: null, gateway: '192.168.1.1',

  async open() {
    this.gateway = App.gateway || '192.168.1.1';
    if (!App.gateway) {
      const ip = await getLocalIP(1200);
      if (ip && /^(10\.|192\.168\.|172\.)/.test(ip)) this.gateway = ip.replace(/\.\d+$/, '.1');
    }
    this.before = {
      down: Home.last.down || null, up: Home.last.up || null,
      bloat: Home.last.bloat != null ? Home.last.bloat : null,
      ping: (Home.last.ping && Home.last.ping.avg) || null
    };
    this.build();
    this.step = 0;
    $('wizard').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    this.render();
  },
  close() { $('wizard').classList.add('hidden'); document.body.style.overflow = ''; },

  build() {
    const dns = App.fastestDns;
    const bloatHigh = Home.last.bloat != null && Home.last.bloat >= 100;
    const s = [];

    s.push({
      title: 'افتح لوحة تحكم راوترك',
      lead: 'كل الضبط يتم من لوحة الراوتر — تأكد أنك متصل بنفس شبكة الواي فاي، ثم افتحها:',
      openRouter: true,
      hint: 'بيانات الدخول عادةً على ملصق أسفل الراوتر (Username/Password). راوترات STC غالباً المستخدم <b>admin</b> وكلمة المرور على الملصق. لو غيّرتها ونسيتها، اضغط زر Reset ~10 ثوانٍ للعودة للإعدادات الافتراضية.',
      check: 'دخلت لوحة الراوتر'
    });

    s.push({
      title: 'اضبط DNS الأسرع',
      badge: dns ? { t: `الأسرع لك: ${dns.name} (${dns.ms}ms)`, c: 'ok' } : null,
      lead: 'تغيير DNS يسرّع فتح المواقع والتطبيقات فوراً. في اللوحة ابحث عن <b>DNS</b> (داخل WAN/Internet أو DHCP) وأدخل:',
      values: dns
        ? [['DNS الأساسي', dns.ip], ['DNS الاحتياطي', dns.ip === '1.1.1.1' ? '1.0.0.1' : '8.8.4.4']]
        : [['DNS الأساسي', '1.1.1.1'], ['DNS الاحتياطي', '8.8.8.8']],
      hint: dns ? '' : 'للأدق: شغّل «أسرع DNS لك» في تبويب جهازي أولاً، وسيظهر هنا الأنسب لموقعك.',
      check: 'ضبطت DNS'
    });

    s.push({
      title: 'افصل نطاقي 2.4 و 5 جيجا',
      lead: 'أعطِ كل نطاق اسماً مختلفاً لتختار يدوياً: <b>5GHz</b> للسرعة والألعاب في الغرف القريبة، و<b>2.4GHz</b> للتغطية البعيدة والأجهزة الذكية.',
      values: [['اسم شبكة 5 جيجا', 'MyWiFi_5G'], ['اسم شبكة 2.4 جيجا', 'MyWiFi_2G']],
      hint: 'ابحث عن <b>Wireless / WiFi Settings</b>، وعطّل «Smart Connect / Band Steering» ليظهر الفصل.',
      check: 'فصلت النطاقين'
    });

    s.push({
      title: bloatHigh ? 'فعّل SQM/QoS — مهم جداً لك' : 'فعّل QoS لأولوية الاستخدام',
      badge: bloatHigh ? { t: `قياسك: Bufferbloat +${Home.last.bloat}ms`, c: 'hot' } : null,
      lead: bloatHigh
        ? 'قياسك أظهر <b>Bufferbloat عالياً</b> — يعني الـ Ping ينهار وقت التحميل ويسبب لاق وتقطيع بالمكالمات والألعاب. الحل الحقيقي: فعّل <b>SQM</b> أو <b>Smart Queue / QoS</b>، وأدخل سرعة باقتك (مثلاً 100 تحميل / 25 رفع).'
        : 'فعّل <b>QoS</b> لإعطاء أولوية للألعاب والمكالمات على التحميلات الخلفية وقت الزحمة.',
      hint: 'ابحث عن <b>QoS</b> أو <b>Bandwidth Control</b> أو <b>SQM</b>. لو راوترك لا يدعمها، راوتر يدعم OpenWrt يحلّها تماماً.',
      check: bloatHigh ? 'فعّلت SQM/QoS' : 'فعّلت QoS'
    });

    s.push({
      title: 'حسّن مكان الراوتر والقناة',
      lead: 'انقل الراوتر لمنتصف البيت، مرتفعاً ~1.5م، بعيداً عن الجدران السميكة والمعادن والمايكروويف. وفي إعدادات Wireless اضبط <b>Channel</b> على Auto أو جرّب قناة أقل ازدحاماً (1/6/11 لنطاق 2.4).',
      hint: 'استخدم تبويب <b>التغطية</b> لقياس كل غرفة ومعرفة أضعف نقطة — لو غرفة ضعيفة جداً أضف موسّع/Mesh هناك.',
      check: 'حسّنت الموقع والقناة'
    });

    s.push({
      title: 'حدّث النظام وأعد التشغيل',
      lead: 'ابحث عن <b>Firmware Update</b> وحدّث لأحدث إصدار (يصلح ثغرات ويحسّن الأداء)، ثم أعد تشغيل الراوتر ليطبّق كل التغييرات.',
      hint: 'بعد إعادة التشغيل انتظر دقيقة كاملة حتى يعود الاتصال، ثم انتقل للخطوة الأخيرة لقياس الفرق.',
      check: 'حدّثت وأعدت التشغيل'
    });

    s.push({ compare: true });
    this.steps = s;
  },

  render() {
    const s = this.steps[this.step];
    const n = this.steps.length;
    $('wizStepLabel').textContent = `الخطوة ${this.step + 1} من ${n}`;
    $('wizProgress').style.width = ((this.step + 1) / n * 100) + '%';
    $('wizPrev').style.visibility = this.step === 0 ? 'hidden' : 'visible';
    $('wizNext').textContent = this.step === n - 1 ? 'إنهاء' : 'التالي';
    const body = $('wizBody');
    body.scrollTop = 0;

    if (s.compare) { this.renderCompare(body); return; }

    let html = `<div class="wiz-step"><div class="wiz-step-num">${this.step + 1}</div>`;
    if (s.badge) html += `<div class="wiz-badge ${s.badge.c}">${s.badge.t}</div>`;
    html += `<h3>${s.title}</h3><p class="wiz-lead">${s.lead}</p>`;
    if (s.openRouter) {
      const alts = ['192.168.1.1', '192.168.8.1', '192.168.0.1', '10.0.0.1'];
      html += `<button class="wiz-open-btn" data-open="http://${this.gateway}/">🔧 افتح لوحة الراوتر (${this.gateway})</button>`;
      html += `<div class="wiz-hint">لو ما فتح، جرّب أحد هذه: ${alts.map(a => `<b>${a}</b>`).join(' • ')}</div>`;
    }
    if (s.values) {
      html += '<div class="wiz-values">';
      s.values.forEach(([k, v]) => html += `<div class="wiz-val"><span>${k}</span><b>${v}</b><button class="wiz-copy" data-copy="${v}">نسخ</button></div>`);
      html += '</div>';
    }
    if (s.hint) html += `<div class="wiz-hint">${s.hint}</div>`;
    html += `<div class="wiz-check"><input type="checkbox" id="wizChk"${s.done ? ' checked' : ''}><label for="wizChk">✓ ${s.check}</label></div></div>`;
    body.innerHTML = html;

    body.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast('📋 نُسخ: ' + b.dataset.copy)).catch(() => {})));
    body.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => window.open(b.dataset.open, '_blank')));
    const chk = $('wizChk');
    if (chk) chk.addEventListener('change', () => s.done = chk.checked);
  },

  renderCompare(body) {
    // خط الأساس صالح فقط إذا احتوى قياس تحميل كامل (لا نكتفي بـ ping وحده)
    const has = this.before && this.before.down != null;
    body.innerHTML = `<div class="wiz-step"><div class="wiz-step-num">🏁</div>
      <h3>قِس الفرق: قبل / بعد</h3>
      <p class="wiz-lead">اضغط لإجراء قياس حقيقي جديد ومقارنته بقياسك قبل الضبط.${has ? '' : ' <b>لا يوجد قياس سابق — سنأخذ قياس «قبل» الآن، ثم طبّق الخطوات وأعد القياس.</b>'}</p>
      <button id="wizRetest" class="wiz-open-btn">📊 قِس الآن</button>
      <div id="wizCmp"></div></div>`;
    $('wizRetest').addEventListener('click', () => this.retest());
  },

  async retest() {
    const btn = $('wizRetest');
    btn.disabled = true;
    btn.textContent = '⏱️ قياس الاستجابة…';
    const p = await pingSample(6);
    btn.textContent = '⬇️ قياس التحميل…';
    const down = await downloadTest();
    btn.textContent = '⬆️ قياس الرفع…';
    const up = await uploadTest();
    btn.textContent = '🌊 قياس الاستقرار…';
    const bb = await bufferbloatTest(() => {});
    const after = { down, up, bloat: bb.bloat, ping: p.avg };
    Home.last.down = down; Home.last.up = up; Home.last.bloat = bb.bloat; Home.last.ping = p;

    // إذا لم يوجد خط أساس كامل (تحميل) — نعتمد هذا القياس كـ «قبل»
    if (!this.before || this.before.down == null) {
      this.before = after;
      $('wizCmp').innerHTML = `<div class="wiz-hint">✅ حُفظ هذا كقياس <b>«قبل»</b> (تحميل ${down} • رفع ${up} Mbps). طبّق خطوات الضبط في راوترك، ثم ارجع هنا واضغط «قِس بعد الضبط» لترى الفرق الحقيقي.</div>`;
      btn.disabled = false; btn.textContent = '📊 قِس بعد الضبط';
      return;
    }

    const bef = this.before;
    const rows = [
      ['⬇️ تحميل', bef.down, after.down, ' Mbps'],
      ['⬆️ رفع', bef.up, after.up, ' Mbps'],
      ['⏱️ Ping', bef.ping, after.ping, ' ms'],
      ['🌊 Bufferbloat', bef.bloat, after.bloat, ' ms']
    ];
    let html = '';
    rows.forEach(([label, b, a, u]) => {
      html += `<div class="wiz-cmp-row"><span>${label}</span><b class="bef">${b != null ? b + u : '—'}</b><i>←</i><b class="aft">${a != null ? a + u : '—'}</b></div>`;
    });
    const dDown = (after.down || 0) - (bef.down || 0);
    const dPing = (bef.ping || 0) - (after.ping || 0);
    const dBloat = (bef.bloat || 0) - (after.bloat || 0);
    const improved = dDown > 2 || dPing > 5 || dBloat > 20;
    const bits = [];
    if (dDown > 2) bits.push(`+${dDown.toFixed(0)} Mbps تحميل`);
    if (dPing > 5) bits.push(`-${dPing.toFixed(0)}ms استجابة`);
    if (dBloat > 20) bits.push(`-${dBloat.toFixed(0)}ms bufferbloat`);
    html += `<div class="wiz-delta ${improved ? 'up' : 'flat'}">${improved ? '🎉 تحسّن! ' + bits.join(' • ') : 'النتائج متقاربة — تأكد أنك طبّقت الخطوات وأعدت تشغيل الراوتر، وأن القياس على نفس الجهاز والمكان.'}</div>`;
    $('wizCmp').innerHTML = html;
    btn.disabled = false; btn.textContent = '📊 إعادة القياس';
  },

  next() {
    if (this.step < this.steps.length - 1) { this.step++; this.render(); }
    else { this.close(); toast('✅ اكتمل الضبط — راوترك الآن مضبوط حسب قياساتك'); }
  },
  prev() { if (this.step > 0) { this.step--; this.render(); } }
};
$('btnOpenWizard').addEventListener('click', () => Wizard.open());
$('btnOpenWizard2').addEventListener('click', () => Wizard.open());
$('wizClose').addEventListener('click', () => Wizard.close());
$('wizNext').addEventListener('click', () => Wizard.next());
$('wizPrev').addEventListener('click', () => Wizard.prev());

/* ============================================================
   الإقلاع
   ============================================================ */
window.addEventListener('online', () => Home.refresh());
window.addEventListener('offline', () => Home.refresh());

(async function boot() {
  Coverage.init();
  await Home.refresh();
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
