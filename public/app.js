/* ═══════════════════════════════════════════════════════════════════
   Lobotrans — Frontend Application
═══════════════════════════════════════════════════════════════════ */

// ── Constants ──────────────────────────────────────────────────────────
const DAY_START   = 6;
const DAY_END     = 22;
const DAY_MINUTES = (DAY_END - DAY_START) * 60;

const DAYS_SHORT = ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];
const MONTHS_PL  = ['sty','lut','mar','kwi','maj','cze','lip','sie','wrz','paź','lis','gru'];

const PRESET_COLORS = [
  '#e74c3c','#e67e22','#f39c12','#2ecc71','#1abc9c',
  '#3498db','#9b59b6','#e91e8c','#808000','#34495e',
  '#16a085','#d35400','#8e44ad','#27ae60','#2980b9',
];

const STATUS_INFO = {
  looking:    { icon: '🔍', label: 'Szukam ładunku',    cls: 'status-looking'    },
  end_of_day: { icon: '🏁', label: 'Koniec pracy',      cls: 'status-end_of_day' },
  pause:      { icon: '⏸',  label: 'Pauza',             cls: 'status-pause'      },
  service:    { icon: '🔧', label: 'W serwisie',        cls: 'status-service'    },
  other:      { icon: '📝', label: 'Inne',              cls: 'status-other'      },
};

// ── State ──────────────────────────────────────────────────────────────
const state = {
  vehicles : [],
  routes   : [],
  statuses : [],
  drivers  : [],
  weekStart: getWeekStart(new Date()),
};

// ── Date Helpers ───────────────────────────────────────────────────────
function getWeekStart(date) {
  const d   = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekDays(weekStart) {
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTime(date) {
  return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}

function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minToTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// ── API ────────────────────────────────────────────────────────────────
async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text); // may be JSON string — caller can JSON.parse
  }
  return res.json();
}

async function loadData() {
  const days = getWeekDays(state.weekStart);
  const from = formatDate(days[0]);
  const to   = formatDate(days[4]);
  const [vehicles, routes, statuses, drivers] = await Promise.all([
    api('GET', '/api/vehicles'),
    api('GET', `/api/routes?from=${from}&to=${to}`),
    api('GET', '/api/statuses'),
    api('GET', '/api/drivers'),
  ]);
  state.vehicles = vehicles;
  state.routes   = routes;
  state.statuses = statuses;
  state.drivers  = drivers;
  render();
}

// ── Render ─────────────────────────────────────────────────────────────
function render() {
  renderCalendar();
  renderTimeLegend();
  updateTimeIndicator();
  renderNotificationPanel();
}

// ── Calendar ───────────────────────────────────────────────────────────
function renderCalendar() {
  const days     = getWeekDays(state.weekStart);
  const todayStr = formatDate(new Date());
  const table    = document.getElementById('calendar-table');

  const d0 = days[0], d4 = days[4];
  document.getElementById('week-label').textContent =
    `${d0.getDate()} ${MONTHS_PL[d0.getMonth()]} – ${d4.getDate()} ${MONTHS_PL[d4.getMonth()]} ${d4.getFullYear()}`;

  let html = '<colgroup><col style="width:170px">' +
    days.map(() => '<col>').join('') + '</colgroup><thead><tr>';

  html += '<th class="vehicle-header-cell">Samochody</th>';
  days.forEach((day, i) => {
    const isToday   = formatDate(day) === todayStr;
    const isWeekend = day.getDay() === 0 || day.getDay() === 6;
    html += `<th class="day-header-cell${isToday ? ' is-today' : ''}${isWeekend ? ' is-weekend' : ''}" data-col="${i}">` +
      `<div class="day-name">${DAYS_SHORT[day.getDay()]}</div>` +
      `<div class="day-date">${day.getDate()}</div>` +
      `</th>`;
  });
  html += '</tr></thead><tbody>';

  if (state.vehicles.length === 0) {
    html += `<tr><td colspan="8" class="empty-state">
      Brak pojazdów. Kliknij <strong>⚙ Pojazdy</strong> aby dodać pierwszy pojazd.
    </td></tr>`;
  } else {
    state.vehicles.forEach(vehicle => {
      const currentStatus = state.statuses.find(s => s.vehicle_id === vehicle.id);
      html += '<tr>';

      // Vehicle name cell (with optional status badge)
      html += `<td class="vehicle-name-cell" data-vehicle-id="${vehicle.id}">` +
        `<div class="vehicle-name-inner">` +
        `<div class="vehicle-info">` +
        `<span class="vehicle-name-text" style="color:${vehicle.color}">${escHtml(vehicle.name)}</span>`;

      if (currentStatus) {
        const si = STATUS_INFO[currentStatus.status] || { icon: '📝', label: currentStatus.status, cls: 'status-other' };
        const lbl = currentStatus.status === 'other' && currentStatus.note
          ? currentStatus.note.substring(0, 18)
          : si.label;
        html += `<span class="vehicle-status-tag ${si.cls}">` +
          `${si.icon} ${escHtml(lbl)}` +
          `<button class="status-clear" data-vehicle-id="${vehicle.id}" title="Usuń status">×</button>` +
          `</span>`;
      }

      html += `</div>` +
        `<button class="vehicle-edit-btn" data-vehicle-id="${vehicle.id}" title="Edytuj pojazd">✏</button>` +
        `</div></td>`;

      // Day cells
      days.forEach((day, dayIdx) => {
        const dateStr    = formatDate(day);
        const isToday    = dateStr === todayStr;
        const isWeekend  = day.getDay() === 0 || day.getDay() === 6;
        const isLast     = dayIdx === 6;
        const cellRoutes = state.routes.filter(r => r.vehicle_id === vehicle.id && r.date === dateStr);

        html += `<td class="route-cell` +
          (isToday ? ' is-today' : '') + (isWeekend ? ' is-weekend' : '') + (isLast ? ' last-col' : '') +
          `" data-vehicle-id="${vehicle.id}" data-date="${dateStr}" data-day="${dayIdx}">`;

        cellRoutes.forEach((route, idx) => {
          const startMin = timeToMin(route.start_time);
          const endMin   = timeToMin(route.end_time);
          const dayStart = DAY_START * 60;
          const left  = Math.max(0, (startMin - dayStart) / DAY_MINUTES * 100);
          const right = Math.min(100, (endMin   - dayStart) / DAY_MINUTES * 100);
          const width = Math.max(right - left, 1.5);
          const top   = 4 + idx * 30;
          html += `<div class="route-bar" ` +
            `style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%;top:${top}px;background:${vehicle.color}" ` +
            `data-route-id="${route.id}" data-tip="${escAttr(buildTooltip(route, vehicle))}">` +
            `<span class="route-bar-text">${escHtml(buildBarLabel(route))}</span></div>`;
        });

        html += `<div class="add-route-hint">+</div></td>`;
      });

      html += '</tr>';
    });
  }

  html += '</tbody>';
  table.innerHTML = html;
  attachTableEvents(table);
}

function buildBarLabel(route) {
  if (route.from_location && route.to_location) return `${route.from_location} → ${route.to_location}`;
  if (route.from_location) return route.from_location;
  if (route.to_location)   return route.to_location;
  if (route.driver)        return route.driver;
  return `${route.start_time}–${route.end_time}`;
}

function buildTooltip(route, vehicle) {
  let t = `${vehicle.name}  ${route.start_time}–${route.end_time}`;
  if (route.from_location || route.to_location)
    t += `\n${route.from_location || '?'} → ${route.to_location || '?'}`;
  if (route.driver) t += `\nKierowca: ${route.driver}`;
  if (route.notes)  t += `\n${route.notes}`;
  return t;
}

// ── Time Legend ────────────────────────────────────────────────────────
function renderTimeLegend() {
  const el = document.getElementById('time-legend');
  let html = '<div class="time-legend-inner">';
  for (let h = DAY_START; h <= DAY_END; h += 2) {
    const pct = ((h - DAY_START) / (DAY_END - DAY_START)) * 100;
    html += `<span class="time-tick" style="left:${pct.toFixed(2)}%">${String(h).padStart(2,'0')}:00</span>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

// ── Real-time Indicator ────────────────────────────────────────────────
function updateTimeIndicator() {
  const indicator = document.getElementById('time-indicator');
  const label     = document.getElementById('time-indicator-label');
  const wrapper   = document.getElementById('calendar-wrapper');
  if (!indicator || !wrapper) return;

  const now      = new Date();
  const todayStr = formatDate(now);
  const days     = getWeekDays(state.weekStart);
  const dayIdx   = days.findIndex(d => formatDate(d) === todayStr);

  if (dayIdx === -1) { indicator.style.display = 'none'; return; }

  const nowMin      = now.getHours() * 60 + now.getMinutes();
  const dayStartMin = DAY_START * 60;
  const dayEndMin   = DAY_END   * 60;
  if (nowMin < dayStartMin || nowMin > dayEndMin) { indicator.style.display = 'none'; return; }

  const headerCells = wrapper.querySelectorAll('th.day-header-cell');
  if (!headerCells[dayIdx]) { indicator.style.display = 'none'; return; }

  const cellRect    = headerCells[dayIdx].getBoundingClientRect();
  const wrapperRect = wrapper.getBoundingClientRect();
  const fraction    = (nowMin - dayStartMin) / DAY_MINUTES;
  const xPx         = (cellRect.left - wrapperRect.left) + fraction * cellRect.width;

  indicator.style.display = 'block';
  indicator.style.left    = `${xPx.toFixed(1)}px`;
  label.textContent       = formatTime(now);
}

// ═══════════════════════════════════════════════════════════════════════
//  NOTIFICATION PANEL
// ═══════════════════════════════════════════════════════════════════════

function getNotifications() {
  const now      = new Date();
  const todayStr = formatDate(now);
  const nowMin   = now.getHours() * 60 + now.getMinutes();
  const alerts   = [];
  const infos    = [];

  state.vehicles.forEach(vehicle => {
    const todayRoutes   = state.routes.filter(r => r.vehicle_id === vehicle.id && r.date === todayStr);
    const currentStatus = state.statuses.find(s => s.vehicle_id === vehicle.id);

    // Route ending in ≤ 60 min (and hasn't ended yet)
    const endingSoon = todayRoutes.find(r => {
      const endMin = timeToMin(r.end_time);
      const diff   = endMin - nowMin;
      return diff > 0 && diff <= 60;
    });

    // Currently active route
    const activeRoute = todayRoutes.find(r =>
      nowMin >= timeToMin(r.start_time) && nowMin <= timeToMin(r.end_time)
    );

    if (endingSoon && !currentStatus) {
      const minsLeft = timeToMin(endingSoon.end_time) - nowMin;
      alerts.push({ type: 'ending_soon', vehicle, route: endingSoon, minsLeft });
    } else if (!activeRoute && !currentStatus) {
      // Only show "idle" during working hours (06:00–22:00)
      if (nowMin >= DAY_START * 60 && nowMin <= DAY_END * 60) {
        alerts.push({ type: 'idle', vehicle });
      }
    }

    if (currentStatus) {
      infos.push({ vehicle, status: currentStatus });
    }
  });

  return { alerts, infos };
}

function renderNotificationPanel() {
  const { alerts, infos } = getNotifications();
  const total = alerts.length;

  // Update bell badge
  const badge = document.getElementById('notif-badge');
  const bell  = document.getElementById('notif-bell');
  if (total > 0) {
    badge.textContent   = total;
    badge.style.display = 'flex';
    bell.classList.add('has-alerts');
    // Ring animation on new alerts
    bell.classList.remove('ringing');
    void bell.offsetWidth; // reflow
    bell.classList.add('ringing');
  } else {
    badge.style.display = 'none';
    bell.classList.remove('has-alerts');
  }

  // Build panel content
  const list = document.getElementById('notif-list');
  let html   = '';

  if (alerts.length === 0 && infos.length === 0) {
    html = `<div class="notif-empty">
      <span class="notif-empty-icon">✅</span>
      Wszystkie pojazdy mają przypisane statusy
    </div>`;
  } else {
    if (alerts.length > 0) {
      html += `<div class="notif-section-label">Wymaga uwagi</div>`;
      alerts.forEach(n => {
        const v = n.vehicle;
        html += `<div class="notif-item alert">`;
        html += `<div class="notif-item-top">`;
        html += `<span class="notif-vehicle-name" style="color:${v.color}">${escHtml(v.name)}</span>`;
        if (n.type === 'ending_soon') {
          const urgency = n.minsLeft <= 20 ? '' : ' mild';
          html += `<span class="notif-time-left${urgency}">za ${n.minsLeft} min</span>`;
        }
        html += `</div>`;

        if (n.type === 'ending_soon') {
          const routeDesc = buildBarLabel(n.route);
          html += `<div class="notif-desc">Kończy trasę <strong>${escHtml(routeDesc)}</strong><br>` +
            `${n.route.start_time} – ${n.route.end_time}</div>`;
        } else {
          html += `<div class="notif-desc">Brak aktywnej trasy. Co planujemy?</div>`;
        }

        html += `<button class="notif-action-btn" data-vehicle-id="${v.id}" data-action="set-status">` +
          `Ustaw status →</button>`;
        html += `</div>`;
      });
    }

    if (infos.length > 0) {
      html += `<div class="notif-section-label" style="margin-top:6px">Ustawione statusy</div>`;
      infos.forEach(n => {
        const v  = n.vehicle;
        const st = n.status;
        const si = STATUS_INFO[st.status] || { icon: '📝', label: st.status };
        const lbl = st.status === 'other' && st.note ? st.note : si.label;
        const setAt = new Date(st.set_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

        html += `<div class="notif-item info">` +
          `<div class="notif-info-row">` +
          `<div class="notif-info-left">` +
          `<span class="notif-info-icon">${si.icon}</span>` +
          `<div class="notif-info-text">` +
          `<div class="notif-info-name" style="color:${v.color}">${escHtml(v.name)}</div>` +
          `<div class="notif-info-status">${escHtml(lbl)} · ${setAt}</div>` +
          `</div></div>` +
          `<button class="notif-clear-btn" data-vehicle-id="${v.id}" data-action="clear-status">Usuń</button>` +
          `</div></div>`;
      });
    }
  }

  list.innerHTML = html;

  // Attach click events on notification buttons
  list.querySelectorAll('[data-action="set-status"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const vehicleId = parseInt(btn.dataset.vehicleId);
      const alert     = alerts.find(a => a.vehicle.id === vehicleId);
      openStatusModal(vehicleId, alert);
    });
  });

  list.querySelectorAll('[data-action="clear-status"]').forEach(btn => {
    btn.addEventListener('click', () => clearVehicleStatus(parseInt(btn.dataset.vehicleId)));
  });
}

// ── Notification bell toggle ───────────────────────────────────────────
function wireNotificationPanel() {
  const bell  = document.getElementById('notif-bell');
  const panel = document.getElementById('notif-panel');
  const close = document.getElementById('notif-panel-close');

  bell.addEventListener('click', () => {
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : 'flex';
  });

  close.addEventListener('click', () => { panel.style.display = 'none'; });
}

// ═══════════════════════════════════════════════════════════════════════
//  STATUS MODAL
// ═══════════════════════════════════════════════════════════════════════
let statusModalVehicleId = null;
let selectedStatus       = null;

function openStatusModal(vehicleId, alertData) {
  statusModalVehicleId = vehicleId;
  selectedStatus       = null;

  const vehicle = state.vehicles.find(v => v.id === vehicleId);
  const modal   = document.getElementById('status-modal');
  const titleEl = document.getElementById('status-modal-title');
  const ctx     = document.getElementById('status-modal-context');
  const noteGrp = document.getElementById('status-note-group');
  const saveBtn = document.getElementById('status-save-btn');
  const noteTA  = document.getElementById('status-note');

  titleEl.textContent = `Ustaw status: ${vehicle ? vehicle.name : ''}`;

  if (alertData && alertData.type === 'ending_soon') {
    ctx.textContent = `Trasa ${buildBarLabel(alertData.route)} kończy się za ${alertData.minsLeft} min (${alertData.route.end_time}). Co planujemy po zakończeniu?`;
    ctx.style.display = 'block';
  } else if (alertData && alertData.type === 'idle') {
    ctx.textContent = 'Pojazd nie ma aktywnej trasy. Co planujemy?';
    ctx.style.display = 'block';
  } else {
    ctx.style.display = 'none';
  }

  // Reset options
  document.querySelectorAll('.status-opt-btn').forEach(b => b.classList.remove('selected'));
  noteGrp.style.display  = 'none';
  saveBtn.style.display  = 'none';
  noteTA.value           = '';

  document.getElementById('status-vehicle-id').value = vehicleId;
  modal.style.display = 'flex';

  // Close notification panel
  document.getElementById('notif-panel').style.display = 'none';
}

function closeStatusModal() {
  document.getElementById('status-modal').style.display = 'none';
  statusModalVehicleId = null;
  selectedStatus       = null;
}

async function saveVehicleStatus() {
  if (!statusModalVehicleId || !selectedStatus) return;
  const note = document.getElementById('status-note').value.trim();
  if (selectedStatus === 'other' && !note) {
    document.getElementById('status-note').focus();
    return;
  }
  try {
    await api('POST', '/api/statuses', { vehicle_id: statusModalVehicleId, status: selectedStatus, note });
    closeStatusModal();
    await loadData();
  } catch (err) {
    alert('Błąd zapisu: ' + err.message);
  }
}

async function clearVehicleStatus(vehicleId) {
  try {
    await api('DELETE', `/api/statuses/${vehicleId}`);
    await loadData();
  } catch (err) {
    alert('Błąd: ' + err.message);
  }
}

function wireStatusModal() {
  // Status option buttons
  document.querySelectorAll('.status-opt-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.status-opt-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedStatus = btn.dataset.status;

      const noteGrp = document.getElementById('status-note-group');
      const saveBtn = document.getElementById('status-save-btn');

      if (selectedStatus === 'other') {
        noteGrp.style.display = 'block';
        saveBtn.style.display = 'inline-flex';
        document.getElementById('status-note').focus();
      } else {
        noteGrp.style.display = 'none';
        saveBtn.style.display = 'none';
        // Save immediately for non-"other" statuses
        await saveVehicleStatus();
      }
    });
  });

  document.getElementById('status-save-btn').addEventListener('click', saveVehicleStatus);
  document.getElementById('status-cancel-btn').addEventListener('click', closeStatusModal);
  document.getElementById('status-modal-close').addEventListener('click', closeStatusModal);
  document.getElementById('status-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeStatusModal();
  });
}

// ── Event Delegation ───────────────────────────────────────────────────
function attachTableEvents(table) {
  table.addEventListener('click', e => {
    const bar        = e.target.closest('.route-bar');
    const editBtn    = e.target.closest('.vehicle-edit-btn');
    const clearBtn   = e.target.closest('.status-clear');
    const cell       = e.target.closest('.route-cell');
    const nameCell   = e.target.closest('.vehicle-name-cell');

    if (bar) {
      e.stopPropagation();
      openRouteModal({ routeId: parseInt(bar.dataset.routeId) });
      return;
    }
    if (editBtn) {
      e.stopPropagation();
      openVehicleEditModal(parseInt(editBtn.dataset.vehicleId));
      return;
    }
    if (clearBtn) {
      e.stopPropagation();
      clearVehicleStatus(parseInt(clearBtn.dataset.vehicleId));
      return;
    }
    if (cell) {
      const vehicleId = parseInt(cell.dataset.vehicleId);
      const date      = cell.dataset.date;
      const rect      = cell.getBoundingClientRect();
      const fraction  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const clicked   = DAY_START * 60 + Math.round(fraction * DAY_MINUTES / 30) * 30;
      const startTime = minToTime(Math.min(clicked, (DAY_END - 1) * 60));
      const endTime   = minToTime(Math.min(clicked + 120, DAY_END * 60));
      openRouteModal({ vehicleId, date, startTime, endTime });
      return;
    }
    if (nameCell && !editBtn && !clearBtn) {
      openVehicleEditModal(parseInt(nameCell.dataset.vehicleId));
    }
  });

  // Tooltip
  table.addEventListener('mousemove', e => {
    const bar = e.target.closest('.route-bar');
    const tip = document.getElementById('tooltip');
    if (bar && bar.dataset.tip) {
      const lines = bar.dataset.tip.split('\n');
      const [title, ...rest] = lines;
      tip.innerHTML = `<div class="tooltip-title">${escHtml(title)}</div>` +
        rest.map(l => `<div class="tooltip-row">${escHtml(l)}</div>`).join('');
      tip.style.display = 'block';
      positionTooltip(tip, e);
    } else {
      tip.style.display = 'none';
    }
  });
  table.addEventListener('mouseleave', () => {
    document.getElementById('tooltip').style.display = 'none';
  });
}

function positionTooltip(tip, e) {
  const pad = 12;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + 270 > window.innerWidth)  x = e.clientX - 270 - pad;
  if (y + 150 > window.innerHeight) y = e.clientY - 150 - pad;
  tip.style.left = `${x}px`;
  tip.style.top  = `${y}px`;
}

// ═══════════════════════════════════════════════════════════════════════
//  ROUTE MODAL
// ═══════════════════════════════════════════════════════════════════════
let routeModalMode = 'add';

function openRouteModal({ routeId, vehicleId, date, startTime, endTime } = {}) {
  const modal  = document.getElementById('route-modal');
  const title  = document.getElementById('route-modal-title');
  const delBtn = document.getElementById('route-delete-btn');
  const sel    = document.getElementById('route-vehicle');

  sel.innerHTML = state.vehicles.map(v =>
    `<option value="${v.id}">${escHtml(v.name)}</option>`
  ).join('');

  if (routeId) {
    routeModalMode = 'edit';
    const route = state.routes.find(r => r.id === routeId);
    if (!route) return;
    title.textContent                             = 'Edytuj trasę';
    document.getElementById('route-id').value     = route.id;
    sel.value                                     = route.vehicle_id;
    document.getElementById('route-date').value   = route.date;
    document.getElementById('route-start').value  = route.start_time;
    document.getElementById('route-end').value    = route.end_time;
    document.getElementById('route-from').value   = route.from_location || '';
    document.getElementById('route-to').value     = route.to_location   || '';
    populateDriverSelect(route.driver || '');
    document.getElementById('route-notes').value  = route.notes         || '';
    delBtn.style.display = 'inline-flex';
  } else {
    routeModalMode = 'add';
    title.textContent                             = 'Dodaj trasę';
    document.getElementById('route-id').value     = '';
    if (vehicleId) sel.value                      = vehicleId;
    document.getElementById('route-date').value   = date      || formatDate(new Date());
    document.getElementById('route-start').value  = startTime || '08:00';
    document.getElementById('route-end').value    = endTime   || '16:00';
    document.getElementById('route-from').value   = '';
    document.getElementById('route-to').value     = '';
    populateDriverSelect('');
    document.getElementById('route-notes').value  = '';
    delBtn.style.display = 'none';
  }

  modal.style.display = 'flex';
}

function showRouteError(msg) {
  let box = document.getElementById('route-error-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'route-error-box';
    box.className = 'route-error-box';
    // Insert before the first form-row inside modal-body
    const body = document.querySelector('#route-modal .modal-body');
    body.insertBefore(box, body.firstChild);
  }
  box.textContent = msg;
  box.style.display = 'block';
}

function clearRouteError() {
  const box = document.getElementById('route-error-box');
  if (box) box.style.display = 'none';
}

async function saveRoute() {
  const id        = document.getElementById('route-id').value;
  const vehicleId = document.getElementById('route-vehicle').value;
  const date      = document.getElementById('route-date').value;
  const start     = document.getElementById('route-start').value;
  const end       = document.getElementById('route-end').value;

  clearRouteError();

  if (!vehicleId || !date || !start || !end) {
    showRouteError('Wypełnij wymagane pola: pojazd, data, godzina start i koniec.');
    return;
  }
  if (timeToMin(start) >= timeToMin(end)) {
    showRouteError('Godzina startu musi być wcześniejsza niż godzina końca trasy.');
    return;
  }

  const body = {
    vehicle_id: parseInt(vehicleId), date, start_time: start, end_time: end,
    from_location: document.getElementById('route-from').value.trim(),
    to_location:   document.getElementById('route-to').value.trim(),
    driver:        document.getElementById('route-driver').value.trim(),
    notes:         document.getElementById('route-notes').value.trim(),
  };

  try {
    if (routeModalMode === 'edit') await api('PUT', `/api/routes/${id}`, body);
    else                           await api('POST', '/api/routes', body);
    clearRouteError();
    closeRouteModal();
    await loadData();
  } catch (err) {
    // Try to parse JSON error body
    try {
      const parsed = JSON.parse(err.message);
      if (parsed.error === 'overlap') {
        showRouteError(`⚠ Konflikt godzin! ${parsed.message}`);
        return;
      }
    } catch (_) {}
    showRouteError('Błąd zapisu: ' + err.message);
  }
}

async function deleteRoute() {
  const id = document.getElementById('route-id').value;
  if (!id || !confirm('Czy na pewno usunąć tę trasę?')) return;
  try {
    await api('DELETE', `/api/routes/${id}`);
    closeRouteModal();
    await loadData();
  } catch (err) { alert('Błąd usuwania: ' + err.message); }
}

function closeRouteModal() {
  document.getElementById('route-modal').style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════════
//  VEHICLES MODALS
// ═══════════════════════════════════════════════════════════════════════
function openVehiclesModal() {
  renderVehiclesList();
  document.getElementById('vehicles-modal').style.display = 'flex';
}
function closeVehiclesModal() {
  document.getElementById('vehicles-modal').style.display = 'none';
}

function renderVehiclesList() {
  const list = document.getElementById('vehicles-list');
  if (!state.vehicles.length) {
    list.innerHTML = '<p style="color:#aaa;text-align:center;padding:20px">Brak pojazdów</p>';
    return;
  }
  list.innerHTML = state.vehicles.map(v => `
    <div class="vehicle-item">
      <div class="vehicle-item-left">
        <div class="vi-color" style="background:${v.color}"></div>
        <span class="vi-name" style="color:${v.color}">${escHtml(v.name)}</span>
      </div>
      <button class="btn-edit-sm" data-vehicle-id="${v.id}">✏ Edytuj</button>
    </div>`).join('');

  list.querySelectorAll('.btn-edit-sm').forEach(btn => {
    btn.addEventListener('click', () => {
      closeVehiclesModal();
      openVehicleEditModal(parseInt(btn.dataset.vehicleId));
    });
  });
}

function openVehicleEditModal(vehicleId) {
  const modal    = document.getElementById('vehicle-edit-modal');
  const title    = document.getElementById('vehicle-edit-title');
  const delBtn   = document.getElementById('vehicle-delete-btn');
  const idInp    = document.getElementById('vehicle-edit-id');
  const nameInp  = document.getElementById('vehicle-name');
  const colorInp = document.getElementById('vehicle-color');

  if (vehicleId) {
    const v = state.vehicles.find(x => x.id === vehicleId);
    if (!v) return;
    title.textContent    = 'Edytuj pojazd';
    idInp.value          = v.id;
    nameInp.value        = v.name;
    colorInp.value       = v.color;
    delBtn.style.display = 'inline-flex';
  } else {
    title.textContent    = 'Dodaj pojazd';
    idInp.value          = '';
    nameInp.value        = '';
    colorInp.value       = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];
    delBtn.style.display = 'none';
  }

  updateVehiclePreview();
  updateColorDots();
  modal.style.display = 'flex';
}

function closeVehicleEditModal() {
  document.getElementById('vehicle-edit-modal').style.display = 'none';
}

function updateVehiclePreview() {
  const name  = document.getElementById('vehicle-name').value || 'PODGLĄD';
  const color = document.getElementById('vehicle-color').value;
  document.getElementById('vehicle-preview-name').textContent = name;
  document.getElementById('vehicle-preview-name').style.color = color;
  document.getElementById('vehicle-preview-bar').style.background = color;
}

function updateColorDots() {
  const current = document.getElementById('vehicle-color').value.toLowerCase();
  document.querySelectorAll('.color-dot').forEach(dot => {
    dot.classList.toggle('active', dot.dataset.color.toLowerCase() === current);
  });
}

async function saveVehicle() {
  const id    = document.getElementById('vehicle-edit-id').value;
  const name  = document.getElementById('vehicle-name').value.trim();
  const color = document.getElementById('vehicle-color').value;
  if (!name) { alert('Podaj nazwę / numer rejestracyjny pojazdu.'); return; }
  try {
    if (id) await api('PUT', `/api/vehicles/${id}`, { name, color });
    else    await api('POST', '/api/vehicles', { name, color });
    closeVehicleEditModal();
    await loadData();
  } catch (err) { alert('Błąd zapisu: ' + err.message); }
}

async function deleteVehicle() {
  const id   = document.getElementById('vehicle-edit-id').value;
  const name = document.getElementById('vehicle-name').value;
  if (!id || !confirm(`Czy na pewno usunąć pojazd "${name}"?\nWszystkie trasy tego pojazdu zostaną usunięte.`)) return;
  try {
    await api('DELETE', `/api/vehicles/${id}`);
    closeVehicleEditModal();
    await loadData();
  } catch (err) { alert('Błąd usuwania: ' + err.message); }
}

// ═══════════════════════════════════════════════════════════════════════
//  DRIVERS MODULE
// ═══════════════════════════════════════════════════════════════════════

function populateDriverSelect(selectedDriver = '') {
  const sel = document.getElementById('route-driver');
  if (!sel) return;

  let html = '<option value="">— brak kierowcy —</option>';
  state.drivers.forEach(d => {
    const sel_ = d.name === selectedDriver ? ' selected' : '';
    html += `<option value="${escHtml(d.name)}"${sel_}>${escHtml(d.name)}</option>`;
  });

  // If saved driver is not on the list (e.g. was deleted or typed manually before)
  if (selectedDriver && !state.drivers.find(d => d.name === selectedDriver)) {
    html += `<option value="${escHtml(selectedDriver)}" selected>${escHtml(selectedDriver)}</option>`;
  }

  sel.innerHTML = html;
}

function openDriversModal() {
  renderDriversList();
  document.getElementById('new-driver-name').value = '';
  hideDriverError();
  document.getElementById('drivers-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('new-driver-name').focus(), 80);
}

function closeDriversModal() {
  document.getElementById('drivers-modal').style.display = 'none';
}

function renderDriversList() {
  const list = document.getElementById('drivers-list');
  if (state.drivers.length === 0) {
    list.innerHTML = '<div class="drivers-empty">Brak kierowców. Dodaj pierwszego kierowcę powyżej.</div>';
    return;
  }
  list.innerHTML = state.drivers.map(d => `
    <div class="driver-item">
      <span class="driver-item-name">${escHtml(d.name)}</span>
      <button class="driver-delete-btn" data-driver-id="${d.id}" title="Usuń kierowcę">Usuń</button>
    </div>
  `).join('');

  list.querySelectorAll('.driver-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteDriver(parseInt(btn.dataset.driverId)));
  });
}

function showDriverError(msg) {
  const el = document.getElementById('driver-add-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideDriverError() {
  document.getElementById('driver-add-error').style.display = 'none';
}

async function addDriver() {
  const input = document.getElementById('new-driver-name');
  const name  = input.value.trim();
  if (!name) { showDriverError('Wpisz imię i nazwisko kierowcy.'); input.focus(); return; }
  hideDriverError();
  try {
    await api('POST', '/api/drivers', { name });
    input.value = '';
    input.focus();
    // Refresh drivers list without full reload
    state.drivers = await api('GET', '/api/drivers');
    renderDriversList();
  } catch (err) {
    try {
      const parsed = JSON.parse(err.message);
      showDriverError(parsed.error || err.message);
    } catch (_) { showDriverError(err.message); }
  }
}

async function deleteDriver(id) {
  const driver = state.drivers.find(d => d.id === id);
  if (!driver) return;
  if (!confirm(`Czy na pewno usunąć kierowcę "${driver.name}"?`)) return;
  try {
    await api('DELETE', `/api/drivers/${id}`);
    state.drivers = await api('GET', '/api/drivers');
    renderDriversList();
  } catch (err) {
    showDriverError('Błąd usuwania: ' + err.message);
  }
}

function wireDriversModal() {
  document.getElementById('manage-drivers-btn').addEventListener('click', openDriversModal);
  document.getElementById('drivers-modal-close').addEventListener('click', closeDriversModal);
  document.getElementById('drivers-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeDriversModal();
  });
  document.getElementById('driver-add-btn').addEventListener('click', addDriver);
  document.getElementById('new-driver-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') addDriver();
  });
}

// ── Color Presets ──────────────────────────────────────────────────────
function buildColorPresets() {
  const container = document.getElementById('color-presets');
  container.innerHTML = PRESET_COLORS.map(c =>
    `<div class="color-dot" data-color="${c}" style="background:${c}" title="${c}"></div>`
  ).join('');
  container.querySelectorAll('.color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      document.getElementById('vehicle-color').value = dot.dataset.color;
      updateVehiclePreview();
      updateColorDots();
    });
  });
}

// ── Escape helpers ─────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  return escHtml(s).replace(/\n/g,'&#10;');
}

// ── Wire up all static buttons ─────────────────────────────────────────
function wireStaticButtons() {
  document.getElementById('prev-week').addEventListener('click', () => {
    state.weekStart = new Date(state.weekStart);
    state.weekStart.setDate(state.weekStart.getDate() - 7);
    loadData();
  });
  document.getElementById('next-week').addEventListener('click', () => {
    state.weekStart = new Date(state.weekStart);
    state.weekStart.setDate(state.weekStart.getDate() + 7);
    loadData();
  });
  document.getElementById('today-btn').addEventListener('click', () => {
    state.weekStart = getWeekStart(new Date());
    loadData();
  });

  document.getElementById('manage-vehicles-btn').addEventListener('click', openVehiclesModal);

  document.getElementById('vehicles-modal-close').addEventListener('click', closeVehiclesModal);
  document.getElementById('add-vehicle-btn').addEventListener('click', () => { closeVehiclesModal(); openVehicleEditModal(null); });
  document.getElementById('vehicles-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeVehiclesModal(); });

  document.getElementById('route-modal-close').addEventListener('click', closeRouteModal);
  document.getElementById('route-cancel-btn').addEventListener('click', closeRouteModal);
  document.getElementById('route-save-btn').addEventListener('click', saveRoute);
  document.getElementById('route-delete-btn').addEventListener('click', deleteRoute);
  document.getElementById('route-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeRouteModal(); });

  document.getElementById('vehicle-edit-close').addEventListener('click', closeVehicleEditModal);
  document.getElementById('vehicle-cancel-btn').addEventListener('click', closeVehicleEditModal);
  document.getElementById('vehicle-save-btn').addEventListener('click', saveVehicle);
  document.getElementById('vehicle-delete-btn').addEventListener('click', deleteVehicle);
  document.getElementById('vehicle-edit-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeVehicleEditModal(); });

  document.getElementById('vehicle-name').addEventListener('input', updateVehiclePreview);
  document.getElementById('vehicle-color').addEventListener('input', () => { updateVehiclePreview(); updateColorDots(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeRouteModal(); closeVehiclesModal(); closeVehicleEditModal(); closeStatusModal(); closeDriversModal(); }
  });
}

// ── Init ───────────────────────────────────────────────────────────────
async function init() {
  buildColorPresets();
  wireStaticButtons();
  wireNotificationPanel();
  wireStatusModal();
  wireDriversModal();
  await loadData();

  // Refresh every 60 seconds: time indicator + notifications
  setInterval(() => { updateTimeIndicator(); renderNotificationPanel(); }, 60_000);
  window.addEventListener('resize', updateTimeIndicator);
}

document.addEventListener('DOMContentLoaded', init);
