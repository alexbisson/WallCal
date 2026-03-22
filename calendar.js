'use strict';

// Calendar module — rendering logic only.
// Depends on: Auth, Api
// Exposes: refresh(), showUnauthenticated(), getWindow()
const Calendar = (() => {
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH_EMOJI = ['❄️', '❤️', '🌱', '🌸', '🌼', '☀️', '🏖️', '🌻', '🍂', '🎃', '🍁', '🎄'];
  const MAX_VISIBLE = 3; // event chips shown per cell before overflow indicator

  // ── Date helpers ──────────────────────────────────────────────────────────

  // Returns { start, end } for the rolling 5-week window.
  // start = Sunday of the current week (may be in the past).
  // end   = Sunday of week 6 (exclusive upper bound; last visible day is Sat week 5).
  function getWindow() {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay()); // back to Sunday
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 35);
    return { start, end };
  }

  // Returns "YYYY-MM-DD" in local time — used as a map key for event placement.
  function _localDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // ── Event mapping ─────────────────────────────────────────────────────────

  // Builds a map of { "YYYY-MM-DD": [event, …] } for fast day-cell lookup.
  // All-day events are placed on every day they span.
  // Timed events are placed on their start day only.
  // Within each day, all-day events sort before timed events (then by time).
  function _buildEventMap(events) {
    const map = {};

    for (const event of events) {
      if (event.start.date) {
        // All-day event. end.date is exclusive per the API spec.
        const [sy, sm, sd] = event.start.date.split('-').map(Number);
        const [ey, em, ed] = event.end.date.split('-').map(Number);
        const startDate = new Date(sy, sm - 1, sd);
        const endDate   = new Date(ey, em - 1, ed); // exclusive

        let cur = new Date(startDate);
        while (cur < endDate) {
          const key = _localDateKey(cur);
          (map[key] = map[key] || []).push({
            ...event,
            _isAllDay: true,
            _sortKey: '0' + event.start.date, // all-day sorts first, then by date
          });
          cur.setDate(cur.getDate() + 1);
        }
      } else {
        // Timed event — placed on start day only.
        const startDate = new Date(event.start.dateTime);
        const key = _localDateKey(startDate);
        (map[key] = map[key] || []).push({
          ...event,
          _isAllDay: false,
          _sortKey: '1' + event.start.dateTime, // timed sorts after all-day
          _timeStr: String(startDate.getHours()).padStart(2, '0') + ':'
                  + String(startDate.getMinutes()).padStart(2, '0'),
        });
      }
    }

    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => a._sortKey.localeCompare(b._sortKey));
    }

    return map;
  }

  // ── DOM construction ──────────────────────────────────────────────────────

  function _buildHeader() {
    const header = document.createElement('div');
    header.className = 'grid-header';
    for (const name of DAY_NAMES) {
      const cell = document.createElement('div');
      cell.className = 'header-cell';
      cell.textContent = name;
      header.appendChild(cell);
    }
    return header;
  }

  function _buildEventChip(event) {
    const chip = document.createElement('div');

    if (event._isAllDay) {
      chip.className = 'event-chip all-day';
      chip.style.backgroundColor = event._bgColor;
      chip.style.color = event._fgColor;
    } else {
      chip.className = 'event-chip timed';

      const dot = document.createElement('span');
      dot.className = 'event-dot';
      dot.style.backgroundColor = event._bgColor;
      chip.appendChild(dot);

      const timeSpan = document.createElement('span');
      timeSpan.className = 'event-time';
      timeSpan.textContent = event._timeStr;
      chip.appendChild(timeSpan);
    }

    const titleSpan = document.createElement('span');
    titleSpan.className = 'event-title';
    titleSpan.textContent = event.summary || '(No title)';
    chip.appendChild(titleSpan);

    return chip;
  }

  function _buildDayCell(date, dayEvents, todayKey) {
    const key = _localDateKey(date);
    const cell = document.createElement('div');
    cell.className = 'day-cell';
    if (date.getDay() === 0) cell.classList.add('sunday');
    if (key === todayKey)    cell.classList.add('today');
    if (key < todayKey)      cell.classList.add('past');

    const dateNum = document.createElement('span');
    dateNum.className = 'date-number';
    dateNum.textContent = date.getDate();
    cell.appendChild(dateNum);

    const visible = dayEvents.slice(0, MAX_VISIBLE);
    const overflowCount = dayEvents.length - MAX_VISIBLE;

    for (const event of visible) {
      cell.appendChild(_buildEventChip(event));
    }

    if (overflowCount > 0) {
      const more = document.createElement('div');
      more.className = 'overflow-indicator';
      more.textContent = `+${overflowCount} more`;
      cell.appendChild(more);
    }

    return cell;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function _render(events) {
    const { start } = getWindow();
    const eventMap = _buildEventMap(events);
    const todayKey = _localDateKey(new Date());

    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';
    grid.appendChild(_buildHeader());

    const body = document.createElement('div');
    body.className = 'grid-body';

    let cur = new Date(start);
    for (let week = 0; week < 5; week++) {
      const row = document.createElement('div');
      row.className = 'grid-row';
      for (let dow = 0; dow < 7; dow++) {
        const dayEvents = eventMap[_localDateKey(cur)] || [];
        row.appendChild(_buildDayCell(cur, dayEvents, todayKey));
        cur.setDate(cur.getDate() + 1);
      }
      body.appendChild(row);
    }

    grid.appendChild(body);
    _updateMonthLabel(start);
  }

  function _updateMonthLabel(start) {
    const lastDay = new Date(start);
    lastDay.setDate(start.getDate() + 34); // last visible Saturday

    const label = document.getElementById('month-label');
    const sameYear  = start.getFullYear() === lastDay.getFullYear();
    const sameMonth = sameYear && start.getMonth() === lastDay.getMonth();

    const emoji = MONTH_EMOJI[start.getMonth()];

    if (sameMonth) {
      label.textContent = emoji + ' ' + start.toLocaleString('default', { month: 'long', year: 'numeric' });
    } else if (sameYear) {
      label.textContent = emoji + ' ' +
        start.toLocaleString('default', { month: 'long' }) +
        ' – ' +
        lastDay.toLocaleString('default', { month: 'long', year: 'numeric' });
    } else {
      label.textContent = emoji + ' ' +
        start.toLocaleString('default', { month: 'long', year: 'numeric' }) +
        ' – ' +
        lastDay.toLocaleString('default', { month: 'long', year: 'numeric' });
    }
  }

  function _setStatus(msg) {
    document.getElementById('status-bar').textContent = msg;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function showUnauthenticated() {
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '<div class="auth-prompt">Open settings ⚙ to connect Google Calendar.</div>';
    document.getElementById('month-label').textContent = '';
    _setStatus('');
  }

  async function refresh() {
    _setStatus('Refreshing…');
    try {
      const [calendars, colorsResponse] = await Promise.all([
        Api.fetchCalendars(),
        Api.fetchColors().catch(() => null), // colors are optional; fall back gracefully
      ]);

      const { start, end } = getWindow();
      const eventColorMap = colorsResponse ? colorsResponse.event : {};
      const events = await Api.fetchAllEvents(calendars, start, end, eventColorMap);

      _render(events);
      _setStatus(`Updated ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      if (err.code === 'not_authenticated') {
        showUnauthenticated();
      } else if (err.code === 'token_expired') {
        _setStatus('Session expired — open settings ⚙ to reconnect.');
      } else {
        console.error('Calendar refresh error:', err);
        _setStatus(`Refresh failed at ${new Date().toLocaleTimeString()} — retrying in 10 min`);
      }
    }
  }

  return { refresh, showUnauthenticated, getWindow };
})();
