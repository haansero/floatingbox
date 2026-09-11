/* global WorkTimer, box */
'use strict';

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const fmtInt = (n) => new Intl.NumberFormat('ko-KR').format(n);
const fmtTokens = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(n));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const AUTO_COLLAPSE_MS = 12_000;

// ---------- 창 높이를 내용에 맞춤 ----------
const ro = new ResizeObserver(() => box.resizeTo(Math.ceil($('box').getBoundingClientRect().height)));
ro.observe($('box'));

// ---------- 시계 ----------
function tickClock() {
  const d = new Date();
  $('clock-time').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  $('clock-sec').textContent = pad(d.getSeconds());
  $('clock-date').innerHTML = `${d.getMonth() + 1}.${d.getDate()}<br>${['일', '월', '화', '수', '목', '금', '토'][d.getDay()]}요일`;
}

// ---------- 타이머 ----------
let timer = WorkTimer.createTimer();
let timerInitialized = false;
let lastSaved = '';

function renderTimer() {
  const el = $('timer');
  const ms = timer.elapsed();
  $('timer-display').textContent = WorkTimer.format(ms);
  el.classList.toggle('running', timer.running);
  const target = timer.targetMs;
  el.classList.toggle('over', target > 0 && ms >= target);
  $('timer-bar').style.width = target > 0 ? Math.min(100, (ms / target) * 100) + '%' : timer.running ? '100%' : '0%';
  if (timer.checkTarget()) {
    box.pushNotification({ title: '작업 시간 목표 도달', body: `${Math.round(target / 60000)}분이 지났습니다.`, source: 'timer', urgency: 'critical' });
  }
  const snap = JSON.stringify(timer.snapshot());
  if (snap !== lastSaved) { lastSaved = snap; box.saveTimer(timer.snapshot()); }
}

// 클릭 = 토글, 600ms 이상 누르면 리셋
(() => {
  const el = $('timer');
  let pressTimer = null;
  let longFired = false;
  const down = (e) => {
    if (e.target.tagName === 'INPUT' || e.button !== 0) return;
    longFired = false;
    el.classList.add('pressing');
    pressTimer = setTimeout(() => {
      longFired = true;
      timer.reset();
      renderTimer();
      el.classList.remove('pressing');
      el.animate([{ opacity: 1 }, { opacity: .3 }, { opacity: 1 }], { duration: 300 });
    }, 600);
  };
  const up = (e) => {
    if (e.target.tagName === 'INPUT') return;
    clearTimeout(pressTimer);
    el.classList.remove('pressing');
    if (!longFired && e.type === 'mouseup') { timer.toggle(); renderTimer(); }
  };
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', up);
})();
$('timer-target').addEventListener('change', (e) => { timer.setTarget(Number(e.target.value) * 60000); renderTimer(); });
$('timer-target').addEventListener('mousedown', (e) => e.stopPropagation());

// ---------- 접기/펼치기 ----------
const collapseTimers = new Map();
function toggleSection(sectionId, detailId, force) {
  const d = $(detailId);
  const open = force !== undefined ? force : d.hidden;
  d.hidden = !open;
  $(sectionId).classList.toggle('open', open);
  clearTimeout(collapseTimers.get(sectionId));
  if (open) collapseTimers.set(sectionId, setTimeout(() => toggleSection(sectionId, detailId, false), AUTO_COLLAPSE_MS));
}
function keepOpen(sectionId, detailId) {
  if ($(detailId).hidden) return;
  clearTimeout(collapseTimers.get(sectionId));
  collapseTimers.set(sectionId, setTimeout(() => toggleSection(sectionId, detailId, false), AUTO_COLLAPSE_MS));
}

// ---------- 사용량 ----------
let usageData = null;
function bar(cls, label, pct, value, sub) {
  const subHtml = sub !== undefined ? `<div class="bar sub" style="width:${Math.min(100, sub)}%"></div>` : '';
  return `<div class="gauge ${cls}" title="${esc(label)} ${esc(value)}"><span class="k">${esc(label)}</span>
    <div class="progress"><div class="bar" style="width:${Math.min(100, pct)}%"></div>${subHtml}</div>
    <span class="v">${esc(value)}</span></div>`;
}
function renderUsage(u) {
  usageData = u;
  const bars = $('usage-bars');
  const detail = $('usage-detail');
  if (!u) return;
  let html = '';
  const rows = [];
  for (const b of u.plan || []) {
    const cls = b.percent >= 95 ? 'bad' : b.percent >= 80 ? 'warn' : '';
    const short = b.key === 'five_hour' ? '세션' : b.key === 'seven_day' ? '주간' : b.label.replace('주간 ', '');
    html += bar(cls, short, b.percent, Math.round(b.percent) + '%');
    rows.push(`<div class="row"><span>${esc(b.label)}</span><b>${Math.round(b.percent)}%${b.resetsAt ? ' · 리셋 ' + relTime(b.resetsAt) : ''}</b></div>`);
  }
  if (!u.plan?.length && u.planError) rows.push(`<div class="error">${esc(u.planError)}</div>`);
  if (u.code) {
    const c = u.code;
    const total = (t) => t.input + t.output + t.cacheRead + t.cacheWrite;
    const week = total(c.week), today = total(c.today);
    const sess = c.latestSession ? total(c.latestSession.totals) : 0;
    // 막대: 7일 총량을 100 으로 두고 오늘(밝은 색)을 겹쳐 표시
    html += bar('tokens', '토큰', week ? 100 : 0, fmtTokens(today), week ? (today / week) * 100 : 0);
    rows.push(`<div class="row"><span>Claude Code 오늘</span><b>${fmtInt(today)}</b></div>`);
    rows.push(`<div class="row"><span>7일</span><b>${fmtInt(week)}</b></div>`);
    rows.push(`<div class="row"><span>현재 세션</span><b>${fmtInt(sess)}</b></div>`);
    rows.push(`<div class="row"><span>7일 출력 / 캐시 읽기</span><b>${fmtTokens(c.week.output)} / ${fmtTokens(c.week.cacheRead)}</b></div>`);
  } else if (u.codeError) rows.push(`<div class="error">${esc(u.codeError)}</div>`);
  if (u.updatedAt) rows.push(`<div class="row"><span>업데이트</span><b>${new Date(u.updatedAt).toLocaleTimeString('ko-KR', { hour12: false })}${u.source ? ' · ' + esc(u.source) : ''}</b></div>`);
  bars.innerHTML = html || `<div class="error">${esc(u.planError || '사용량 없음')}</div>`;
  detail.innerHTML = rows.join('');
}
function relTime(iso) {
  const diff = Date.parse(iso) - Date.now();
  if (!Number.isFinite(diff)) return '';
  const m = Math.round(Math.abs(diff) / 60000);
  const s = m >= 1440 ? `${Math.round(m / 1440)}일` : m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
  return diff > 0 ? `${s} 후` : `${s} 전`;
}
$('usage').addEventListener('click', () => toggleSection('usage', 'usage-detail'));
$('usage').addEventListener('mousemove', () => keepOpen('usage', 'usage-detail'));

// ---------- 알림 ----------
let notifications = [];
let openId = null;

function renderNotifs() {
  const unread = notifications.filter((n) => !n.read).length;
  const badge = $('notif-badge');
  badge.textContent = String(unread);
  badge.classList.toggle('zero', unread === 0);
  const total = notifications.length;
  $('notif-latest').textContent = total === 0 ? '알림 없음' : unread > 0 ? `새 알림 ${unread}개 · 전체 ${total}개` : `알림 ${total}개`;
  $('notif-latest').title = '';

  const list = $('notif-list');
  list.innerHTML = '';
  for (const n of notifications) {
    const li = document.createElement('li');
    li.className = `${n.read ? 'read' : ''} ${n.urgency} ${openId === n.id ? 'open' : ''}`;
    li.innerHTML = `<div class="head"><span class="t">${esc(n.title)}</span><span class="src">${esc(n.source)} ${new Date(n.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}</span><span class="x" title="지우기">×</span></div>
      <div class="b">${esc(n.body)}</div>`;
    li.querySelector('.x').addEventListener('click', (e) => { e.stopPropagation(); box.dismiss(n.id); });
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      openId = openId === n.id ? null : n.id;
      if (!n.read) box.markRead(n.id);
      if (n.url && openId === n.id) box.openUrl(n.url);
      renderNotifs();
      keepOpen('notifs', 'notif-panel');
    });
    list.appendChild(li);
  }
}
$('notif-line').addEventListener('click', () => toggleSection('notifs', 'notif-panel'));
$('notifs').addEventListener('mousemove', () => keepOpen('notifs', 'notif-panel'));
$('notif-readall').addEventListener('click', (e) => { e.stopPropagation(); box.markAllRead(); });
$('notif-clear').addEventListener('click', (e) => { e.stopPropagation(); box.clearNotifications(); openId = null; });

// ---------- 우클릭 메뉴, 상태 ----------
window.addEventListener('contextmenu', (e) => { e.preventDefault(); box.contextMenu(); });

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
  $('box').classList.toggle('pinned', !!s.alwaysSharp);
  $('notif-line').title = `클릭: 알림 목록 · POST http://127.0.0.1:${s.hubPort}/notify · 시스템 알림 ${s.desktopCapture ? 'ON' : 'OFF (' + s.desktopCaptureReason + ')'}`;
});
box.onUsage(renderUsage);
box.onNotification(() => { /* 최신 한 줄이 갱신됨. 펼쳐져 있으면 유지 */ keepOpen('notifs', 'notif-panel'); });

tickClock();
setInterval(tickClock, 250);
setInterval(renderTimer, 500);
renderTimer();
