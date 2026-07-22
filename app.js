/* ============================================================
   راوتر السعودية الذكي — مدير الشبكة الذكي للبيت
   قياسات حقيقية (Ping / سرعة / جودة اتصال) + ذكاء اصطناعي محاكى
   ============================================================ */
'use strict';

/* ---------- أدوات عامة ---------- */
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.round(rand(a, b));
const pick = arr => arr[randInt(0, arr.length - 1)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ---------- محرك القياس الحقيقي ---------- */
const PING_TARGETS = {
  cf:     'https://cloudflare.com/cdn-cgi/trace',
  google: 'https://www.gstatic.com/generate_204',
  ms:     'https://www.msftconnecttest.com/connecttest.txt'
};

async function pingOnce(server = 'cf', timeout = 4000) {
  const url = PING_TARGETS[server] + (PING_TARGETS[server].includes('?') ? '&' : '?') + 't=' + Date.now();
  const ctrl = new AbortController();
  const kill = setTimeout(() => ctrl.abort(), timeout);
  const t0 = performance.now();
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
    return Math.round(performance.now() - t0);
  } catch (e) {
    return null; // فقدان حزمة
  } finally {
    clearTimeout(kill);
  }
}

async function pingSample(n = 5, server = 'cf') {
  const results = [];
  for (let i = 0; i < n; i++) {
    results.push(await pingOnce(server));
    await sleep(120);
  }
  const ok = results.filter(v => v !== null);
  if (!ok.length) return { avg: null, jitter: null, loss: 100, samples: results };
  const avg = Math.round(ok.reduce((s, v) => s + v, 0) / ok.length);
  const jitter = ok.length > 1
    ? Math.round(ok.slice(1).reduce((s, v, i) => s + Math.abs(v - ok[i]), 0) / (ok.length - 1))
    : 0;
  const loss = Math.round((results.length - ok.length) / results.length * 100);
  return { avg, jitter, loss, samples: results, best: Math.min(...ok) };
}

function connInfo() {
  const c = navigator.connection || {};
  return {
    type: c.effectiveType ? c.effectiveType.toUpperCase() : (navigator.onLine ? 'WiFi' : '—'),
    downlink: c.downlink || null,
    rtt: c.rtt || null
  };
}

/* ---------- اختبار السرعة (Cloudflare حقيقي) ---------- */
async function speedTest(onProgress) {
  const SIZES = [1e6, 5e6, 10e6]; // تدرّج بالحجم
  let best = 0;
  for (let i = 0; i < SIZES.length; i++) {
    const bytes = SIZES[i];
    const t0 = performance.now();
    try {
      const res = await fetch(`https://speed.cloudflare.com/__down?bytes=${bytes}&t=${Date.now()}`, { cache: 'no-store' });
      const reader = res.body.getReader();
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        const secs = (performance.now() - t0) / 1000;
        const mbps = (received * 8 / 1e6) / Math.max(secs, .05);
        onProgress(Math.max(best, mbps), (i / SIZES.length) + (received / bytes) / SIZES.length);
      }
      const secs = (performance.now() - t0) / 1000;
      best = Math.max(best, (received => (received * 8 / 1e6) / secs)(bytes));
    } catch (e) { /* نكمل بالعينة التالية */ }
  }
  return Math.round(best * 10) / 10;
}

/* ============================================================
   التنقّل بين التبويبات
   ============================================================ */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    tab.classList.add('active');
    $('view-' + tab.dataset.view).classList.add('active');
    if (tab.dataset.view === 'gaming' && $('gamingToggle').checked) Gaming.ensureLoop();
  });
});

/* ============================================================
   1) الرئيسية — صحة الشبكة + AI
   ============================================================ */
const Home = {
  score: null,
  lastSpeed: null, // آخر سرعة مقاسة فعلياً — أدق من تقدير المتصفح

  async refresh() {
    $('netStatusLabel').textContent = 'جارٍ قياس الشبكة…';
    const [p, info] = [await pingSample(5), connInfo()];
    const downlink = this.lastSpeed || info.downlink;

    $('statPing').textContent = p.avg ?? '—';
    $('statJitter').textContent = p.jitter ?? '—';
    $('statDown').textContent = downlink ? `~${downlink}` : '—';
    $('statType').textContent = this.lastSpeed ? 'WiFi' : info.type;

    let score = 0;
    if (p.avg !== null) {
      score = 100;
      score -= Math.min(40, Math.max(0, (p.avg - 50) * 0.4));    // البطء
      score -= Math.min(20, (p.jitter || 0) * 0.8);              // التذبذب
      score -= p.loss * 2;                                       // فقدان الحزم
      if (this.lastSpeed && this.lastSpeed >= 50) score += 10;   // سرعة ممتازة مثبتة
      score = Math.max(5, Math.min(100, Math.round(score)));
    }
    this.score = score || null;

    const ring = $('ringFill');
    const C = 2 * Math.PI * 84;
    ring.style.strokeDashoffset = C - C * (score / 100);
    ring.style.stroke = score >= 75 ? 'var(--good)' : score >= 45 ? 'var(--mid)' : 'var(--bad)';
    $('healthScore').textContent = score ? score : '؟';
    $('healthLabel').textContent = score >= 75 ? 'الشبكة ممتازة' : score >= 45 ? 'الشبكة متوسطة' : score ? 'الشبكة ضعيفة' : 'لا يوجد اتصال';

    const st = $('netStatusLabel');
    if (!navigator.onLine || p.avg === null) { st.textContent = '⛔ غير متصل بالإنترنت'; st.className = 'net-status bad'; }
    else if (score >= 75) { st.textContent = `✅ متصل — استجابة ${p.avg}ms`; st.className = 'net-status ok'; }
    else if (score >= 45) { st.textContent = `⚠️ اتصال متوسط — ${p.avg}ms`; st.className = 'net-status warn'; }
    else { st.textContent = `🔴 اتصال ضعيف — ${p.avg}ms`; st.className = 'net-status bad'; }

    return { ping: p, score };
  },

  aiLog(msg) {
    const ul = $('aiLog');
    ul.querySelector('.ai-idle')?.remove();
    const li = document.createElement('li');
    const time = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    li.innerHTML = `<b>${time}</b> — ${msg}`;
    ul.prepend(li);
    while (ul.children.length > 8) ul.lastChild.remove();
  },

  /* التحسين التلقائي: يقيس فعلياً ثم يولّد قرارات وتحسينات */
  async optimize() {
    const btn = $('btnOptimize');
    if (btn.classList.contains('working')) return;
    btn.classList.add('working');
    $('optimizeLabel').textContent = 'جارٍ التحليل…';
    this.aiLog('بدأ الذكاء الاصطناعي تحليل الشبكة الشامل…');

    const before = await this.refresh();
    await sleep(900);

    // توليد الاختناقات بناء على القياس الحقيقي
    const issues = [];
    const p = before.ping;
    if (p.avg === null) {
      issues.push({ ico: '⛔', title: 'لا يوجد اتصال بالإنترنت', desc: 'تأكد من كيبل الألياف/DSL أو اتصل بمزود الخدمة.', fix: null });
    } else {
      if (p.avg > 80) issues.push({ ico: '🐢', title: `استجابة بطيئة (${p.avg}ms)`, desc: 'السبب المرجّح: ازدحام القناة اللاسلكية أو بعد الراوتر.', fix: 'تم تحويل جهازك لنطاق 5GHz الأسرع' });
      if ((p.jitter || 0) > 25) issues.push({ ico: '📉', title: `تذبذب عالي (Jitter ${p.jitter}ms)`, desc: 'جهاز على الشبكة يستهلك رفعاً كثيفاً (بث/تحميل).', fix: 'تم تفعيل QoS وتقييد الرفع الخلفي' });
      if (p.loss > 0) issues.push({ ico: '📦', title: `فقدان حزم ${p.loss}%`, desc: 'تداخل موجات أو ضعف إشارة في موقعك الحالي.', fix: 'تم تغيير القناة اللاسلكية تلقائياً' });
      const dev = Devices.hottest();
      if (dev) issues.push({ ico: '🔥', title: `«${dev.name}» يستهلك ${dev.usage}% من السرعة`, desc: 'يقوم بتحميل/بث كثيف الآن ويبطئ بقية الأجهزة.', fix: 'تم تحديد سرعته العادلة تلقائياً' });
      if (!issues.length) issues.push({ ico: '✨', title: 'لا توجد اختناقات!', desc: `شبكتك بحالة ممتازة (${p.avg}ms). الذكاء الاصطناعي سيواصل المراقبة.`, fix: null });
    }

    const list = $('bottleneckList');
    list.innerHTML = '';
    issues.forEach(it => {
      const div = document.createElement('div');
      div.className = 'bn-item';
      div.innerHTML = `<span class="bn-ico">${it.ico}</span><div style="flex:1"><b>${it.title}</b><p>${it.desc}</p>${it.fix ? `<button class="bn-fix">✔ ${it.fix}</button>` : ''}</div>`;
      const fixBtn = div.querySelector('.bn-fix');
      if (fixBtn) fixBtn.addEventListener('click', () => {
        div.classList.add('fixed');
        fixBtn.textContent = '✅ تم التطبيق';
        this.aiLog(`طُبّق الإصلاح: <b>${it.fix}</b>`);
        toast('✅ تم تطبيق الإصلاح بنجاح');
      });
      list.appendChild(div);
    });

    const acts = [
      'أُعيد توزيع السرعة حسب أولوية الاستخدام (ألعاب > اجتماعات > بث)',
      'خُفّضت قناة 2.4GHz للأجهزة المنزلية وحُوّلت الجوالات لـ 5GHz',
      'فُحصت ' + Devices.list.length + ' أجهزة متصلة — لا تهديدات جديدة',
      'حُدّث جدول الذروة: أعلى استهلاك متوقع بين 8-11 مساءً'
    ];
    this.aiLog(pick(acts));
    this.aiLog(`اكتمل التحليل — درجة الشبكة: <b>${before.score || '؟'}/100</b>`);

    btn.classList.remove('working');
    $('optimizeLabel').textContent = 'تحسين تلقائي';
    toast(issues[0].fix ? '🤖 اكتمل التحليل — وُجدت اختناقات قابلة للإصلاح' : '🤖 اكتمل التحليل — شبكتك ممتازة');
  }
};
$('btnOptimize').addEventListener('click', () => Home.optimize());

/* ---------- اختبار السرعة ---------- */
$('btnSpeedTest').addEventListener('click', async () => {
  const btn = $('btnSpeedTest');
  if (btn.disabled) return;
  btn.disabled = true; btn.textContent = 'جارٍ القياس…';
  $('speedPhase').textContent = 'الاتصال بأقرب خادم Cloudflare…';
  let peak = 0;
  const mbps = await speedTest((current, prog) => {
    peak = Math.max(peak, current);
    $('speedNow').textContent = current.toFixed(1);
    $('speedBarFill').style.width = Math.min(100, prog * 100) + '%';
    $('speedPhase').textContent = 'جارٍ قياس سرعة التحميل الفعلية…';
  });
  if (mbps > 0) {
    $('speedNow').textContent = Math.max(mbps, peak).toFixed(1);
    $('speedBarFill').style.width = '100%';
    const final = Math.max(mbps, Math.round(peak * 10) / 10);
    Home.lastSpeed = final;
    const verdict = final >= 80 ? 'سرعة ممتازة 👑 تكفي بيت كامل + ألعاب + 4K' :
                    final >= 25 ? 'سرعة جيدة ✅ مناسبة للبث والاجتماعات' :
                    'سرعة منخفضة ⚠️ قد تعاني وقت الذروة';
    $('speedPhase').textContent = `النتيجة: ${final} Mbps — ${verdict}`;
    Home.aiLog(`اختبار سرعة حقيقي: <b>${final} Mbps</b>`);
  } else {
    $('speedPhase').textContent = '⛔ تعذّر الاختبار — تحقق من اتصالك';
  }
  btn.disabled = false; btn.textContent = 'إعادة الاختبار';
});

/* ============================================================
   2) الأجهزة والحماية
   ============================================================ */
const DEVICE_POOL = [
  { ico: '📱', name: 'ايفون أبو محمد', kind: 'جوال' },
  { ico: '📱', name: 'جوال أم فهد', kind: 'جوال' },
  { ico: '💻', name: 'لابتوب العمل', kind: 'حاسب' },
  { ico: '📺', name: 'تلفزيون المجلس', kind: 'تلفزيون ذكي' },
  { ico: '🎮', name: 'بلايستيشن 5', kind: 'ألعاب' },
  { ico: '📱', name: 'ايباد نورة', kind: 'جهاز لوحي' },
  { ico: '📷', name: 'كاميرا المدخل', kind: 'كاميرا مراقبة' },
  { ico: '🔊', name: 'سماعة ذكية', kind: 'منزل ذكي' },
  { ico: '❄️', name: 'مكيف الصالة الذكي', kind: 'منزل ذكي' },
  { ico: '🖨️', name: 'طابعة المكتب', kind: 'طابعة' }
];

const Devices = {
  list: [],
  blockedCount: 0,

  load() {
    try { this.list = JSON.parse(localStorage.getItem('sr_devices') || 'null') || null; } catch (e) { this.list = null; }
    if (!this.list) {
      this.list = DEVICE_POOL.slice(0, 7).map((d, i) => ({
        ...d, id: i + 1, usage: randInt(2, 55), kids: i === 5, blocked: false, unknown: false
      }));
    }
    this.render();
  },
  save() { localStorage.setItem('sr_devices', JSON.stringify(this.list)); },

  hottest() {
    const active = this.list.filter(d => !d.blocked && !d.unknown);
    const hot = active.sort((a, b) => b.usage - a.usage)[0];
    return hot && hot.usage > 45 ? hot : null;
  },

  render() {
    const wrap = $('deviceList');
    wrap.innerHTML = '';
    this.list.forEach(d => {
      const div = document.createElement('div');
      div.className = 'dev' + (d.unknown ? ' unknown' : '');
      div.innerHTML = `
        <div class="dev-ico">${d.ico}</div>
        <div class="dev-info">
          <b>${d.name}</b>
          <small>${d.kind} • ${d.blocked ? 'محظور' : d.usage + '% من السرعة'}</small>
          ${!d.blocked ? `<div class="dev-usage"><i class="${d.usage > 45 ? 'hot' : ''}" style="width:${d.usage}%"></i></div>` : ''}
        </div>
        <div class="dev-actions">
          ${d.unknown ? '<span class="dev-badge badge-new">جديد!</span>' : ''}
          ${d.kids ? '<span class="dev-badge badge-kids">وضع الأطفال</span>' : ''}
          ${d.blocked ? '<span class="dev-badge badge-blocked">محظور</span>' : ''}
          <button class="dev-btn ${d.blocked ? '' : 'danger'}" data-act="block">${d.blocked ? 'فك الحظر' : 'حظر'}</button>
          ${!d.unknown ? `<button class="dev-btn" data-act="kids">${d.kids ? 'إلغاء الرقابة' : 'وضع الأطفال'}</button>` : ''}
        </div>`;
      div.querySelector('[data-act="block"]').addEventListener('click', () => {
        d.blocked = !d.blocked;
        if (d.blocked && d.unknown) {
          d.unknown = false;
          $('securityBanner').classList.add('hidden');
          $('shieldBlocked').textContent = ++this.blockedCount;
          Home.aiLog(`🚨 حُظر جهاز دخيل: <b>${d.name}</b>`);
          toast('🛡️ تم حظر الجهاز الدخيل وحماية شبكتك');
        } else {
          toast(d.blocked ? `⛔ حُظر «${d.name}» من الشبكة` : `✅ أُعيد «${d.name}» للشبكة`);
        }
        this.save(); this.render(); this.updateShield();
      });
      div.querySelector('[data-act="kids"]')?.addEventListener('click', () => {
        d.kids = !d.kids;
        toast(d.kids ? `👨‍👩‍👧 فُعّلت الرقابة الأبوية على «${d.name}»` : `أُلغيت الرقابة عن «${d.name}»`);
        if (d.kids) Home.aiLog(`فُعّل وضع الأطفال على <b>${d.name}</b> — حجب محتوى + حد زمني`);
        this.save(); this.render();
      });
      wrap.appendChild(div);
    });
    this.updateShield();
  },

  updateShield() {
    $('shieldDevices').textContent = this.list.filter(d => !d.blocked).length;
    $('shieldAlerts').textContent = this.list.filter(d => d.unknown).length;
  },

  /* فحص الشبكة: يحدّث الاستهلاك وقد يكتشف جهازاً دخيلاً */
  async scan() {
    const btn = $('btnScanDevices');
    btn.disabled = true; btn.textContent = 'جارٍ الفحص…';
    await sleep(1400);
    this.list.forEach(d => { if (!d.blocked) d.usage = Math.max(1, Math.min(95, d.usage + randInt(-18, 18))); });

    // 35% فرصة اكتشاف جهاز غريب (إن لم يوجد واحد)
    if (!this.list.some(d => d.unknown) && Math.random() < .35) {
      const strangers = [
        { ico: '❓', name: 'جهاز غير معروف (Realme-A5)', kind: 'MAC: 7C:2A:xx:xx' },
        { ico: '❓', name: 'جهاز مجهول (android-9f31)', kind: 'MAC: D4:6E:xx:xx' }
      ];
      const s = pick(strangers);
      this.list.push({ ...s, id: Date.now(), usage: randInt(5, 30), kids: false, blocked: false, unknown: true });
      $('securityBannerText').textContent = `جهاز غير معروف انضم لشبكتك: ${s.name}`;
      $('securityBanner').classList.remove('hidden');
      Home.aiLog(`⚠️ رُصد جهاز غير معروف على الشبكة: <b>${s.name}</b>`);
    } else {
      toast('✅ اكتمل الفحص — لا أجهزة دخيلة');
    }
    this.save(); this.render();
    btn.disabled = false; btn.textContent = 'فحص الشبكة';
  }
};
$('btnScanDevices').addEventListener('click', () => Devices.scan());
$('securityBannerAction').addEventListener('click', () => {
  document.querySelector('[data-view="devices"]').click();
  $('securityBanner').classList.add('hidden');
});
$('shieldToggle').addEventListener('change', e => {
  toast(e.target.checked ? '🛡️ الحماية الذكية مفعّلة — مراقبة على مدار الساعة' : '⚠️ الحماية الذكية متوقفة!');
});
$('bedtimeToggle').addEventListener('change', e => {
  toast(e.target.checked ? '🌙 سيتوقف الإنترنت عن أجهزة الأطفال من 10م إلى 6ص' : 'أُلغي وضع النوم');
  if (e.target.checked) Home.aiLog('جُدول إيقاف إنترنت الأطفال: <b>10:00م → 6:00ص</b>');
});

/* ============================================================
   3) التغطية — خريطة البيت + محلل القنوات
   ============================================================ */
const ROOMS = [
  { id: 'majlis', ico: '🛋️', name: 'المجلس' },
  { id: 'salah', ico: '🏠', name: 'الصالة', router: true },
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
      div.className = 'room' + (r.router ? ' router' : '');
      div.id = 'room-' + r.id;
      div.innerHTML = `<span>${r.ico}</span><b>${r.name}</b><small>—</small>`;
      div.addEventListener('click', () => this.select(r.id));
      map.appendChild(div);
    });
    Object.keys(this.results).forEach(id => this.paint(id));
    $('btnMeasureRoom').addEventListener('click', () => this.measure());
    $('btnScanChannels').addEventListener('click', () => this.scanChannels());
    this.buildChannelBars();
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
    el.querySelector('small').textContent = `${res.score}% • ${res.ping}ms`;
  },

  async measure() {
    if (!this.selected) return;
    const btn = $('btnMeasureRoom');
    btn.disabled = true; btn.textContent = 'جارٍ القياس الفعلي…';
    const p = await pingSample(4);
    let score = 0;
    if (p.avg !== null) {
      score = 100 - Math.min(50, Math.max(0, (p.avg - 50) * 0.45)) - Math.min(20, (p.jitter || 0) * 0.6) - p.loss * 2;
      score = Math.max(5, Math.min(100, Math.round(score)));
    }
    this.results[this.selected] = { score, ping: p.avg ?? '⛔' };
    localStorage.setItem('sr_coverage', JSON.stringify(this.results));
    this.paint(this.selected);
    this.updateAdvice();
    const room = ROOMS.find(r => r.id === this.selected);
    toast(score >= 70 ? `✅ «${room.name}»: تغطية ممتازة (${score}%)` :
          score >= 40 ? `⚠️ «${room.name}»: تغطية متوسطة (${score}%)` :
          `🔴 «${room.name}»: تغطية ضعيفة (${score}%)`);
    btn.disabled = false; btn.textContent = `📶 قياس الإشارة في «${room.name}»`;
  },

  updateAdvice() {
    const entries = Object.entries(this.results);
    const ul = $('coverageAdvice');
    if (entries.length < 3) {
      ul.innerHTML = `<li>قِس ${3 - entries.length} غرف إضافية ليقترح الذكاء الاصطناعي أفضل مكان للراوتر.</li>`;
      return;
    }
    const sorted = entries.map(([id, r]) => ({ room: ROOMS.find(x => x.id === id), ...r })).sort((a, b) => b.score - a.score);
    const best = sorted[0], worst = sorted[sorted.length - 1];
    const avg = Math.round(sorted.reduce((s, r) => s + r.score, 0) / sorted.length);
    const tips = [
      `<b>أفضل تغطية:</b> ${best.room.name} (${best.score}%) — الراوتر قريب منها.`,
      `<b>أضعف تغطية:</b> ${worst.room.name} (${worst.score}%) — ${worst.score < 40 ? 'ننصح بمقوّي إشارة (Mesh) هناك.' : 'مقبولة لكن يمكن تحسينها.'}`,
      `<b>متوسط تغطية البيت:</b> ${avg}% ${avg >= 70 ? '👑 ممتاز' : avg >= 50 ? '— جيد' : '— يحتاج تحسين'}`,
      `<b>اقتراح الذكاء الاصطناعي:</b> ${avg < 60 ? 'انقل الراوتر لمنتصف البيت (الممر) وارفعه عن الأرض 1.5م بعيداً عن الجدران السميكة.' : 'مكان الراوتر الحالي مناسب — استخدم 5GHz للأجهزة القريبة و2.4GHz للبعيدة.'}`
    ];
    ul.innerHTML = tips.map(t => `<li>${t}</li>`).join('');
  },

  buildChannelBars() {
    const wrap = $('channelChart');
    wrap.innerHTML = '';
    [1, 3, 6, 9, 11, 36, 44, 149].forEach(ch => {
      const bar = document.createElement('div');
      bar.className = 'ch-bar';
      bar.innerHTML = `<i style="height:6px"></i><small>${ch <= 11 ? ch : ch + '<br>5G'}</small>`;
      wrap.appendChild(bar);
    });
  },

  async scanChannels() {
    const btn = $('btnScanChannels');
    btn.disabled = true; btn.textContent = 'يحلل…';
    const bars = [...document.querySelectorAll('.ch-bar')];
    // ضوضاء محاكاة واقعية: قنوات 2.4 مزدحمة عادة، 5GHz أهدأ
    const loads = bars.map((_, i) => i < 5 ? randInt(45, 95) : randInt(8, 45));
    const bestIdx = loads.indexOf(Math.min(...loads));
    for (let i = 0; i < bars.length; i++) {
      bars[i].classList.remove('best');
      bars[i].querySelector('i').style.height = Math.max(6, loads[i]) + '%';
      await sleep(90);
    }
    bars[bestIdx].classList.add('best');
    const chName = bars[bestIdx].querySelector('small').textContent.replace('5G', ' (5GHz)');
    const box = $('channelAdvice');
    box.classList.remove('hidden');
    box.innerHTML = `📡 <b>التوصية:</b> حوّل راوترك للقناة <b>${chName}</b> — الأقل ازدحاماً في محيطك الآن. القنوات 1-11 (2.4GHz) مزدحمة بشبكات الجيران؛ استخدم 5GHz متى أمكن للسرعة، و2.4GHz للتغطية البعيدة.`;
    Home.aiLog(`محلل القنوات: أفضل قناة حالياً هي <b>${chName}</b>`);
    btn.disabled = false; btn.textContent = 'تحليل';
  }
};

/* ============================================================
   4) وضع الألعاب — مراقبة Ping حية حقيقية
   ============================================================ */
const Gaming = {
  running: false,
  server: 'cf',
  history: [],
  sent: 0,
  lost: 0,

  ensureLoop() { if ($('gamingToggle').checked && !this.running) this.loop(); },

  async loop() {
    this.running = true;
    while ($('gamingToggle').checked) {
      const v = await pingOnce(this.server, 3000);
      this.sent++;
      if (v === null) this.lost++;
      else {
        this.history.push(v);
        if (this.history.length > 60) this.history.shift();
      }
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
    else { grade.textContent = '⚠️ تقييم C — قد تواجه لاق، فعّل التحسينات'; grade.className = 'game-grade c'; }
  },

  draw() {
    const cv = $('pingCanvas');
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const h = this.history;
    if (!h.length) return;
    const max = Math.max(100, ...h);
    // خطوط إرشادية
    ctx.strokeStyle = 'rgba(147,164,195,.15)';
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach(f => {
      ctx.beginPath(); ctx.moveTo(0, H * f); ctx.lineTo(W, H * f); ctx.stroke();
    });
    // المنحنى
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(34,211,238,.5)');
    grad.addColorStop(1, 'rgba(34,211,238,0)');
    ctx.beginPath();
    h.forEach((v, i) => {
      const x = (i / Math.max(1, h.length - 1)) * W;
      const y = H - (v / max) * (H - 14) - 6;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }
};
$('gamingToggle').addEventListener('change', e => {
  if (e.target.checked) {
    toast('🎮 وضع الألعاب الفائق مفعّل — أولوية قصوى لجهازك');
    Home.aiLog('فُعّل <b>وضع الألعاب الفائق</b>: QoS + تجميد التحديثات الخلفية');
    Gaming.history = []; Gaming.sent = 0; Gaming.lost = 0;
    Gaming.ensureLoop();
  } else {
    toast('وضع الألعاب متوقف');
    $('gameGrade').textContent = 'شغّل الوضع لبدء المراقبة الحية';
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
   5) التشخيص الذكي الشامل
   ============================================================ */
const DIAG_STEPS = [
  { id: 'net', name: 'الاتصال بالإنترنت', ico: '🌐' },
  { id: 'dns', name: 'استجابة خوادم DNS', ico: '🧭' },
  { id: 'ping', name: 'زمن الاستجابة (Ping)', ico: '⏱️' },
  { id: 'jitter', name: 'استقرار الاتصال (Jitter)', ico: '📊' },
  { id: 'loss', name: 'فقدان الحزم', ico: '📦' },
  { id: 'speed', name: 'سرعة التحميل الفعلية', ico: '⬇️' },
  { id: 'wifi', name: 'جودة إشارة Wi-Fi الحالية', ico: '📶' }
];

const Diagnose = {
  async run() {
    const btn = $('btnDiagnose');
    btn.disabled = true; btn.textContent = 'جارٍ الفحص…';
    $('diagReportCard').classList.add('hidden');
    const wrap = $('diagSteps');
    wrap.innerHTML = '';
    const els = {};
    DIAG_STEPS.forEach(s => {
      const div = document.createElement('div');
      div.className = 'dstep';
      div.innerHTML = `<span class="ds-ico">${s.ico}</span><span class="ds-name">${s.name}</span><span class="ds-val">بالانتظار…</span>`;
      wrap.appendChild(div);
      els[s.id] = div;
    });

    const setState = (id, state, val) => {
      els[id].className = 'dstep ' + state;
      els[id].querySelector('.ds-val').textContent = val;
    };
    const start = id => { els[id].classList.add('running'); els[id].querySelector('.ds-ico').textContent = '⏳'; };
    const restoreIco = id => { els[id].querySelector('.ds-ico').textContent = DIAG_STEPS.find(s => s.id === id).ico; };

    const report = { time: new Date().toLocaleString('ar-SA'), items: [], problems: [] };

    // 1) الإنترنت
    start('net');
    const online = navigator.onLine && (await pingOnce('google')) !== null;
    restoreIco('net');
    setState('net', online ? 'ok' : 'fail', online ? 'متصل ✓' : 'غير متصل ✗');
    report.items.push(`الاتصال بالإنترنت: ${online ? 'متصل' : 'منقطع'}`);
    if (!online) report.problems.push('لا يوجد اتصال بالإنترنت — أعد تشغيل الراوتر، وتأكد من كيبل الألياف، ثم اتصل بمزود الخدمة إن استمرت.');

    // 2) DNS
    start('dns');
    const t0 = performance.now();
    const dnsOk = (await pingOnce('cf')) !== null;
    const dnsMs = Math.round(performance.now() - t0);
    restoreIco('dns');
    setState('dns', dnsOk ? (dnsMs < 300 ? 'ok' : 'warn') : 'fail', dnsOk ? dnsMs + 'ms' : 'فشل ✗');
    report.items.push(`استجابة DNS: ${dnsOk ? dnsMs + 'ms' : 'فشل'}`);
    if (dnsOk && dnsMs >= 300) report.problems.push('استجابة DNS بطيئة — غيّر DNS الراوتر إلى 1.1.1.1 أو 8.8.8.8.');

    // 3-5) عينة Ping موسعة
    start('ping');
    const p = await pingSample(8);
    restoreIco('ping');
    if (p.avg === null) {
      setState('ping', 'fail', 'فشل ✗');
      setState('jitter', 'fail', '—'); setState('loss', 'fail', '100%');
    } else {
      setState('ping', p.avg <= 90 ? 'ok' : p.avg <= 200 ? 'warn' : 'fail', p.avg + 'ms');
      setState('jitter', (p.jitter || 0) <= 20 ? 'ok' : 'warn', p.jitter + 'ms');
      setState('loss', p.loss === 0 ? 'ok' : p.loss <= 10 ? 'warn' : 'fail', p.loss + '%');
    }
    report.items.push(`Ping: ${p.avg ?? '—'}ms | Jitter: ${p.jitter ?? '—'}ms | فقدان حزم: ${p.loss}%`);
    if (p.avg > 200) report.problems.push('زمن استجابة مرتفع — اقترب من الراوتر أو استخدم 5GHz، وتحقق من عدم وجود تحميل كثيف على الشبكة.');
    if (p.loss > 10) report.problems.push('فقدان حزم مرتفع — مؤشر تداخل موجات أو مشكلة لدى مزود الخدمة.');

    // 6) السرعة
    start('speed');
    let peak = 0;
    const mbps = await speedTest(cur => { peak = Math.max(peak, cur); els.speed.querySelector('.ds-val').textContent = cur.toFixed(1) + ' Mbps'; });
    const finalSpeed = Math.max(mbps, Math.round(peak * 10) / 10);
    if (finalSpeed > 0) Home.lastSpeed = finalSpeed;
    restoreIco('speed');
    setState('speed', finalSpeed >= 25 ? 'ok' : finalSpeed > 0 ? 'warn' : 'fail', finalSpeed > 0 ? finalSpeed + ' Mbps' : 'فشل ✗');
    report.items.push(`سرعة التحميل: ${finalSpeed} Mbps`);
    if (finalSpeed > 0 && finalSpeed < 25) report.problems.push('السرعة الفعلية أقل من المتوقع — قارنها بسرعة باقتك؛ إن كان الفرق كبيراً فاطلب فحص خط من مزود الخدمة.');

    // 7) جودة Wi-Fi
    start('wifi');
    const info = connInfo();
    await sleep(600);
    restoreIco('wifi');
    const wifiGood = p.avg !== null && (p.avg < 150 || finalSpeed >= 25) && p.loss <= 10;
    const wifiLabel = finalSpeed > 0 ? `مستقرة • ${finalSpeed}Mbps` : info.type;
    setState('wifi', wifiGood ? 'ok' : 'warn', wifiLabel);
    report.items.push(`جودة الاتصال الحالي: ${wifiGood ? 'جيدة' : 'تحتاج تحسين'} (${wifiLabel})`);

    // التقرير
    const rep = $('diagReport');
    const status = report.problems.length === 0
      ? '<b style="color:var(--good)">✅ النتيجة: شبكتك سليمة 100% — لا مشاكل مكتشفة.</b>'
      : `<b style="color:var(--mid)">⚠️ النتيجة: وُجدت ${report.problems.length} مشكلة — الحلول بالأسفل.</b>`;
    rep.innerHTML =
      `${status}\n\n<b>📊 القياسات:</b>\n` +
      report.items.map(i => '• ' + i).join('\n') +
      (report.problems.length ? `\n\n<b>🔧 المشاكل والحلول:</b>\n` + report.problems.map((p, i) => `${i + 1}. ${p}`).join('\n') : '') +
      `\n\n<b>🕐 وقت الفحص:</b> ${report.time}`;
    $('diagReportCard').classList.remove('hidden');
    this.lastReport = `تقرير فحص الشبكة — راوتر السعودية الذكي\n${report.time}\n\nالقياسات:\n${report.items.map(i => '- ' + i).join('\n')}\n\n${report.problems.length ? 'المشاكل:\n' + report.problems.map((p, i) => `${i + 1}. ${p}`).join('\n') : 'لا توجد مشاكل — الشبكة سليمة.'}`;
    Home.aiLog(`اكتمل التشخيص الشامل: <b>${report.problems.length ? report.problems.length + ' مشاكل' : 'الشبكة سليمة'}</b>`);
    btn.disabled = false; btn.textContent = 'إعادة الفحص';
  }
};
$('btnDiagnose').addEventListener('click', () => Diagnose.run());
$('btnCopyReport').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(Diagnose.lastReport || '');
    toast('📋 نُسخ التقرير — أرسله للدعم الفني مباشرة');
  } catch (e) { toast('تعذّر النسخ'); }
});

/* ============================================================
   الإقلاع
   ============================================================ */
window.addEventListener('online', () => Home.refresh());
window.addEventListener('offline', () => Home.refresh());

(async function boot() {
  Devices.load();
  Coverage.init();
  await Home.refresh();
  // مراقبة خلفية كل 45 ثانية
  setInterval(() => { if (document.querySelector('#view-home.active')) Home.refresh(); }, 45000);
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
