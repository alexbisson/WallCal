'use strict';

// Panel module — left sidebar: clock, weather, tasks.
// Depends on: Auth, Api
// Exposes: init(), refreshWeather(), refreshTasks()
const Panel = (() => {
  const LOCATION_KEY = 'wallcal_location';
  const TASKS_KEY    = 'wallcal_tasks_list';

  // ── Clock ──────────────────────────────────────────────────────────────────

  function _tickClock() {
    const now = new Date();
    document.getElementById('panel-time').textContent =
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0');
    document.getElementById('panel-date').textContent =
      now.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // ── Weather ────────────────────────────────────────────────────────────────

  function _weatherInfo(code) {
    if (code === 0)  return { icon: '☀️',  label: 'Clear'        };
    if (code <= 2)   return { icon: '🌤️', label: 'Mostly clear'  };
    if (code === 3)  return { icon: '☁️',  label: 'Overcast'     };
    if (code <= 48)  return { icon: '🌫️', label: 'Fog'          };
    if (code <= 57)  return { icon: '🌦️', label: 'Drizzle'      };
    if (code <= 67)  return { icon: '🌧️', label: 'Rain'         };
    if (code <= 77)  return { icon: '🌨️', label: 'Snow'         };
    if (code <= 82)  return { icon: '🌦️', label: 'Showers'      };
    if (code <= 86)  return { icon: '🌨️', label: 'Snow showers' };
    return                  { icon: '⛈️',  label: 'Thunderstorm' };
  }

  async function refreshWeather() {
    const loc = JSON.parse(localStorage.getItem(LOCATION_KEY) || 'null');
    if (!loc) return;
    try {
      const data = await Api.fetchWeather(loc.lat, loc.lng);
      _renderWeather(data);
    } catch (_) { /* stay hidden on error */ }
  }

  function _renderWeather(data) {
    const cw    = data.current_weather;
    const daily = data.daily;
    const { icon, label } = _weatherInfo(cw.weathercode);
    const high   = Math.round(daily.temperature_2m_max[0]);
    const low    = Math.round(daily.temperature_2m_min[0]);
    const precip = daily.precipitation_sum[0];

    const section = document.getElementById('panel-weather');
    section.innerHTML = `
      <div class="weather-row">
        <span class="weather-temp">${Math.round(cw.temperature)}°</span>
        <div class="weather-condition">
          <span class="weather-icon">${icon}</span>
          <span class="weather-label">${label.toUpperCase()}</span>
        </div>
        <div class="weather-hl">
          <span>H: ${high}° &nbsp; L: ${low}°</span>
          <span>${precip > 0 ? `💧 ${precip} mm` : 'No rain'}</span>
        </div>
      </div>`;
    section.classList.remove('hidden');
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────

  async function refreshTasks() {
    const listId = localStorage.getItem(TASKS_KEY);
    if (!listId) {
      console.debug('[Panel] refreshTasks: no list configured — select one in Settings > Tasks');
      return;
    }
    const token = await Auth.getToken();
    if (!token) {
      console.warn('[Panel] refreshTasks: no auth token — user may need to reconnect to grant tasks scope');
      return;
    }
    try {
      const tasks = await Api.fetchTasks(listId);
      console.debug(`[Panel] refreshTasks: got ${tasks.length} task(s)`);
      _renderTasks(tasks);
    } catch (err) {
      console.error('[Panel] refreshTasks failed:', err.message, err.code);
    }
  }

  function _renderTasks(tasks) {
    const active = tasks
      .filter((t) => t.status !== 'completed')
      .sort((a, b) => {
        if (!a.due && !b.due) return a.title.localeCompare(b.title);
        if (!a.due) return 1;
        if (!b.due) return -1;
        return a.due.localeCompare(b.due);
      })
      .slice(0, 30);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const list = document.getElementById('panel-tasks-list');
    list.innerHTML = '';

    for (const task of active) {
      const li = document.createElement('li');
      li.className = 'task-item';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'task-name';
      nameSpan.textContent = task.title;
      li.appendChild(nameSpan);

      if (task.due) {
        // Due dates are midnight UTC — parse without timezone shift.
        const [y, mo, d] = task.due.substring(0, 10).split('-').map(Number);
        const dueDate = new Date(y, mo - 1, d);
        const overdue = dueDate < today;

        const dueSpan = document.createElement('span');
        dueSpan.className = 'task-due' + (overdue ? ' task-overdue' : '');
        dueSpan.textContent = (overdue ? '⚠️ ' : '') + dueDate.toLocaleDateString('default', {
          month: 'short', day: 'numeric',
        });
        li.appendChild(dueSpan);
      }

      list.appendChild(li);
    }

    document.getElementById('panel-tasks').classList.toggle('hidden', active.length === 0);
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    _tickClock();
    setInterval(_tickClock, 1000);

    refreshWeather();
    refreshTasks();

    // Refresh weather every 30 min, tasks every 10 min.
    setInterval(refreshWeather, 30 * 60 * 1000);
    setInterval(refreshTasks,   10 * 60 * 1000);
  }

  return { init, refreshWeather, refreshTasks };
})();

Panel.init();
