/* global WorkTimer, box */
'use strict';

const $ = (id) => document.getElementById(id);
const fmtInt = (n) => new Intl.NumberFormat('ko-KR').format(n);
const fmtTokens = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n));

// ---------- Clock ----------
function tickClock() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  $('clock-time').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  $('clock-date').textContent = d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

// ---------- Timer ----------
let timer = WorkTimer.createTimer();
let lastSaved = '';

function renderTimer() {
  const el = $('timer');
  const ms = timer.elapsed();
  $('timer-display').textContent = WorkTimer.format(ms);
  el.classList.toggle('running', timer.running);
  const target = timer.targetMs;
  el.classList.toggle('over', target > 0 && ms >= target);
  $('timer-bar').style.width = target > 0 ? Math.min(100, (ms / target) * 100) + '%' : '0%';
  $('timer-toggle').textContent = timer.running ? '일시정지' : ms > 0 ? '계속' : '시작';
  if (timer.checkTarget()) {
    box.pushNotification({
      title: '작업 시간 목표 도달',
      body: `${Math.round(target / 60000)}분이 지났습니다. 잠깐 쉬어가세요.`,
      source: 'timer',
      urgency: 'critical',
    });
  }
  const snap = JSON.stringify(timer.snapshot());
  if (snap !== lastSaved) {
    lastSaved = snap;
    box.saveTimer(timer.snapshot());
  }
}

$('timer-toggle').addEventListener('click', () => { timer.toggle(); renderTimer(); });
$('timer-reset').addEventListener('click', () => { timer.reset(); renderTimer(); });
$('timer-target').addEventListener('change', (e) => {
  timer.setTarget(Number(e.target.value) * 60000);
  renderTimer();
});

// ---------- Usage ----------
function renderUsage(u) {
  const plan = $('usage-plan');
  const code = $('usage-code');
  const meta = $('usage-meta');
  plan.innerHTML = '';
  code.innerHTML = '';
  if (!u) return;

  if (u.plan && u.plan.length) {
    for (const b of u.plan) {
      const item = document.createElement('div');
      item.className = 'usage-item' + (b.percent >= 95 ? ' bad' : b.percent >= 80 ? ' warn' : '');
      const reset = b.resetsAt ? ` · 리셋 ${relTime(b.resetsAt)}` : '';
      item.innerHTML = `
        <div class="row"><span>${esc(b.label)}<span class="muted">${reset}</span></span><span class="pct">${Math.round(b.percent)}%</span></div>
        <div class="progress"><div class="bar" style="width:${Math.min(100, b.percent)}%"></div></div>`;
      plan.appendChild(item);
    }
  } else if (u.planError) {
    plan.innerHTML = `<div class="error">${esc(u.planError)}</div>`;
  }

  if (u.code) {
    const c = u.code;
    const total = (t) => t.input + t.output + t.cacheRead + t.cacheWrite;
    const sess = c.latestSession ? total(c.latestSession.totals) : 0;
    code.innerHTML = `
      <div class="row" style="margin-top:6px"><span class="label">Claude Code 토큰</span></div>
      <div class="usage-code">
        <div class="cell"><div class="k">현재 세션</div><div class="v" title="${fmtInt(sess)}">${fmtTokens(sess)}</div></div>
        <div class="cell"><div class="k">오늘</div><div class="v" title="${fmtInt(total(c.today))}">${fmtTokens(total(c.today))}</div></div>
        <div class="cell"><div class="k">7일</div><div class="v" title="${fmtInt(total(c.week))}">${fmtTokens(total(c.week))}</div></div>
      </div>
      <div class="muted">출력 ${fmtTokens(c.week.output)} · 캐시 읽기 ${fmtTokens(c.week.cacheRead)} · 메시지 ${fmtInt(c.week.messages)} (7일)</div>`;
  } else if (u.codeError) {
    code.innerHTML = `<div class="error">${esc(u.codeError)}</div>`;
  }
  meta.textContent = u.updatedAt ? `업데이트 ${new Date(u.updatedAt).toLocaleTimeString('ko-KR', { hour12: false })}${u.source ? ' · ' + u.source : ''}` : '';
}

function relTime(iso) {
  const diff = Date.parse(iso) - Date.now();
  if (!Number.isFinite(diff)) return '';
  const m = Math.round(Math.abs(diff) / 60000);
  const s = m >= 60 * 24 ? `${Math.round(m / 1440)}일` : m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
  return diff > 0 ? `${s} 후` : `${s} 전`;
}

$('usage-refresh').addEventListener('click', () => box.refreshUsage());

// ---------- Notifications ----------
let notifications = [];

function renderNotifs() {
  const list = $('notif-list');
  list.innerHTML = '';
  const unread = notifications.filter((n) => !n.read).length;
  const badge = $('notif-badge');
  badge.textContent = String(unread);
  badge.classList.toggle('zero', unread === 0);
  for (const n of notifications) {
    const li = document.createElement('li');
    li.className = `${n.read ? 'read' : ''} ${n.urgency}`;
    li.innerHTML = `
      <div class="head">
        <span class="src">${esc(n.source)} · <span class="when">${new Date(n.ts).toLocaleTimeString('ko-KR', { hour12: false })}</span></span>
        <span class="x" title="지우기">×</span>
      </div>
      <div class="t">${esc(n.title)}</div>
      ${n.body ? `<div class="b">${esc(n.body)}</div>` : ''}`;
    li.querySelector('.x').addEventListener('click', (e) => { e.stopPropagation(); box.dismiss(n.id); });
    li.addEventListener('click', () => {
      if (!n.read) box.markRead(n.id);
      if (n.url) box.openUrl(n.url);
    });
    list.appendChild(li);
  }
}

$('notif-readall').addEventListener('click', () => box.markAllRead());
$('notif-clear').addEventListener('click', () => box.clearNotifications());

let toastTimer = null;
function toast(n) {
  const t = $('toast');
  t.textContent = `${n.title}${n.body ? ' — ' + n.body : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Wiring ----------
$('btn-hide').addEventListener('click', () => box.hide());
$('btn-quit').addEventListener('click', () => box.quit());

box.onState((s) => {
  notifications = s.notifications || [];
  renderNotifs();
  renderUsage(s.usage);
  if (s.timer && !timerInitialized) {
    timer = WorkTimer.createTimer(s.timer);
    $('timer-target').value = Math.round((s.timer.targetMs || 0) / 60000);
    timerInitialized = true;
    renderTimer();
  }
  const hint = [];
  hint.push(`POST http://127.0.0.1:${s.hubPort}/notify`);
  if (s.platform === 'linux') hint.push(s.desktopCapture ? '데스크톱 알림 가로채기 ON' : `데스크톱 가로채기 OFF (${s.desktopCaptureReason})`);
  $('notif-hint').textContent = hint.join(' · ');
});
box.onUsage(renderUsage);
box.onNotification((n) => toast(n));

let timerInitialized = false;
tickClock();
setInterval(tickClock, 250);
setInterval(renderTimer, 500);
renderTimer();
