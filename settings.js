'use strict';

// Settings module — cog panel, OAuth connect, calendar toggles.
// Depends on: Auth, Api, Calendar
// Exposes: init(), loadCalendarList()
const Settings = (() => {
  let isOpen = false;

  // ── Panel open / close ────────────────────────────────────────────────────

  function open() {
    isOpen = true;
    document.getElementById('settings-panel').classList.remove('hidden');
    document.getElementById('settings-overlay').classList.remove('hidden');

    // Pre-populate client ID field from storage.
    const stored = Auth.getClientId();
    if (stored) document.getElementById('client-id-input').value = stored;

    // Load calendar list if we already have a token.
    loadCalendarList();
  }

  function close() {
    isOpen = false;
    document.getElementById('settings-panel').classList.add('hidden');
    document.getElementById('settings-overlay').classList.add('hidden');
  }

  function toggle() {
    isOpen ? close() : open();
  }

  // ── Connect button ────────────────────────────────────────────────────────

  async function _handleConnect() {
    const clientId = document.getElementById('client-id-input').value.trim();
    if (!clientId) {
      _showMessage('Please enter your OAuth Client ID.', 'error');
      return;
    }

    const btn = document.getElementById('connect-btn');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    _showMessage('');

    try {
      await Auth.connect(clientId);
      _showMessage('Connected successfully.', 'success');
      btn.textContent = 'Reconnect Google Calendar';
      btn.disabled = false;

      // Refresh the main view and populate the calendar list.
      Calendar.refresh();
      loadCalendarList();
    } catch (err) {
      _showMessage(`Connection failed: ${err.message}`, 'error');
      btn.textContent = 'Connect Google Calendar';
      btn.disabled = false;
    }
  }

  function _showMessage(msg, type = '') {
    const el = document.getElementById('settings-message');
    el.textContent = msg;
    el.className = 'settings-message' + (type ? ` ${type}` : '');
  }

  // ── Calendar list ─────────────────────────────────────────────────────────

  async function loadCalendarList() {
    const container = document.getElementById('calendar-list');

    // Silently skip if not authenticated yet.
    const token = await Auth.getToken();
    if (!token) return;

    try {
      const calendars = await Api.fetchCalendars();
      _renderCalendarList(container, calendars);
    } catch (_) {
      // Not critical — the list will repopulate on next open.
    }
  }

  function _renderCalendarList(container, calendars) {
    const hidden = JSON.parse(localStorage.getItem('wallcal_hidden') || '[]');
    container.innerHTML = '';

    if (calendars.length === 0) {
      container.innerHTML = '<p class="settings-hint">No calendars found.</p>';
      return;
    }

    for (const cal of calendars) {
      const item = document.createElement('div');
      item.className = 'calendar-item';

      const dot = document.createElement('span');
      dot.className = 'calendar-dot';
      dot.style.backgroundColor = cal.backgroundColor || '#4285f4';

      const name = document.createElement('span');
      name.className = 'calendar-name';
      name.textContent = cal.summary;
      name.title = cal.summary;

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.className = 'calendar-toggle';
      toggle.checked = !hidden.includes(cal.id);
      toggle.setAttribute('aria-label', `Show ${cal.summary}`);
      toggle.addEventListener('change', () => _toggleCalendar(cal.id, toggle.checked));

      item.append(dot, name, toggle);
      container.appendChild(item);
    }
  }

  function _toggleCalendar(calId, visible) {
    let hidden = JSON.parse(localStorage.getItem('wallcal_hidden') || '[]');
    if (visible) {
      hidden = hidden.filter((id) => id !== calId);
    } else {
      if (!hidden.includes(calId)) hidden.push(calId);
    }
    localStorage.setItem('wallcal_hidden', JSON.stringify(hidden));
    Calendar.refresh();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    document.getElementById('settings-btn').addEventListener('click', toggle);
    document.getElementById('settings-close').addEventListener('click', close);
    document.getElementById('settings-overlay').addEventListener('click', close);
    document.getElementById('connect-btn').addEventListener('click', _handleConnect);

    // Kick off the initial calendar render.
    if (Auth.getClientId()) {
      Calendar.refresh();
    } else {
      Calendar.showUnauthenticated();
    }

    // Auto-refresh every 10 minutes.
    setInterval(Calendar.refresh, 10 * 60 * 1000);
  }

  return { init, loadCalendarList };
})();

// Boot.
Settings.init();
