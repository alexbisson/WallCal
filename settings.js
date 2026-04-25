'use strict';

// Settings module — cog panel, OAuth connect, calendar toggles, appearance, night blackout.
// Depends on: Auth, Api, Calendar
// Exposes: init(), loadCalendarList()
const Settings = (() => {
  const BLACKOUT_KEY         = 'wallcal_blackout';
  const THEME_KEY            = 'wallcal_theme';
  const LOCATION_KEY         = 'wallcal_location';
  const FONTSIZE_KEY         = 'wallcal_fontsize';
  const TASKS_LIST_KEY       = 'wallcal_tasks_list';
  const REMINDER_WINDOW_KEY  = 'wallcal_reminder_window';
  const STOCKS_KEY           = 'wallcal_stocks';
  const FINNHUB_KEY          = 'wallcal_finnhub_key';
  const FONT_DEFAULT   = 14;
  const FONT_MIN       = 10;
  const FONT_MAX       = 22;
  let isOpen = false;

  // ── Panel open / close ────────────────────────────────────────────────────

  function open() {
    isOpen = true;
    // Hide blackout while settings is open so controls remain accessible.
    document.getElementById('blackout').classList.add('hidden');
    document.getElementById('settings-panel').classList.remove('hidden');
    document.getElementById('settings-overlay').classList.remove('hidden');

    // Pre-populate credential fields from storage.
    const stored = Auth.getClientId();
    if (stored) document.getElementById('client-id-input').value = stored;
    const secret = Auth.getClientSecret();
    if (secret) document.getElementById('client-secret-input').value = secret;

    // Show the redirect URI the user needs to register in Google Cloud Console.
    document.getElementById('redirect-uri-display').textContent =
      window.location.origin + window.location.pathname.replace(/\/+$/, '');

    // Load calendar and task lists if we already have a token.
    loadCalendarList();
    loadTaskListOptions();
  }

  function close() {
    isOpen = false;
    document.getElementById('settings-panel').classList.add('hidden');
    document.getElementById('settings-overlay').classList.add('hidden');
    // Re-evaluate blackout after settings closes.
    _applyBlackout();
  }

  function toggle() {
    isOpen ? close() : open();
  }

  // ── Connect button ────────────────────────────────────────────────────────

  async function _handleConnect() {
    const clientId     = document.getElementById('client-id-input').value.trim();
    const clientSecret = document.getElementById('client-secret-input').value.trim();
    if (!clientId) {
      _showMessage('Please enter your OAuth Client ID.', 'error');
      return;
    }

    const btn = document.getElementById('connect-btn');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    _showMessage('');

    try {
      await Auth.connect(clientId, clientSecret);
      _showMessage('Connected successfully.', 'success');
      btn.textContent = 'Reconnect Google';
      btn.disabled = false;

      // Refresh the main view and populate the calendar and task lists.
      Calendar.refresh();
      loadCalendarList();
      loadTaskListOptions();
    } catch (err) {
      const msg = err.code === 'popup_blocked'
        ? 'Popup blocked — please allow popups for this page and try again.'
        : `Connection failed: ${err.message}`;
      _showMessage(msg, 'error');
      btn.textContent = 'Connect Google';
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
      _appendTasksToggle(container);
    } catch (_) {
      // Not critical — the list will repopulate on next open.
    }
  }

  function _appendTasksToggle(container) {
    const item = document.createElement('div');
    item.className = 'calendar-item';

    const dot = document.createElement('span');
    dot.className = 'calendar-dot';
    dot.style.backgroundColor = '#d50000';

    const name = document.createElement('span');
    name.className = 'calendar-name';
    name.textContent = 'Tasks';
    name.title = 'Tasks (due dates)';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'calendar-toggle';
    toggle.checked = localStorage.getItem('wallcal_show_tasks') === 'true';
    toggle.setAttribute('aria-label', 'Show Tasks');
    toggle.addEventListener('change', () => {
      localStorage.setItem('wallcal_show_tasks', String(toggle.checked));
      Calendar.refresh();
    });

    item.append(dot, name, toggle);
    container.appendChild(item);
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

  // ── Task list selector ────────────────────────────────────────────────────

  async function loadTaskListOptions() {
    const container = document.getElementById('task-list-container');
    const token = await Auth.getToken();
    if (!token) return;

    try {
      const lists = await Api.fetchTaskLists();
      if (lists.length === 0) {
        container.innerHTML = '<p class="settings-hint">No task lists found.</p>';
        return;
      }

      const saved = localStorage.getItem(TASKS_LIST_KEY) || '';

      const wrap = document.createElement('div');
      wrap.className = 'field-group';

      const label = document.createElement('label');
      label.htmlFor = 'task-list-select';
      label.textContent = 'Show list';

      const select = document.createElement('select');
      select.id = 'task-list-select';
      select.className = 'settings-select';

      const none = document.createElement('option');
      none.value = '';
      none.textContent = '— None —';
      none.selected = !saved;
      select.appendChild(none);

      for (const list of lists) {
        const opt = document.createElement('option');
        opt.value = list.id;
        opt.textContent = list.title;
        opt.selected = list.id === saved;
        select.appendChild(opt);
      }

      select.addEventListener('change', () => {
        if (select.value) {
          localStorage.setItem(TASKS_LIST_KEY, select.value);
        } else {
          localStorage.removeItem(TASKS_LIST_KEY);
        }
        Panel.refreshTasks();
      });

      wrap.append(label, select);
      container.innerHTML = '';
      container.appendChild(wrap);
    } catch (_) {
      // Not critical — repopulates on next open.
    }
  }

  // ── Weather location ──────────────────────────────────────────────────────

  function _initWeatherControls() {
    const hint        = document.getElementById('weather-location-hint');
    const input       = document.getElementById('city-search');
    const suggestions = document.getElementById('city-suggestions');
    const cached      = JSON.parse(localStorage.getItem(LOCATION_KEY) || 'null');

    function _setLocation(loc) {
      localStorage.setItem(LOCATION_KEY, JSON.stringify(loc));
      hint.textContent = `Showing weather for ${loc.city}.`;
      input.value = loc.city;
      Panel.refreshWeather();
      _updateAutoThemeAvailability();
      _applyTheme();
    }

    hint.textContent = cached?.city
      ? `Showing weather for ${cached.city}.`
      : 'Search for your city to show weather.';
    input.value = cached?.city || '';

    // City autocomplete
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      suggestions.innerHTML = '';
      if (q.length < 2) { suggestions.classList.add('hidden'); return; }

      const matches = CITIES.filter(([name, country]) =>
        name.toLowerCase().includes(q) || country.toLowerCase().includes(q)
      ).sort(([a], [b]) => {
        const al = a.toLowerCase(), bl = b.toLowerCase();
        if (al.startsWith(q) && !bl.startsWith(q)) return -1;
        if (!al.startsWith(q) && bl.startsWith(q)) return 1;
        return a.localeCompare(b);
      }).slice(0, 7);

      if (!matches.length) { suggestions.classList.add('hidden'); return; }

      matches.forEach(([name, country, lat, lng]) => {
        const li = document.createElement('li');
        li.textContent = `${name}, ${country}`;
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          suggestions.classList.add('hidden');
          _setLocation({ lat, lng, city: `${name}, ${country}` });
        });
        suggestions.appendChild(li);
      });
      suggestions.classList.remove('hidden');
    });

    input.addEventListener('blur', () => {
      setTimeout(() => suggestions.classList.add('hidden'), 150);
    });

    input.addEventListener('keydown', (e) => {
      const items = suggestions.querySelectorAll('li');
      const active = suggestions.querySelector('li.active');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = active ? active.nextElementSibling : items[0];
        if (active) active.classList.remove('active');
        if (next) next.classList.add('active');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = active ? active.previousElementSibling : items[items.length - 1];
        if (active) active.classList.remove('active');
        if (prev) prev.classList.add('active');
      } else if (e.key === 'Enter' && active) {
        e.preventDefault();
        active.dispatchEvent(new MouseEvent('mousedown'));
      } else if (e.key === 'Escape') {
        suggestions.classList.add('hidden');
      }
    });
  }

  // ── Night Blackout ────────────────────────────────────────────────────────

  function _loadBlackoutSettings() {
    try {
      return JSON.parse(localStorage.getItem(BLACKOUT_KEY)) || {};
    } catch (_) { return {}; }
  }

  function _saveBlackoutSettings(settings) {
    localStorage.setItem(BLACKOUT_KEY, JSON.stringify(settings));
  }

  function _currentTimeStr() {
    const now = new Date();
    return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  }

  function _isInBlackoutWindow(from, to) {
    const now = _currentTimeStr();
    // Handle ranges that span midnight (e.g. 22:00–06:00).
    return from <= to ? (now >= from && now < to) : (now >= from || now < to);
  }

  function _applyBlackout() {
    if (isOpen) return; // Never cover the settings panel.
    const { enabled, from, to } = _loadBlackoutSettings();
    const active = enabled && from && to && _isInBlackoutWindow(from, to);
    document.getElementById('blackout').classList.toggle('hidden', !active);
  }

  function _initBlackoutControls() {
    const { enabled, from, to } = _loadBlackoutSettings();
    const checkbox = document.getElementById('blackout-enabled');
    const timesDiv = document.getElementById('blackout-times');

    checkbox.checked = !!enabled;
    if (from) document.getElementById('blackout-from').value = from;
    if (to)   document.getElementById('blackout-to').value   = to;
    timesDiv.classList.toggle('hidden', !enabled);

    // Only toggle the time-input row — actual saving happens via the Save button.
    checkbox.addEventListener('change', () => {
      timesDiv.classList.toggle('hidden', !checkbox.checked);
    });
  }

  function _showSaveMessage(msg, type = '') {
    const el = document.getElementById('save-message');
    el.textContent = msg;
    el.className = 'settings-message' + (type ? ` ${type}` : '');
  }

  function _handleSave() {
    const enabled = document.getElementById('blackout-enabled').checked;
    const from    = document.getElementById('blackout-from').value.trim();
    const to      = document.getElementById('blackout-to').value.trim();
    const timeRe  = /^([01]\d|2[0-3]):[0-5]\d$/;

    if (enabled) {
      if (!from || !to) {
        _showSaveMessage('Enter both From and To times.', 'error');
        return;
      }
      if (!timeRe.test(from) || !timeRe.test(to)) {
        _showSaveMessage('Use HH:MM format (e.g. 22:00).', 'error');
        return;
      }
      if (from === to) {
        _showSaveMessage('From and To cannot be the same time.', 'error');
        return;
      }
    }

    _saveBlackoutSettings({ enabled, from, to });
    _showSaveMessage('Settings saved.', 'success');
    _applyBlackout();
  }

  // ── Reminder window ───────────────────────────────────────────────────────

  function getReminderWindow() {
    return localStorage.getItem(REMINDER_WINDOW_KEY) || '30';
  }

  function _initReminderWindowControls() {
    const select = document.getElementById('reminder-window-select');
    select.value = getReminderWindow();
    select.addEventListener('change', () => {
      localStorage.setItem(REMINDER_WINDOW_KEY, select.value);
      Panel.refreshTasks();
    });
  }

  // ── Font Size ─────────────────────────────────────────────────────────────

  function _initFontSizeControls() {
    let size = parseInt(localStorage.getItem(FONTSIZE_KEY), 10) || FONT_DEFAULT;

    function apply() {
      document.getElementById('calendar-grid').style.fontSize = size + 'px';
      document.getElementById('panel-tasks').style.fontSize = size + 'px';
      document.getElementById('font-size-label').textContent = size + 'px';
      document.getElementById('font-decrease').disabled = size <= FONT_MIN;
      document.getElementById('font-increase').disabled = size >= FONT_MAX;
    }

    apply();

    document.getElementById('font-decrease').addEventListener('click', () => {
      if (size <= FONT_MIN) return;
      size -= 1;
      localStorage.setItem(FONTSIZE_KEY, size);
      apply();
    });

    document.getElementById('font-increase').addEventListener('click', () => {
      if (size >= FONT_MAX) return;
      size += 1;
      localStorage.setItem(FONTSIZE_KEY, size);
      apply();
    });
  }

  // ── Appearance / Theme ────────────────────────────────────────────────────

  function _loadTheme() {
    return localStorage.getItem(THEME_KEY) || 'dark';
  }

  function _saveTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
  }

  // USNO sunrise/sunset algorithm — accurate to ~1 minute.
  // Returns { sunrise, sunset } as Date objects for today, or null values on polar day/night.
  function _sunTimes(lat, lng) {
    const toRad = Math.PI / 180;
    const now = new Date();
    const Y = now.getFullYear(), Mo = now.getMonth() + 1, D = now.getDate();

    // Approximate day-of-year
    const N = Math.floor(275 * Mo / 9)
            - Math.floor((Mo + 9) / 12) * (1 + Math.floor((Y - 4 * Math.floor(Y / 4) + 2) / 3))
            + D - 30;

    const lnghour = lng / 15;

    function calc(rising) {
      const t    = N + ((rising ? 6 : 18) - lnghour) / 24;
      const Mrad = (0.9856 * t - 3.289) * toRad;

      let L = (Mrad / toRad) + 1.916 * Math.sin(Mrad) + 0.020 * Math.sin(2 * Mrad) + 282.634;
      L = ((L % 360) + 360) % 360;
      const Lrad = L * toRad;

      let RA = Math.atan(0.91764 * Math.tan(Lrad)) / toRad;
      RA = ((RA % 360) + 360) % 360;
      RA = (RA + Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90) / 15;

      const sinDec = 0.39782 * Math.sin(Lrad);
      const cosDec = Math.cos(Math.asin(sinDec));
      const cosH   = (Math.cos(90.833 * toRad) - sinDec * Math.sin(lat * toRad))
                   / (cosDec * Math.cos(lat * toRad));

      if (cosH < -1 || cosH > 1) return null; // polar day / polar night

      const H  = (rising ? 360 - Math.acos(cosH) / toRad : Math.acos(cosH) / toRad) / 15;
      const UT = ((H + RA - 0.06571 * t - 6.622 - lnghour) % 24 + 24) % 24;

      const d = new Date(Date.UTC(Y, Mo - 1, D));
      d.setUTCMinutes(Math.round(UT * 60));
      return d;
    }

    return { sunrise: calc(true), sunset: calc(false) };
  }

  function _applyTheme() {
    const theme = _loadTheme();
    if (theme !== 'auto') {
      document.documentElement.setAttribute('data-theme', theme);
      return;
    }
    const loc = JSON.parse(localStorage.getItem(LOCATION_KEY) || 'null');
    if (!loc) {
      document.documentElement.setAttribute('data-theme', 'dark');
      return;
    }
    const { sunrise, sunset } = _sunTimes(loc.lat, loc.lng);
    const now    = new Date();
    const isDark = !sunrise || !sunset || now < sunrise || now >= sunset;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }

  function _updateAutoThemeAvailability() {
    const hasCity = !!JSON.parse(localStorage.getItem(LOCATION_KEY) || 'null')?.city;
    const autoRadio = document.getElementById('theme-auto');
    const autoLabel = document.querySelector('label[for="theme-auto"]');
    autoRadio.disabled = !hasCity;
    autoLabel.style.opacity = hasCity ? '' : '0.4';
    autoLabel.title = hasCity ? '' : 'Select a city to enable Auto mode';
    // If auto is selected but city was removed, fall back to dark.
    if (!hasCity && _loadTheme() === 'auto') {
      _saveTheme('dark');
      const darkRadio = document.getElementById('theme-dark');
      if (darkRadio) darkRadio.checked = true;
      document.getElementById('theme-hint').classList.add('hidden');
      _applyTheme();
    }
  }

  function _initThemeControls() {
    const saved = _loadTheme();
    const radio = document.querySelector(`input[name="theme"][value="${saved}"]`);
    if (radio) radio.checked = true;

    if (saved === 'auto') {
      document.getElementById('theme-hint').textContent =
        'Uses your location to switch at sunrise and sunset.';
      document.getElementById('theme-hint').classList.remove('hidden');
    }

    _updateAutoThemeAvailability();

    document.querySelectorAll('input[name="theme"]').forEach((r) => {
      r.addEventListener('change', () => {
        _saveTheme(r.value);
        const hint = document.getElementById('theme-hint');
        if (r.value === 'auto') {
          hint.textContent = 'Uses your location to switch at sunrise and sunset.';
          hint.classList.remove('hidden');
        } else {
          hint.classList.add('hidden');
        }
        _applyTheme();
      });
    });
  }

  // ── Stocks ────────────────────────────────────────────────────────────────

  function getStockSymbols() {
    return JSON.parse(localStorage.getItem(STOCKS_KEY) || '[]');
  }

  function _saveStocks(stocks) {
    localStorage.setItem(STOCKS_KEY, JSON.stringify(stocks));
    Panel.refreshStocks();
  }

  function _initStockControls() {
    const list    = document.getElementById('stock-settings-list');
    const input   = document.getElementById('stock-search');
    const addBtn  = document.getElementById('stock-add-btn');
    const message = document.getElementById('stock-add-message');
    const keyEl   = document.getElementById('finnhub-key-input');

    keyEl.value = localStorage.getItem(FINNHUB_KEY) || '';
    keyEl.addEventListener('change', () => {
      const v = keyEl.value.trim();
      if (v) localStorage.setItem(FINNHUB_KEY, v);
      else   localStorage.removeItem(FINNHUB_KEY);
      Panel.refreshStocks();
    });

    function _renderList() {
      const stocks = getStockSymbols();
      list.innerHTML = '';
      stocks.forEach((s, i) => {
        const li = document.createElement('li');
        li.className = 'stock-settings-item';
        li.innerHTML = `<div><span class="stock-settings-symbol">${s.symbol}</span></div>`;
        const btn = document.createElement('button');
        btn.className = 'stock-remove-btn';
        btn.setAttribute('aria-label', `Remove ${s.symbol}`);
        btn.textContent = '✕';
        btn.addEventListener('click', () => {
          _saveStocks(getStockSymbols().filter((_, j) => j !== i));
          _renderList();
        });
        li.appendChild(btn);
        list.appendChild(li);
      });
    }

    async function _handleAdd() {
      const sym = input.value.trim().toUpperCase();
      if (!sym) return;

      if (getStockSymbols().find(s => s.symbol === sym)) {
        message.textContent = `${sym} is already in your list.`;
        message.className = 'settings-hint stock-add-message';
        return;
      }

      addBtn.disabled = true;
      message.textContent = 'Validating…';
      message.className = 'settings-hint stock-add-message';

      try {
        const quotes = await Api.fetchStockQuotes([sym]);
        if (!quotes.length) throw new Error('not found');
        _saveStocks([...getStockSymbols(), { symbol: quotes[0].symbol }]);
        _renderList();
        input.value = '';
        message.textContent = '';
      } catch (e) {
        let text;
        if (e && e.code === 'no_api_key')               text = 'Add a Finnhub API key above before adding stocks.';
        else if (e instanceof TypeError)                text = 'Could not reach the stock data service. Check your connection.';
        else if (e && (e.code === 'bad_key' || e.message === 'bad_key')) text = 'Finnhub rejected the API key. Check it for typos.';
        else                                            text = `"${sym}" was not found. Check the ticker (e.g. AAPL, SHOP.TO for TSX).`;
        message.textContent = text;
        message.className = 'settings-hint stock-add-message stock-add-error';
      } finally {
        addBtn.disabled = false;
      }
    }

    addBtn.addEventListener('click', _handleAdd);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _handleAdd(); }
    });

    _renderList();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    document.getElementById('settings-btn').addEventListener('click', toggle);
    document.getElementById('settings-close').addEventListener('click', close);
    document.getElementById('settings-overlay').addEventListener('click', close);
    document.getElementById('connect-btn').addEventListener('click', _handleConnect);
    document.getElementById('save-btn').addEventListener('click', _handleSave);
    document.getElementById('blackout').addEventListener('click', open);

    _initReminderWindowControls();
    _initFontSizeControls();
    _initThemeControls();
    _applyTheme();
    _initBlackoutControls();
    _applyBlackout();
    _initWeatherControls();
    _initStockControls();

    if (typeof twemoji !== 'undefined') twemoji.parse(document.getElementById('settings-btn'));

    Calendar.initVersion();

    // Kick off the initial calendar render.
    if (Auth.getClientId()) {
      Calendar.refresh();
    } else {
      Calendar.showUnauthenticated();
    }

    // Auto-refresh every 10 minutes.
    setInterval(Calendar.refresh, 10 * 60 * 1000);
    // Re-check theme and blackout every minute.
    setInterval(() => { _applyTheme(); _applyBlackout(); }, 60 * 1000);
  }

  return { init, loadCalendarList, loadTaskListOptions, getReminderWindow, getStockSymbols };
})();

// Boot.
Settings.init();
