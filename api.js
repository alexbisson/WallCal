'use strict';

// Api module — all Google Calendar + Tasks REST API calls, and Open-Meteo weather.
// Depends on: Auth
// Exposes: fetchCalendars(), fetchColors(), fetchAllEvents(...), fetchTaskLists(),
//          fetchTasks(listId), fetchWeather(lat, lng)
const Api = (() => {
  const CAL_BASE   = 'https://www.googleapis.com/calendar/v3';
  const TASKS_BASE = 'https://www.googleapis.com/tasks/v1';
  // Keep BASE as an alias so existing internal calls are unchanged.
  const BASE = CAL_BASE;

  // ── Core fetch helper ─────────────────────────────────────────────────────

  async function _apiFetch(path, params = {}, base = BASE) {
    const token = await Auth.getToken();
    if (!token) {
      const err = new Error('not_authenticated');
      err.code = 'not_authenticated';
      throw err;
    }

    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 401) {
      // Access token was rejected. Clear it and try once more using the refresh
      // token — getToken() will silently fetch a new access token via fetch().
      Auth.clearToken();
      const newToken = await Auth.getToken();
      if (newToken) {
        const retry = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${newToken}` },
        });
        if (retry.ok) return retry.json();
      }
      const err = new Error('token_expired');
      err.code = 'token_expired';
      throw err;
    }

    if (!response.ok) {
      const err = new Error(`API error ${response.status}`);
      err.code = 'api_error';
      throw err;
    }

    return response.json();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  // Returns the user's calendar list (all calendars they have access to).
  // showHidden:true is required to surface the auto-created Tasks calendar,
  // which Google marks as hidden in the calendarList API response by default.
  async function fetchCalendars() {
    const data = await _apiFetch('/users/me/calendarList', { maxResults: 250, showHidden: 'true' });
    return data.items || [];
  }

  // Returns the Google color palette for calendars and events.
  // Shape: { calendar: { '1': { background, foreground }, … }, event: { … } }
  async function fetchColors() {
    return _apiFetch('/colors');
  }

  // Returns events for a single calendar within the time range.
  async function _fetchEvents(calendarId, timeMin, timeMax) {
    const data = await _apiFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: 500,
      },
    );
    return data.items || [];
  }

  // Fetches events for all visible calendars and annotates each event with
  // its resolved background/foreground colors.
  //
  // eventColorMap — the `event` sub-object from fetchColors(), keyed by colorId.
  //   Pass {} to skip event-level color overrides.
  async function fetchAllEvents(calendars, timeMin, timeMax, eventColorMap) {
    const hidden = JSON.parse(localStorage.getItem('wallcal_hidden') || '[]');
    const visible = calendars.filter((c) => !hidden.includes(c.id));

    const results = await Promise.allSettled(
      visible.map((cal) =>
        _fetchEvents(cal.id, timeMin, timeMax).then((events) =>
          events
            .filter((e) => e.status !== 'cancelled')
            .map((event) => {
              // Event-level color overrides calendar color when set.
              const override = event.colorId && eventColorMap
                ? eventColorMap[event.colorId]
                : null;
              return {
                ...event,
                _bgColor: override ? override.background : (cal.backgroundColor || '#4285f4'),
                _fgColor: override ? override.foreground : (cal.foregroundColor || '#ffffff'),
                _calId: cal.id,
              };
            }),
        ),
      ),
    );

    // Collect fulfilled results; skip any calendars that errored individually.
    return results
      .filter((r) => r.status === 'fulfilled')
      .flatMap((r) => r.value);
  }

  // ── Tasks API ─────────────────────────────────────────────────────────────

  async function fetchTaskLists() {
    const data = await _apiFetch('/users/@me/lists', {}, TASKS_BASE);
    return data.items || [];
  }

  // Fetches tasks with due dates from all task lists and returns them as
  // all-day calendar event objects ready for the grid renderer.
  // Only tasks within the [timeMin, timeMax) window are included.
  async function fetchTaskEvents(timeMin, timeMax) {
    const lists = await fetchTaskLists();
    const results = await Promise.allSettled(lists.map((l) => fetchTasks(l.id)));

    return results
      .filter((r) => r.status === 'fulfilled')
      .flatMap((r) => r.value)
      .filter((t) => t.due && t.status !== 'completed')
      .filter((t) => {
        const d = new Date(t.due.substring(0, 10));
        return d >= timeMin && d < timeMax;
      })
      .map((t) => {
        const dateStr = t.due.substring(0, 10); // YYYY-MM-DD
        const endDate = new Date(dateStr);
        endDate.setDate(endDate.getDate() + 1);
        return {
          id: t.id,
          summary: t.title || '(No title)',
          start: { date: dateStr },
          end:   { date: endDate.toISOString().substring(0, 10) },
          _bgColor: '#1a73e8',
          _fgColor: '#ffffff',
        };
      });
  }

  async function fetchTasks(listId) {
    const data = await _apiFetch(
      `/lists/${encodeURIComponent(listId)}/tasks`,
      { showCompleted: 'false', showHidden: 'false', maxResults: '30' },
      TASKS_BASE,
    );
    return data.items || [];
  }

  // ── Weather API (Open-Meteo — no key required) ────────────────────────────

  async function fetchWeather(lat, lng) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude',      String(lat));
    url.searchParams.set('longitude',     String(lng));
    url.searchParams.set('current_weather', 'true');
    url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode');
    url.searchParams.set('timezone',      'auto');
    url.searchParams.set('forecast_days', '4');
    const resp = await fetch(url.toString());
    if (!resp.ok) throw new Error(`Weather API ${resp.status}`);
    return resp.json();
  }

  return { fetchCalendars, fetchColors, fetchAllEvents, fetchTaskLists, fetchTasks, fetchTaskEvents, fetchWeather };
})();
