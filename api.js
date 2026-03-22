'use strict';

// Api module — all Google Calendar REST API calls.
// Depends on: Auth
// Exposes: fetchCalendars(), fetchColors(), fetchAllEvents(calendars, timeMin, timeMax, eventColorMap)
const Api = (() => {
  const BASE = 'https://www.googleapis.com/calendar/v3';

  // ── Core fetch helper ─────────────────────────────────────────────────────

  async function _apiFetch(path, params = {}) {
    const token = await Auth.getToken();
    if (!token) {
      const err = new Error('not_authenticated');
      err.code = 'not_authenticated';
      throw err;
    }

    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 401) {
      Auth.clearToken();
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
  async function fetchCalendars() {
    const data = await _apiFetch('/users/me/calendarList', { maxResults: 250 });
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

  return { fetchCalendars, fetchColors, fetchAllEvents };
})();
