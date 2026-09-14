'use strict';

/* ==========================================================================
   ShiftPulse — app.js
   Vanilla JS, no build step. LocalStorage-backed PWA for shift tracking.
   ========================================================================== */

/* ---------------------------------------------------------------------- */
/* Constants & storage keys                                               */
/* ---------------------------------------------------------------------- */
const LS_SHIFTS = 'shiftpulse:shifts:v1';
const LS_SETTINGS = 'shiftpulse:settings:v1';

const DEFAULT_SETTINGS = {
  appName: 'ShiftPulse',
  goalHours: 176,
  firstDay: 'mon',      // 'mon' | 'sun'
  timeFormat: '24',     // '24' | '12'
  theme: 'dark',        // 'dark' | 'light' | 'system'
};

const RU_MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const RU_MONTHS_NOM = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const RU_MONTHS_NOM_LOWER = RU_MONTHS_NOM.map(m => m.toLowerCase());
const RU_WEEKDAYS_SHORT = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
const RU_WEEKDAYS_FULL = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];

/* ---------------------------------------------------------------------- */
/* Storage layer                                                          */
/* ---------------------------------------------------------------------- */
const Store = {
  getShifts() {
    try {
      const raw = localStorage.getItem(LS_SHIFTS);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Failed to read shifts', e);
      return [];
    }
  },
  saveShifts(shifts) {
    try {
      localStorage.setItem(LS_SHIFTS, JSON.stringify(shifts));
      return true;
    } catch (e) {
      console.error('Failed to save shifts', e);
      return false;
    }
  },
  getSettings() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      return raw ? Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw)) : Object.assign({}, DEFAULT_SETTINGS);
    } catch (e) {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  },
  saveSettings(settings) {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
  }
};

/* ---------------------------------------------------------------------- */
/* App state                                                              */
/* ---------------------------------------------------------------------- */
const State = {
  shifts: Store.getShifts(),
  settings: Store.getSettings(),
  currentScreen: 'home',
  statsPeriod: 'month',
  historyFilter: 'month',
  calendarCursor: new Date(),      // month currently shown in stats calendar
  calendarSelected: null,           // 'YYYY-MM-DD' selected day
  editingShiftId: null,
  pendingDeleteId: null,
  pendingConfirmAction: null,
  timerInterval: null,
  chart: null,
};

function uid() {
  return 'sh_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/* ---------------------------------------------------------------------- */
/* Time / date utilities                                                  */
/* ---------------------------------------------------------------------- */

// "HH:MM" -> minutes since 00:00
function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function minutesToHM(totalMinutes) {
  const sign = totalMinutes < 0 ? '-' : '';
  const abs = Math.abs(Math.round(totalMinutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}ч ${String(m).padStart(2, '0')}м`;
}

function minutesToHMshort(totalMinutes) {
  const abs = Math.abs(Math.round(totalMinutes));
  const h = Math.floor(abs / 60);
  return `${h}ч`;
}

// Compute worked duration in minutes, handling overnight shifts.
// Returns { minutes, isOvernight, error }
function computeDuration(startTime, endTime, breakTime) {
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  const breakMin = timeToMinutes(breakTime) || 0;

  if (startMin === null || endMin === null) {
    return { minutes: 0, isOvernight: false, error: 'time' };
  }

  let diff = endMin - startMin;
  let isOvernight = false;
  if (diff <= 0) {
    diff += 24 * 60;
    isOvernight = true;
  }

  const worked = diff - breakMin;
  if (worked < 0) {
    return { minutes: 0, isOvernight, error: 'break' };
  }
  return { minutes: worked, isOvernight, error: null };
}

function formatTimeDisplay(t) {
  if (!t) return '--:--';
  if (State.settings.timeFormat === '12') {
    const [h, m] = t.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  }
  return t;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDateHuman(iso) {
  const d = parseISO(iso);
  return `${d.getDate()} ${RU_MONTHS[d.getMonth()]}`;
}

function formatDateHumanFull(iso) {
  const d = parseISO(iso);
  return `${d.getDate()} ${RU_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function weekRange(refDate) {
  const d = new Date(refDate);
  d.setHours(0,0,0,0);
  const dow = d.getDay(); // 0 = Sun
  const firstDayIsMon = State.settings.firstDay === 'mon';
  let offset;
  if (firstDayIsMon) {
    offset = dow === 0 ? 6 : dow - 1;
  } else {
    offset = dow;
  }
  const start = new Date(d);
  start.setDate(d.getDate() - offset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23,59,59,999);
  return { start, end };
}

function monthRange(year, month) {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function yearRange(year) {
  return { start: new Date(year, 0, 1), end: new Date(year, 11, 31, 23, 59, 59, 999) };
}

/* ---------------------------------------------------------------------- */
/* Shift helpers                                                          */
/* ---------------------------------------------------------------------- */
function getActiveShift() {
  return State.shifts.find(s => s.status === 'active') || null;
}

function getCompletedShifts() {
  return State.shifts.filter(s => s.status === 'completed');
}

function shiftsInRange(shifts, start, end) {
  return shifts.filter(s => {
    const d = parseISO(s.date);
    return d >= start && d <= end;
  });
}

function sumMinutes(shifts) {
  return shifts.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);
}

function saveAndRefresh() {
  Store.saveShifts(State.shifts);
  renderAll();
}

/* ---------------------------------------------------------------------- */
/* Toast                                                                  */
/* ---------------------------------------------------------------------- */
let toastTimer = null;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, 2400);
}

/* ---------------------------------------------------------------------- */
/* Navigation                                                             */
/* ---------------------------------------------------------------------- */
function switchScreen(name) {
  if (name === 'settings') { openSettings(); return; }
  State.currentScreen = name;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.target === name);
  });
  document.querySelector('main.view').scrollTop = 0;
  if (name === 'new') prefillNewShiftForm();
  if (name === 'stats') renderStats();
  if (name === 'history') renderHistory();
  if (name === 'home') renderHome();
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchScreen(btn.dataset.target));
});

/* ---------------------------------------------------------------------- */
/* HOME SCREEN                                                            */
/* ---------------------------------------------------------------------- */
function greetingForNow() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Доброе утро';
  if (h >= 12 && h < 18) return 'Добрый день';
  if (h >= 18 && h < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

function renderHome() {
  document.getElementById('greetingText').textContent = greetingForNow();
  renderStatusCard();
  renderQuickStats();
  renderLastShift();
  renderMonthCard();
}

function renderStatusCard() {
  const card = document.getElementById('statusCard');
  const pill = document.getElementById('statusPill');
  const pillText = document.getElementById('statusPillText');
  const body = document.getElementById('statusBody');
  const btn = document.getElementById('btnToggleShift');
  const active = getActiveShift();

  if (active) {
    card.classList.remove('is-idle');
    card.classList.add('is-active');
    pill.classList.remove('idle');
    pill.classList.add('active');
    pillText.textContent = 'На смене';
    const startDisplay = formatTimeDisplay(active.startTime);
    body.innerHTML = `
      <div class="status-card__label">Начало: <b style="color:var(--text-1)">${startDisplay}</b></div>
      <div class="home-status__timer" id="liveTimer">00:00:00</div>
    `;
    btn.textContent = 'Завершить смену';
    btn.className = 'btn btn-stop';
    updateLiveTimer();
    startTimerLoop();
  } else {
    card.classList.remove('is-active');
    card.classList.add('is-idle');
    pill.classList.add('idle');
    pill.classList.remove('active');
    pillText.textContent = 'Не на смене';
    body.innerHTML = `
      <div class="home-status__title">Готов начать смену?</div>
      <div class="status-card__meta">Нажми кнопку ниже, когда выйдешь на работу</div>
    `;
    btn.textContent = 'Начать смену';
    btn.className = 'btn btn-primary';
    stopTimerLoop();
  }
}

function startTimerLoop() {
  stopTimerLoop();
  State.timerInterval = setInterval(updateLiveTimer, 1000);
}
function stopTimerLoop() {
  if (State.timerInterval) { clearInterval(State.timerInterval); State.timerInterval = null; }
}
function updateLiveTimer() {
  const active = getActiveShift();
  const el = document.getElementById('liveTimer');
  if (!active || !el) { stopTimerLoop(); return; }
  const startDT = new Date(`${active.date}T${active.startTime}:00`);
  let diffSec = Math.floor((Date.now() - startDT.getTime()) / 1000);
  if (diffSec < 0) diffSec = 0;
  const h = String(Math.floor(diffSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((diffSec % 3600) / 60)).padStart(2, '0');
  const s = String(diffSec % 60).padStart(2, '0');
  el.textContent = `${h}:${m}:${s}`;
}

document.getElementById('btnToggleShift').addEventListener('click', () => {
  const active = getActiveShift();
  if (active) {
    endActiveShift();
  } else {
    startShiftNow();
  }
});

function startShiftNow() {
  const now = new Date();
  const shift = {
    id: uid(),
    date: dateISO(now),
    startTime: `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
    endTime: null,
    breakMinutes: 0,
    durationMinutes: null,
    comment: '',
    status: 'active',
    createdAt: now.toISOString(),
  };
  State.shifts.push(shift);
  saveAndRefresh();
  showToast('Смена начата', 'ok');
}

function endActiveShift() {
  const active = getActiveShift();
  if (!active) return;
  const now = new Date();
  const endTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const { minutes } = computeDuration(active.startTime, endTime, '00:00');
  active.endTime = endTime;
  active.breakMinutes = 0;
  active.durationMinutes = minutes;
  active.status = 'completed';
  saveAndRefresh();
  showToast('Смена завершена · ' + minutesToHM(minutes), 'ok');
}

function renderQuickStats() {
  const now = new Date();
  const { start, end } = monthRange(now.getFullYear(), now.getMonth());
  const completed = getCompletedShifts();
  const monthShifts = shiftsInRange(completed, start, end);
  const monthMinutes = sumMinutes(monthShifts);
  const avg = monthShifts.length ? monthMinutes / monthShifts.length : 0;

  document.getElementById('statShiftsMonth').textContent = monthShifts.length;
  document.getElementById('statHoursMonth').textContent = minutesToHM(monthMinutes);
  document.getElementById('statAvgShift').textContent = minutesToHM(avg);
  document.getElementById('statTotalShifts').textContent = completed.length;
}

function renderLastShift() {
  const completed = getCompletedShifts().slice().sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime));
  const wrap = document.getElementById('lastShiftWrap');
  const title = document.getElementById('lastShiftTitle');
  if (!completed.length) {
    title.style.display = 'none';
    wrap.innerHTML = '';
    return;
  }
  title.style.display = '';
  const s = completed[0];
  const today = todayISO();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yesterday = dateISO(y);
  let badge = '';
  if (s.date === today) badge = '<span class="badge-today">Сегодня</span>';
  else if (s.date === yesterday) badge = '<span class="badge-today" style="color:var(--text-2);background:var(--card-2)">Вчера</span>';

  wrap.innerHTML = `
    <div class="card last-shift-card" data-open-shift="${s.id}">
      <div>
        <div class="last-shift-card__date">📅 ${formatDateHuman(s.date)}</div>
        <div class="last-shift-card__range">${formatTimeDisplay(s.startTime)} → ${formatTimeDisplay(s.endTime)}</div>
        ${badge}
      </div>
      <div class="last-shift-card__dur">
        <div class="num">${minutesToHM(s.durationMinutes)}</div>
        <div class="lbl">отработано</div>
      </div>
    </div>
  `;
  wrap.querySelector('[data-open-shift]').addEventListener('click', () => openShiftDetail(s.id));
}

function renderMonthCard() {
  const now = new Date();
  const { start, end } = monthRange(now.getFullYear(), now.getMonth());
  const completed = getCompletedShifts();
  const monthShifts = shiftsInRange(completed, start, end);
  const minutes = sumMinutes(monthShifts);
  const avg = monthShifts.length ? minutes / monthShifts.length : 0;
  const goalMinutes = (State.settings.goalHours || 0) * 60;

  document.getElementById('monthCardLabel').textContent = `${RU_MONTHS_NOM[now.getMonth()].toUpperCase()} ${now.getFullYear()}`;
  document.getElementById('monthCardHours').textContent = minutesToHM(minutes);
  document.getElementById('monthCardShifts').textContent = monthShifts.length;
  document.getElementById('monthCardAvg').textContent = minutesToHM(avg);

  const fill = document.getElementById('progressFill');
  const pctEl = document.getElementById('progressPct');
  const note = document.getElementById('progressNote');

  if (!goalMinutes) {
    fill.style.width = '0%';
    pctEl.textContent = '—';
    note.textContent = 'Цель не задана — укажи её в настройках';
    note.className = 'progress__note';
    return;
  }
  const pct = Math.min(100, (minutes / goalMinutes) * 100);
  fill.style.width = pct.toFixed(1) + '%';
  fill.classList.toggle('is-complete', minutes >= goalMinutes);
  pctEl.textContent = pct.toFixed(1) + '%';
  if (minutes >= goalMinutes) {
    note.textContent = 'Цель месяца выполнена 🎉';
    note.className = 'progress__note done';
  } else {
    note.textContent = `Осталось ${minutesToHM(goalMinutes - minutes)} из ${State.settings.goalHours}ч`;
    note.className = 'progress__note';
  }
}

/* ---------------------------------------------------------------------- */
/* NEW SHIFT SCREEN                                                       */
/* ---------------------------------------------------------------------- */
function prefillNewShiftForm() {
  document.getElementById('fDate').value = todayISO();
  document.getElementById('fStart').value = '09:00';
  document.getElementById('fEnd').value = '18:00';
  document.getElementById('fBreak').value = '01:00';
  document.getElementById('fComment').value = '';
  document.getElementById('formError').classList.remove('show');
  updateNewShiftPreview();
}

function updateNewShiftPreview() {
  const start = document.getElementById('fStart').value;
  const end = document.getElementById('fEnd').value;
  const brk = document.getElementById('fBreak').value || '00:00';
  renderDurationPreview('durationPreview', 'durationRangeText', 'durationBreakText', 'durationTotalText', start, end, brk);
}

function renderDurationPreview(cardId, rangeId, breakId, totalId, start, end, brk) {
  const card = document.getElementById(cardId);
  const { minutes, isOvernight, error } = computeDuration(start, end, brk);
  document.getElementById(rangeId).textContent = `${formatTimeDisplay(start)} → ${formatTimeDisplay(end)}`;
  document.getElementById(breakId).textContent = `Перерыв: ${brk || '00:00'}`;
  const totalEl = document.getElementById(totalId);
  card.classList.toggle('is-overnight', isOvernight && !error);
  card.classList.toggle('is-error', !!error);
  if (error === 'break') {
    totalEl.textContent = 'Перерыв больше смены';
  } else if (error === 'time') {
    totalEl.textContent = '—';
  } else {
    totalEl.textContent = minutesToHM(minutes);
  }
  return { minutes, isOvernight, error };
}

['fStart', 'fEnd', 'fBreak'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateNewShiftPreview);
});

document.getElementById('btnSaveShift').addEventListener('click', () => {
  const date = document.getElementById('fDate').value;
  const start = document.getElementById('fStart').value;
  const end = document.getElementById('fEnd').value;
  const brk = document.getElementById('fBreak').value || '00:00';
  const comment = document.getElementById('fComment').value.trim();
  const errEl = document.getElementById('formError');

  if (!date) return showFormError(errEl, 'Укажи дату смены');
  if (!start) return showFormError(errEl, 'Укажи время начала');
  if (!end) return showFormError(errEl, 'Укажи время окончания');

  const { minutes, error } = computeDuration(start, end, brk);
  if (error === 'break') return showFormError(errEl, 'Перерыв не может быть длиннее самой смены');
  if (error === 'time') return showFormError(errEl, 'Проверь введённое время');

  errEl.classList.remove('show');

  const shift = {
    id: uid(),
    date,
    startTime: start,
    endTime: end,
    breakMinutes: timeToMinutes(brk) || 0,
    durationMinutes: minutes,
    comment,
    status: 'completed',
    createdAt: new Date().toISOString(),
  };
  State.shifts.push(shift);
  saveAndRefresh();
  showToast('Смена сохранена · ' + minutesToHM(minutes), 'ok');
  switchScreen('home');
});

function showFormError(el, msg) {
  el.textContent = msg;
  el.classList.add('show');
}

/* ---------------------------------------------------------------------- */
/* HISTORY SCREEN                                                         */
/* ---------------------------------------------------------------------- */
const historyFilterSelect = document.getElementById('historyFilter');
const customRangeEl = document.getElementById('customRange');

historyFilterSelect.addEventListener('change', () => {
  State.historyFilter = historyFilterSelect.value;
  customRangeEl.classList.toggle('show', State.historyFilter === 'custom');
  renderHistory();
});
document.getElementById('customFrom').addEventListener('change', renderHistory);
document.getElementById('customTo').addEventListener('change', renderHistory);

function getHistoryRange() {
  const now = new Date();
  switch (State.historyFilter) {
    case 'today': {
      const d = new Date(); d.setHours(0,0,0,0);
      const e = new Date(); e.setHours(23,59,59,999);
      return { start: d, end: e };
    }
    case 'week': return weekRange(now);
    case 'month': return monthRange(now.getFullYear(), now.getMonth());
    case 'lastMonth': {
      const m = now.getMonth() - 1, y = m < 0 ? now.getFullYear() - 1 : now.getFullYear();
      return monthRange(y, (m + 12) % 12);
    }
    case 'year': return yearRange(now.getFullYear());
    case 'all': return { start: new Date(2000, 0, 1), end: new Date(2100, 0, 1) };
    case 'custom': {
      const from = document.getElementById('customFrom').value;
      const to = document.getElementById('customTo').value;
      const start = from ? parseISO(from) : new Date(2000, 0, 1);
      const end = to ? new Date(parseISO(to).getTime() + 86399999) : new Date(2100, 0, 1);
      return { start, end };
    }
    default: return monthRange(now.getFullYear(), now.getMonth());
  }
}

function renderHistory() {
  const content = document.getElementById('historyContent');
  const { start, end } = getHistoryRange();
  const all = State.shifts.slice().sort((a, b) => (b.date + (b.startTime||'')).localeCompare(a.date + (a.startTime||'')));
  const inRange = all.filter(s => {
    const d = parseISO(s.date);
    return d >= start && d <= end;
  });

  if (!State.shifts.length) {
    content.innerHTML = emptyStateHTML();
    content.querySelector('[data-empty-add]')?.addEventListener('click', () => switchScreen('new'));
    return;
  }

  if (!inRange.length) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">
          <svg viewBox="0 0 24 24" fill="none"><path d="M8 2V6M16 2V6M3 10H21M5 4H19A2 2 0 0121 6V20A2 2 0 0119 22H5A2 2 0 013 20V6A2 2 0 015 4Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="empty-state__title">Нет смен за этот период</div>
        <div class="empty-state__sub">Попробуй выбрать другой период или добавь новую смену.</div>
      </div>`;
    return;
  }

  const list = document.createElement('div');
  list.className = 'history-list';
  inRange.forEach(s => {
    const card = document.createElement('div');
    card.className = 'card shift-card';
    const isActive = s.status === 'active';
    const d = parseISO(s.date);
    card.innerHTML = `
      <div class="shift-card__status-bar ${isActive ? 'active' : ''}"></div>
      <div class="shift-card__main">
        <div class="shift-card__date">${formatDateHuman(s.date)}</div>
        <div class="shift-card__weekday">${RU_WEEKDAYS_FULL[d.getDay()]}</div>
        <div class="shift-card__range">
          ${formatTimeDisplay(s.startTime)}
          <svg viewBox="0 0 24 24" fill="none"><path d="M5 12H19M19 12L13 6M19 12L13 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          ${isActive ? 'сейчас' : formatTimeDisplay(s.endTime)}
        </div>
        ${s.comment ? `<div class="shift-card__comment">${escapeHTML(s.comment)}</div>` : ''}
      </div>
      <div class="shift-card__dur">
        <div class="num">${isActive ? '—' : minutesToHM(s.durationMinutes)}</div>
        <div class="lbl">${isActive ? 'в процессе' : 'работал'}</div>
      </div>
    `;
    if (!isActive) {
      card.addEventListener('click', () => openShiftDetail(s.id));
    } else {
      card.addEventListener('click', () => switchScreen('home'));
    }
    list.appendChild(card);
  });
  content.innerHTML = '';
  content.appendChild(list);
}

function emptyStateHTML() {
  return `
    <div class="empty-state">
      <div class="empty-state__icon">
        <svg viewBox="0 0 24 24" fill="none"><path d="M8 2V6M16 2V6M3 10H21M5 4H19A2 2 0 0121 6V20A2 2 0 0119 22H5A2 2 0 013 20V6A2 2 0 015 4Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="empty-state__title">История пока пуста</div>
      <div class="empty-state__sub">Добавь первую смену и начни собирать свою рабочую статистику.</div>
      <button class="btn btn-primary" data-empty-add>+ Добавить смену</button>
    </div>`;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------------------------------------------------------------- */
/* SHIFT DETAIL / EDIT                                                    */
/* ---------------------------------------------------------------------- */
const detailOverlay = document.getElementById('detailOverlay');

function openShiftDetail(id) {
  const s = State.shifts.find(x => x.id === id);
  if (!s) return;
  State.editingShiftId = id;
  document.getElementById('detailDateSub').textContent = formatDateHumanFull(s.date);
  document.getElementById('eDate').value = s.date;
  document.getElementById('eStart').value = s.startTime || '';
  document.getElementById('eEnd').value = s.endTime || '';
  const brkH = Math.floor((s.breakMinutes||0)/60);
  const brkM = (s.breakMinutes||0)%60;
  document.getElementById('eBreak').value = `${String(brkH).padStart(2,'0')}:${String(brkM).padStart(2,'0')}`;
  document.getElementById('eComment').value = s.comment || '';
  document.getElementById('editFormError').classList.remove('show');
  updateEditPreview();
  openOverlay(detailOverlay);
}

['eStart', 'eEnd', 'eBreak'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateEditPreview);
});
function updateEditPreview() {
  const start = document.getElementById('eStart').value;
  const end = document.getElementById('eEnd').value;
  const brk = document.getElementById('eBreak').value || '00:00';
  renderDurationPreview('editDurationPreview', 'editDurationRangeText', 'editDurationBreakText', 'editDurationTotalText', start, end, brk);
}

document.getElementById('btnUpdateShift').addEventListener('click', () => {
  const s = State.shifts.find(x => x.id === State.editingShiftId);
  if (!s) return;
  const date = document.getElementById('eDate').value;
  const start = document.getElementById('eStart').value;
  const end = document.getElementById('eEnd').value;
  const brk = document.getElementById('eBreak').value || '00:00';
  const comment = document.getElementById('eComment').value.trim();
  const errEl = document.getElementById('editFormError');

  if (!date) return showFormError(errEl, 'Укажи дату смены');
  if (!start) return showFormError(errEl, 'Укажи время начала');
  if (!end) return showFormError(errEl, 'Укажи время окончания');
  const { minutes, error } = computeDuration(start, end, brk);
  if (error === 'break') return showFormError(errEl, 'Перерыв не может быть длиннее самой смены');
  if (error === 'time') return showFormError(errEl, 'Проверь введённое время');
  errEl.classList.remove('show');

  s.date = date;
  s.startTime = start;
  s.endTime = end;
  s.breakMinutes = timeToMinutes(brk) || 0;
  s.durationMinutes = minutes;
  s.comment = comment;

  saveAndRefresh();
  closeOverlay(detailOverlay);
  showToast('Смена обновлена', 'ok');
});

document.getElementById('btnDeleteShift').addEventListener('click', () => {
  closeOverlay(detailOverlay);
  askConfirm('Удалить эту смену?', 'Это действие нельзя отменить.', () => {
    State.shifts = State.shifts.filter(x => x.id !== State.editingShiftId);
    saveAndRefresh();
    showToast('Смена удалена', 'ok');
  });
});

/* ---------------------------------------------------------------------- */
/* CONFIRM SHEET (generic)                                                */
/* ---------------------------------------------------------------------- */
const confirmOverlay = document.getElementById('confirmOverlay');
function askConfirm(title, sub, onConfirm) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmSub').textContent = sub;
  State.pendingConfirmAction = onConfirm;
  openOverlay(confirmOverlay);
}
document.getElementById('confirmOk').addEventListener('click', () => {
  const fn = State.pendingConfirmAction;
  State.pendingConfirmAction = null;
  closeOverlay(confirmOverlay);
  if (fn) fn();
});
document.getElementById('confirmCancel').addEventListener('click', () => {
  State.pendingConfirmAction = null;
  closeOverlay(confirmOverlay);
});

/* ---------------------------------------------------------------------- */
/* Overlay helpers                                                        */
/* ---------------------------------------------------------------------- */
function openOverlay(el) { el.classList.add('show'); }
function closeOverlay(el) { el.classList.remove('show'); }
document.querySelectorAll('.overlay').forEach(ov => {
  ov.addEventListener('click', (e) => { if (e.target === ov) closeOverlay(ov); });
});

/* ---------------------------------------------------------------------- */
/* STATS SCREEN                                                           */
/* ---------------------------------------------------------------------- */
document.getElementById('statsSegmented').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  State.statsPeriod = btn.dataset.period;
  document.querySelectorAll('#statsSegmented button').forEach(b => b.classList.toggle('active', b === btn));
  renderStats();
});

function renderStats() {
  const now = new Date();
  const completed = getCompletedShifts();
  let range, chartLabels, chartData, chartTitle;

  if (State.statsPeriod === 'week') {
    range = weekRange(now);
    chartTitle = 'Рабочие часы по дням';
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(range.start);
      d.setDate(range.start.getDate() + i);
      days.push(d);
    }
    chartLabels = days.map(d => RU_WEEKDAYS_SHORT[d.getDay()]);
    chartData = days.map(d => {
      const iso = dateISO(d);
      return sumMinutes(completed.filter(s => s.date === iso)) / 60;
    });
  } else if (State.statsPeriod === 'month') {
    range = monthRange(now.getFullYear(), now.getMonth());
    chartTitle = 'Рабочие часы по дням';
    const daysInMonth = range.end.getDate();
    chartLabels = [];
    chartData = [];
    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), i);
      const iso = dateISO(d);
      chartLabels.push(String(i));
      chartData.push(sumMinutes(completed.filter(s => s.date === iso)) / 60);
    }
  } else {
    range = yearRange(now.getFullYear());
    chartTitle = 'Рабочие часы по месяцам';
    chartLabels = RU_MONTHS_NOM.map(m => m.slice(0, 3));
    chartData = [];
    for (let m = 0; m < 12; m++) {
      const mr = monthRange(now.getFullYear(), m);
      chartData.push(sumMinutes(shiftsInRange(completed, mr.start, mr.end)) / 60);
    }
  }

  const periodShifts = shiftsInRange(completed, range.start, range.end);
  const minutes = sumMinutes(periodShifts);
  const avg = periodShifts.length ? minutes / periodShifts.length : 0;
  const longest = periodShifts.length ? Math.max(...periodShifts.map(s => s.durationMinutes)) : 0;
  const shortest = periodShifts.length ? Math.min(...periodShifts.map(s => s.durationMinutes)) : 0;

  document.getElementById('msShifts').textContent = periodShifts.length;
  document.getElementById('msHours').textContent = minutesToHM(minutes);
  document.getElementById('msAvg').textContent = minutesToHM(avg);
  document.getElementById('msLongest').textContent = minutesToHM(longest);
  document.getElementById('chartTitle').textContent = chartTitle;

  renderChart(chartLabels, chartData);
  renderInsights(completed);
  renderCalendar();
  renderMonthBreakdown(completed);
}

function renderChart(labels, data) {
  const ctx = document.getElementById('hoursChart');
  const isLight = document.documentElement.classList.contains('theme-light');
  const gridColor = isLight ? 'rgba(15,17,20,0.08)' : 'rgba(255,255,255,0.06)';
  const textColor = isLight ? '#5A5F68' : '#9CA1AC';

  if (State.chart) { State.chart.destroy(); }
  if (typeof Chart === 'undefined') return;
  State.chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: 'rgba(139,124,255,0.55)',
        hoverBackgroundColor: '#8B7CFF',
        borderRadius: 5,
        maxBarThickness: 22,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (item) => `${item.formattedValue}ч` }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: textColor, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }
        },
        y: {
          beginAtZero: true,
          grid: { color: gridColor },
          ticks: { color: textColor, font: { size: 10 }, callback: (v) => v + 'ч' }
        }
      }
    }
  });
}

function renderInsights(completed) {
  // streak: consecutive calendar days (up to today) with at least one shift
  const datesSet = new Set(completed.map(s => s.date));
  let streak = 0;
  let cursor = new Date();
  while (true) {
    const iso = dateISO(cursor);
    if (datesSet.has(iso)) { streak++; cursor.setDate(cursor.getDate() - 1); }
    else break;
  }
  document.getElementById('inStreak').textContent = streak > 0 ? pluralDays(streak) : '0 дней';

  // busiest day of week
  const byDow = [0,0,0,0,0,0,0];
  completed.forEach(s => { byDow[parseISO(s.date).getDay()] += s.durationMinutes || 0; });
  const maxIdx = byDow.indexOf(Math.max(...byDow));
  document.getElementById('inBusiest').textContent = Math.max(...byDow) > 0 ? RU_WEEKDAYS_FULL[maxIdx] : '—';

  // avg hours per week (based on weeks that have data)
  const weekMap = {};
  completed.forEach(s => {
    const d = parseISO(s.date);
    const { start } = weekRange(d);
    const key = dateISO(start);
    weekMap[key] = (weekMap[key] || 0) + (s.durationMinutes || 0);
  });
  const weekKeys = Object.keys(weekMap);
  const weekAvg = weekKeys.length ? weekKeys.reduce((a,k) => a + weekMap[k], 0) / weekKeys.length : 0;
  document.getElementById('inWeekAvg').textContent = minutesToHM(weekAvg);

  const shortest = completed.length ? Math.min(...completed.map(s => s.durationMinutes)) : 0;
  document.getElementById('inShortest').textContent = minutesToHM(shortest);
}

function pluralDays(n) {
  const mod10 = n % 10, mod100 = n % 100;
  let word = 'дней';
  if (mod100 < 11 || mod100 > 14) {
    if (mod10 === 1) word = 'день';
    else if (mod10 >= 2 && mod10 <= 4) word = 'дня';
  }
  return `${n} ${word}`;
}

/* Calendar */
document.getElementById('calPrev').addEventListener('click', () => {
  State.calendarCursor.setMonth(State.calendarCursor.getMonth() - 1);
  renderCalendar();
});
document.getElementById('calNext').addEventListener('click', () => {
  State.calendarCursor.setMonth(State.calendarCursor.getMonth() + 1);
  renderCalendar();
});

function renderCalendar() {
  const cur = State.calendarCursor;
  const year = cur.getFullYear();
  const month = cur.getMonth();
  document.getElementById('calTitle').textContent = `${RU_MONTHS_NOM_LOWER[month]} ${year}`;

  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';

  const firstDayIsMon = State.settings.firstDay === 'mon';
  const dowLabels = firstDayIsMon ? ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'] : ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
  dowLabels.forEach(l => {
    const el = document.createElement('div');
    el.className = 'calendar-dow';
    el.textContent = l;
    grid.appendChild(el);
  });

  const firstOfMonth = new Date(year, month, 1);
  let startOffset = firstOfMonth.getDay(); // 0=Sun
  if (firstDayIsMon) startOffset = startOffset === 0 ? 6 : startOffset - 1;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayISO();

  const shiftsByDate = {};
  State.shifts.forEach(s => {
    if (!shiftsByDate[s.date]) shiftsByDate[s.date] = [];
    shiftsByDate[s.date].push(s);
  });

  for (let i = 0; i < startOffset; i++) {
    const empty = document.createElement('div');
    empty.className = 'calendar-day empty';
    grid.appendChild(empty);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    const iso = dateISO(d);
    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    if (iso === today) cell.classList.add('today');
    const dayShifts = shiftsByDate[iso];
    if (dayShifts && dayShifts.length) {
      cell.classList.add('has-shift');
      if (dayShifts.some(s => s.status === 'active')) cell.classList.add('has-active');
    }
    if (iso === State.calendarSelected) cell.classList.add('selected');
    cell.textContent = day;
    cell.addEventListener('click', () => {
      State.calendarSelected = iso;
      renderCalendar();
      renderCalendarDetail(iso, dayShifts);
    });
    grid.appendChild(cell);
  }

  if (State.calendarSelected) {
    const [sy, sm] = State.calendarSelected.split('-').map(Number);
    if (sy === year && sm - 1 === month) {
      renderCalendarDetail(State.calendarSelected, shiftsByDate[State.calendarSelected]);
    } else {
      document.getElementById('calDetail').textContent = 'Выбери день, чтобы увидеть детали';
    }
  }
}

function renderCalendarDetail(iso, dayShifts) {
  const el = document.getElementById('calDetail');
  if (!dayShifts || !dayShifts.length) {
    el.innerHTML = `<b>${formatDateHuman(iso)}</b> — Смены нет`;
    return;
  }
  const parts = dayShifts.map(s => {
    if (s.status === 'active') return `${formatTimeDisplay(s.startTime)} → сейчас (в процессе)`;
    return `${formatTimeDisplay(s.startTime)} → ${formatTimeDisplay(s.endTime)} · ${minutesToHM(s.durationMinutes)}`;
  });
  el.innerHTML = `<b>${formatDateHuman(iso)}</b><br>${parts.join('<br>')}`;
}

function renderMonthBreakdown(completed) {
  const wrap = document.getElementById('monthBreakdown');
  const byMonth = {};
  completed.forEach(s => {
    const d = parseISO(s.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!byMonth[key]) byMonth[key] = { minutes: 0, count: 0, year: d.getFullYear(), month: d.getMonth() };
    byMonth[key].minutes += s.durationMinutes || 0;
    byMonth[key].count += 1;
  });
  const keys = Object.keys(byMonth).sort((a, b) => b.localeCompare(a)).slice(0, 12);
  if (!keys.length) {
    wrap.innerHTML = `<div class="card" style="padding:16px;color:var(--text-2);font-size:13.5px;text-align:center">Пока нет данных</div>`;
    return;
  }
  wrap.innerHTML = keys.map(k => {
    const item = byMonth[k];
    return `
      <div class="card month-row">
        <div>
          <div class="month-row__name">${RU_MONTHS_NOM_LOWER[item.month]} ${item.year}</div>
          <div class="month-row__shifts">${item.count} смен</div>
        </div>
        <div class="month-row__hours">${minutesToHM(item.minutes)}</div>
      </div>`;
  }).join('');
}

/* ---------------------------------------------------------------------- */
/* SETTINGS                                                               */
/* ---------------------------------------------------------------------- */
const settingsOverlay = document.getElementById('settingsOverlay');

function openSettings() {
  syncSettingsFormFromState();
  openOverlay(settingsOverlay);
}
document.getElementById('openSettings').addEventListener('click', openSettings);

function syncSettingsFormFromState() {
  const s = State.settings;
  document.getElementById('setAppName').value = s.appName;
  document.getElementById('setGoalHours').value = s.goalHours;
  setToggleGroup('setFirstDay', s.firstDay);
  setToggleGroup('setTimeFormat', s.timeFormat);
  setToggleGroup('setTheme', s.theme);
}

function setToggleGroup(groupId, val) {
  document.querySelectorAll(`#${groupId} button`).forEach(b => {
    b.classList.toggle('active', b.dataset.val === val);
  });
}

document.getElementById('setAppName').addEventListener('input', (e) => {
  State.settings.appName = e.target.value.trim() || 'ShiftPulse';
  persistSettings();
  document.getElementById('appNameLabel').textContent = State.settings.appName;
});
document.getElementById('setGoalHours').addEventListener('input', (e) => {
  const v = parseInt(e.target.value, 10);
  State.settings.goalHours = Number.isFinite(v) && v >= 0 ? v : 0;
  persistSettings();
  renderMonthCard();
});

['setFirstDay', 'setTimeFormat', 'setTheme'].forEach(groupId => {
  document.getElementById(groupId).addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    setToggleGroup(groupId, btn.dataset.val);
    const map = { setFirstDay: 'firstDay', setTimeFormat: 'timeFormat', setTheme: 'theme' };
    State.settings[map[groupId]] = btn.dataset.val;
    persistSettings();
    if (groupId === 'setTheme') applyTheme();
    renderAll();
  });
});

function persistSettings() {
  Store.saveSettings(State.settings);
}

function applyTheme() {
  const root = document.documentElement;
  root.classList.remove('theme-light', 'theme-system');
  if (State.settings.theme === 'light') root.classList.add('theme-light');
  else if (State.settings.theme === 'system') root.classList.add('theme-system');
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) {
    const isLight = State.settings.theme === 'light' ||
      (State.settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
    meta.setAttribute('content', isLight ? '#F4F5F7' : '#0B0D10');
  }
}

document.getElementById('btnDeleteAll').addEventListener('click', () => {
  askConfirm('Удалить все данные?', 'Все смены и настройки будут удалены без возможности восстановления.', () => {
    State.shifts = [];
    State.settings = Object.assign({}, DEFAULT_SETTINGS);
    Store.saveShifts([]);
    Store.saveSettings(State.settings);
    applyTheme();
    syncSettingsFormFromState();
    document.getElementById('appNameLabel').textContent = State.settings.appName;
    renderAll();
    closeOverlay(settingsOverlay);
    showToast('Все данные удалены', 'ok');
  });
});

/* ---------------------------------------------------------------------- */
/* EXPORT / IMPORT                                                        */
/* ---------------------------------------------------------------------- */
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

document.getElementById('btnExportJson').addEventListener('click', () => {
  const payload = { version: 1, exportedAt: new Date().toISOString(), settings: State.settings, shifts: State.shifts };
  downloadFile(`shiftpulse_${todayISO()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  showToast('JSON экспортирован', 'ok');
});

document.getElementById('btnExportCsv').addEventListener('click', () => {
  const header = ['Дата', 'Начало', 'Конец', 'Перерыв', 'Рабочие часы', 'Комментарий'];
  const rows = getCompletedShifts()
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(s => {
      const brkH = Math.floor((s.breakMinutes||0)/60);
      const brkM = (s.breakMinutes||0)%60;
      const brk = `${String(brkH).padStart(2,'0')}:${String(brkM).padStart(2,'0')}`;
      return [s.date, s.startTime, s.endTime, brk, minutesToHM(s.durationMinutes), (s.comment||'').replace(/"/g,'""')];
    });
  const csv = [header, ...rows].map(r => r.map(v => `"${v ?? ''}"`).join(',')).join('\r\n');
  downloadFile(`shifts_${todayISO()}.csv`, '\uFEFF' + csv, 'text/csv;charset=utf-8');
  showToast('CSV экспортирован', 'ok');
});

const importFileInput = document.getElementById('importFileInput');
const importOverlay = document.getElementById('importOverlay');
let pendingImportData = null;

document.getElementById('btnImportJson').addEventListener('click', () => importFileInput.click());
importFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.shifts)) throw new Error('bad format');
      pendingImportData = data;
      closeOverlay(settingsOverlay);
      openOverlay(importOverlay);
    } catch (err) {
      showToast('Не удалось прочитать файл', 'err');
    }
    importFileInput.value = '';
  };
  reader.readAsText(file);
});

document.getElementById('importCancel').addEventListener('click', () => {
  pendingImportData = null;
  closeOverlay(importOverlay);
});
document.getElementById('importOk').addEventListener('click', () => {
  if (!pendingImportData) { closeOverlay(importOverlay); return; }
  const existingIds = new Set(State.shifts.map(s => s.id));
  let added = 0;
  pendingImportData.shifts.forEach(s => {
    if (!s.id || !existingIds.has(s.id)) {
      State.shifts.push(Object.assign({}, s, { id: s.id && !existingIds.has(s.id) ? s.id : uid() }));
      added++;
    }
  });
  saveAndRefresh();
  closeOverlay(importOverlay);
  pendingImportData = null;
  showToast(`Импортировано смен: ${added}`, 'ok');
});

/* ---------------------------------------------------------------------- */
/* Global render                                                          */
/* ---------------------------------------------------------------------- */
function renderAll() {
  if (State.currentScreen === 'home') renderHome();
  else renderQuickStats();
  if (State.currentScreen === 'stats') renderStats();
  if (State.currentScreen === 'history') renderHistory();
  document.getElementById('appNameLabel').textContent = State.settings.appName;
}

/* ---------------------------------------------------------------------- */
/* Init                                                                    */
/* ---------------------------------------------------------------------- */
function init() {
  applyTheme();
  document.getElementById('appNameLabel').textContent = State.settings.appName;
  document.getElementById('fDate').value = todayISO();
  renderHome();

  // keep active-shift timer running even if user navigates away and back
  if (getActiveShift()) startTimerLoop();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => console.error('SW registration failed', err));
    });
  }
}

init();
