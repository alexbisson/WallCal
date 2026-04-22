'use strict';

// Panel module — left sidebar: clock, weather, tasks, stocks.
// Depends on: Auth, Api
// Exposes: init(), refreshWeather(), refreshTasks(), refreshStocks()
const Panel = (() => {
  const LOCATION_KEY = 'wallcal_location';
  const TASKS_KEY    = 'wallcal_tasks_list';
  const STOCKS_KEY   = 'wallcal_stocks';
  const QUOTE_TTL    = 60 * 60 * 1000; // refresh quote every hour

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
    const delays = [5000, 15000, 45000];
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        const data = await Api.fetchWeather(loc.lat, loc.lng);
        _renderWeather(data);
        return;
      } catch (_) {
        if (attempt < delays.length) {
          await new Promise(r => setTimeout(r, delays[attempt]));
        }
      }
    }
  }

  function _renderWeather(data) {
    const cw    = data.current_weather;
    const daily = data.daily;
    const { icon, label } = _weatherInfo(cw.weathercode);
    const high   = Math.round(daily.temperature_2m_max[0]);
    const low    = Math.round(daily.temperature_2m_min[0]);
    const precip = daily.precipitation_sum[0];

    const forecastDays = [1, 2, 3].map(i => {
      const date = new Date(daily.time[i] + 'T12:00:00');
      return {
        label: date.toLocaleDateString('default', { weekday: 'short' }),
        icon:  _weatherInfo(daily.weathercode[i]).icon,
        high:  Math.round(daily.temperature_2m_max[i]),
        low:   Math.round(daily.temperature_2m_min[i]),
      };
    });

    const section = document.getElementById('panel-weather');
    section.innerHTML = `
      <div class="weather-row">
        <span class="weather-temp">${Math.round(cw.temperature)}°</span>
        <div class="weather-condition">
          <span class="weather-icon">${icon}</span>
          <span class="weather-label">${label.toUpperCase()}</span>
        </div>
        <div class="weather-hl">
          <span>L: ${low}° &nbsp; H: ${high}°</span>
          <span>${precip > 0 ? `💧 ${precip} mm` : 'No rain'}</span>
        </div>
      </div>
      <hr class="weather-divider">
      <div class="weather-forecast">
        ${forecastDays.map(d => `
          <div class="forecast-day">
            <span class="forecast-label">${d.label}</span>
            <span class="forecast-icon">${d.icon}</span>
            <span class="forecast-low">L: ${d.low}°</span><span class="forecast-high">H: ${d.high}°</span>
          </div>`).join('')}
      </div>`;
    section.classList.remove('hidden');
    if (typeof twemoji !== 'undefined') twemoji.parse(section);
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const window = Settings.getReminderWindow();
    const cutoff = window === 'all' ? null
      : new Date(today.getTime() + parseInt(window, 10) * 24 * 60 * 60 * 1000);

    const active = tasks
      .filter((t) => t.status !== 'completed')
      .filter((t) => {
        if (!t.due || !cutoff) return true;
        const [y, mo, d] = t.due.substring(0, 10).split('-').map(Number);
        return new Date(y, mo - 1, d) <= cutoff;
      })
      .sort((a, b) => {
        if (!a.due && !b.due) return a.title.localeCompare(b.title);
        if (!a.due) return 1;
        if (!b.due) return -1;
        return a.due.localeCompare(b.due);
      })
      .slice(0, 30);

    const list = document.getElementById('panel-tasks-list');
    list.innerHTML = '';

    for (const task of active) {
      const li = document.createElement('li');
      li.className = 'task-item';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'task-name';

      if (task.due) {
        // Due dates are midnight UTC — parse without timezone shift.
        const [y, mo, d] = task.due.substring(0, 10).split('-').map(Number);
        const dueDate = new Date(y, mo - 1, d);
        const overdue = dueDate < today;

        nameSpan.textContent = (overdue ? '⚠️ ' : '') + task.title;

        const dueSpan = document.createElement('span');
        dueSpan.className = 'task-due' + (overdue ? ' task-overdue' : '');
        dueSpan.textContent = dueDate.toLocaleDateString('default', {
          month: 'short', day: 'numeric',
        });
        nameSpan.appendChild(dueSpan);
      } else {
        nameSpan.textContent = task.title;
      }

      li.appendChild(nameSpan);

      list.appendChild(li);
    }

    document.getElementById('panel-tasks').classList.toggle('hidden', active.length === 0);
    if (typeof twemoji !== 'undefined') twemoji.parse(list);
  }

  // ── Quote ──────────────────────────────────────────────────────────────────

  const QUOTES = [
    { q: 'The present moment always will have been.', a: 'Epictetus' },
    { q: 'Do what you can, with what you have, where you are.', a: 'Theodore Roosevelt' },
    { q: 'In the middle of difficulty lies opportunity.', a: 'Albert Einstein' },
    { q: 'It always seems impossible until it\'s done.', a: 'Nelson Mandela' },
    { q: 'The only way out is through.', a: 'Robert Frost' },
    { q: 'Act as if what you do makes a difference. It does.', a: 'William James' },
    { q: 'Start where you are. Use what you have. Do what you can.', a: 'Arthur Ashe' },
    { q: 'Keep your face always toward the sunshine, and shadows will fall behind you.', a: 'Walt Whitman' },
    { q: 'Nothing is impossible. The word itself says "I\'m possible."', a: 'Audrey Hepburn' },
    { q: 'Happiness is not something readymade. It comes from your own actions.', a: 'Dalai Lama' },
    { q: 'Wherever you go, go with all your heart.', a: 'Confucius' },
    { q: 'The secret of getting ahead is getting started.', a: 'Mark Twain' },
    { q: 'Life is what happens when you\'re busy making other plans.', a: 'John Lennon' },
    { q: 'You miss 100% of the shots you don\'t take.', a: 'Wayne Gretzky' },
    { q: 'Whether you think you can or you think you can\'t, you\'re right.', a: 'Henry Ford' },
    { q: 'The best time to plant a tree was 20 years ago. The second best time is now.', a: 'Chinese Proverb' },
    { q: 'An unexamined life is not worth living.', a: 'Socrates' },
    { q: 'Spread love everywhere you go.', a: 'Mother Teresa' },
    { q: 'When you reach the end of your rope, tie a knot in it and hang on.', a: 'Franklin D. Roosevelt' },
    { q: 'Always remember that you are absolutely unique. Just like everyone else.', a: 'Margaret Mead' },
    { q: 'Do not go where the path may lead; go instead where there is no path and leave a trail.', a: 'Ralph Waldo Emerson' },
    { q: 'You will face many defeats in life, but never let yourself be defeated.', a: 'Maya Angelou' },
    { q: 'In the end, it\'s not the years in your life that count. It\'s the life in your years.', a: 'Abraham Lincoln' },
    { q: 'Never let the fear of striking out keep you from playing the game.', a: 'Babe Ruth' },
    { q: 'Life is either a daring adventure or nothing at all.', a: 'Helen Keller' },
    { q: 'Many of life\'s failures are people who did not realize how close to success they were.', a: 'Thomas Edison' },
    { q: 'You have brains in your head. You have feet in your shoes. You can steer yourself any direction you choose.', a: 'Dr. Seuss' },
    { q: 'If life were predictable it would cease to be life, and be without flavor.', a: 'Eleanor Roosevelt' },
    { q: 'If you look at what you have in life, you\'ll always have more.', a: 'Oprah Winfrey' },
    { q: 'If you want to live a happy life, tie it to a goal, not to people or things.', a: 'Albert Einstein' },
    { q: 'Money and success don\'t change people; they merely amplify what is already there.', a: 'Will Smith' },
    { q: 'Your time is limited, so don\'t waste it living someone else\'s life.', a: 'Steve Jobs' },
    { q: 'Not how long, but how well you have lived is the main thing.', a: 'Seneca' },
    { q: 'The greatest glory in living lies not in never falling, but in rising every time we fall.', a: 'Nelson Mandela' },
    { q: 'It is during our darkest moments that we must focus to see the light.', a: 'Aristotle' },
    { q: 'Believe you can and you\'re halfway there.', a: 'Theodore Roosevelt' },
    { q: 'Everything you\'ve ever wanted is on the other side of fear.', a: 'George Addair' },
    { q: 'Hardships often prepare ordinary people for an extraordinary destiny.', a: 'C.S. Lewis' },
    { q: 'You are never too old to set another goal or to dream a new dream.', a: 'C.S. Lewis' },
    { q: 'It does not matter how slowly you go as long as you do not stop.', a: 'Confucius' },
    { q: 'Our greatest weakness lies in giving up. The most certain way to succeed is always to try just one more time.', a: 'Thomas Edison' },
    { q: 'I have learned over the years that when one\'s mind is made up, this diminishes fear.', a: 'Rosa Parks' },
    { q: 'I alone cannot change the world, but I can cast a stone across the water to create many ripples.', a: 'Mother Teresa' },
    { q: 'Nothing in life is to be feared, it is only to be understood.', a: 'Marie Curie' },
    { q: 'The most difficult thing is the decision to act. The rest is merely tenacity.', a: 'Amelia Earhart' },
    { q: 'How wonderful it is that nobody need wait a single moment before starting to improve the world.', a: 'Anne Frank' },
    { q: 'You must be the change you wish to see in the world.', a: 'Mahatma Gandhi' },
    { q: 'In three words I can sum up everything I\'ve learned about life: it goes on.', a: 'Robert Frost' },
    { q: 'If you look at what you have in life, you\'ll always have more. If you look at what you don\'t have, you\'ll never have enough.', a: 'Oprah Winfrey' },
    { q: 'Remember that not getting what you want is sometimes a wonderful stroke of luck.', a: 'Dalai Lama' },
    { q: 'You can\'t use up creativity. The more you use, the more you have.', a: 'Maya Angelou' },
    { q: 'Dream big and dare to fail.', a: 'Norman Vaughan' },
    { q: 'When the whole world is silent, even one voice becomes powerful.', a: 'Malala Yousafzai' },
    { q: 'The mind is everything. What you think you become.', a: 'Buddha' },
    { q: 'Strive not to be a success, but rather to be of value.', a: 'Albert Einstein' },
    { q: 'I attribute my success to this: I never gave or took any excuse.', a: 'Florence Nightingale' },
    { q: 'The most common way people give up their power is by thinking they don\'t have any.', a: 'Alice Walker' },
    { q: 'The most courageous act is still to think for yourself. Aloud.', a: 'Coco Chanel' },
    { q: 'I am not a product of my circumstances. I am a product of my decisions.', a: 'Stephen Covey' },
    { q: 'When everything seems to be going against you, remember that the airplane takes off against the wind.', a: 'Henry Ford' },
    { q: 'It\'s not whether you get knocked down, it\'s whether you get up.', a: 'Vince Lombardi' },
    { q: 'People who are crazy enough to think they can change the world are the ones who do.', a: 'Rob Siltanen' },
    { q: 'I can\'t change the direction of the wind, but I can adjust my sails to always reach my destination.', a: 'Jimmy Dean' },
    { q: 'Attitude is a little thing that makes a big difference.', a: 'Winston Churchill' },
    { q: 'Too many of us are not living our dreams because we are living our fears.', a: 'Les Brown' },
    { q: 'You may be disappointed if you fail, but you are doomed if you don\'t try.', a: 'Beverly Sills' },
    { q: 'Remember no one can make you feel inferior without your consent.', a: 'Eleanor Roosevelt' },
    { q: 'Life shrinks or expands in proportion to one\'s courage.', a: 'Anaïs Nin' },
    { q: 'If you hear a voice within you say you cannot paint, then by all means paint, and that voice will be silenced.', a: 'Vincent van Gogh' },
    { q: 'The only person you are destined to become is the person you decide to be.', a: 'Ralph Waldo Emerson' },
    { q: 'Go confidently in the direction of your dreams. Live the life you have imagined.', a: 'Henry David Thoreau' },
    { q: 'Everything has beauty, but not everyone can see.', a: 'Confucius' },
    { q: 'We become what we think about.', a: 'Earl Nightingale' },
    { q: 'A person who never made a mistake never tried anything new.', a: 'Albert Einstein' },
    { q: 'There are no traffic jams along the extra mile.', a: 'Roger Staubach' },
    { q: 'It is never too late to be what you might have been.', a: 'George Eliot' },
    { q: 'You become what you believe.', a: 'Oprah Winfrey' },
    { q: 'I would rather die of passion than of boredom.', a: 'Vincent van Gogh' },
    { q: 'Build your own dreams, or someone else will hire you to build theirs.', a: 'Farrah Gray' },
    { q: 'Don\'t wait. The time will never be just right.', a: 'Napoleon Hill' },
    { q: 'Someday is not a day of the week.', a: 'Janet Dailey' },
    { q: 'Perfection is not attainable, but if we chase perfection we can catch excellence.', a: 'Vince Lombardi' },
    { q: 'Give me six hours to chop down a tree and I will spend the first four sharpening the axe.', a: 'Abraham Lincoln' },
    { q: 'The best revenge is massive success.', a: 'Frank Sinatra' },
    { q: 'Challenges are what make life interesting. Overcoming them is what makes life meaningful.', a: 'Joshua J. Marine' },
    { q: 'If you want to lift yourself up, lift up someone else.', a: 'Booker T. Washington' },
    { q: 'I am not afraid of storms, for I am learning how to sail my ship.', a: 'Louisa May Alcott' },
    { q: 'No act of kindness, no matter how small, is ever wasted.', a: 'Aesop' },
    { q: 'What would you do if you weren\'t afraid?', a: 'Sheryl Sandberg' },
    { q: 'Courage is not the absence of fear, but the triumph over it.', a: 'Nelson Mandela' },
    { q: 'The only limit to our realization of tomorrow will be our doubts of today.', a: 'Franklin D. Roosevelt' },
    { q: 'Creativity is intelligence having fun.', a: 'Albert Einstein' },
    { q: 'What lies behind us and what lies before us are tiny matters compared to what lies within us.', a: 'Ralph Waldo Emerson' },
    { q: 'The most wasted of days is one without laughter.', a: 'E.E. Cummings' },
    { q: 'The bad news is time flies. The good news is you\'re the pilot.', a: 'Michael Altshuler' },
    { q: 'Waste no more time arguing about what a good man should be. Be one.', a: 'Marcus Aurelius' },
    { q: 'You only live once, but if you do it right, once is enough.', a: 'Mae West' },
    { q: 'Not all those who wander are lost.', a: 'J.R.R. Tolkien' },
    { q: 'The purpose of our lives is to be happy.', a: 'Dalai Lama' },
    { q: 'Live as if you were to die tomorrow. Learn as if you were to live forever.', a: 'Mahatma Gandhi' },
    { q: 'Darkness cannot drive out darkness; only light can do that.', a: 'Martin Luther King Jr.' },
    { q: 'Without music, life would be a mistake.', a: 'Friedrich Nietzsche' },
    { q: 'We accept the love we think we deserve.', a: 'Stephen Chbosky' },
    { q: 'Be yourself; everyone else is already taken.', a: 'Oscar Wilde' },
    { q: 'You\'ve gotta dance like there\'s nobody watching.', a: 'William W. Purkey' },
    { q: 'To live is the rarest thing in the world. Most people just exist.', a: 'Oscar Wilde' },
    { q: 'In the end, we only regret the chances we didn\'t take.', a: 'Lewis Carroll' },
    { q: 'The world is not a problem to be solved; it is a living being to which we belong.', a: 'Llewelyn Vaughan-Lee' },
    { q: 'Do one thing every day that scares you.', a: 'Eleanor Roosevelt' },
    { q: 'Well-behaved women seldom make history.', a: 'Laurel Thatcher Ulrich' },
    { q: 'A woman is like a tea bag — you never know how strong she is until she gets in hot water.', a: 'Eleanor Roosevelt' },
    { q: 'I\'m tough, I\'m ambitious, and I know exactly what I want.', a: 'Madonna' },
    { q: 'I can be changed by what happens to me. But I refuse to be reduced by it.', a: 'Maya Angelou' },
    { q: 'If you don\'t like the road you\'re walking, start paving another one.', a: 'Dolly Parton' },
    { q: 'Don\'t let yesterday take up too much of today.', a: 'Will Rogers' },
    { q: 'You learn more from failure than from success. Don\'t let it stop you.', a: 'Unknown' },
    { q: 'We generate fears while we sit. We overcome them by action.', a: 'Dr. Henry Link' },
    { q: 'Security is mostly a superstition. Life is either a daring adventure or nothing.', a: 'Helen Keller' },
    { q: 'The man who has confidence in himself gains the confidence of others.', a: 'Hasidic Proverb' },
    { q: 'Thinking should become your capital asset, no matter whatever ups and downs you come across.', a: 'A.P.J. Abdul Kalam' },
    { q: 'If you think you are too small to make a difference, try sleeping with a mosquito.', a: 'Dalai Lama' },
    { q: 'When you reach the end of your rope, tie a knot and hang on.', a: 'Abraham Lincoln' },
    { q: 'Don\'t watch the clock; do what it does. Keep going.', a: 'Sam Levenson' },
    { q: 'Keep your eyes on the stars, and your feet on the ground.', a: 'Theodore Roosevelt' },
    { q: 'In every day, there are 1,440 minutes. That means we have 1,440 daily opportunities to make a positive impact.', a: 'Les Brown' },
    { q: 'Whether you think you can or think you can\'t — you\'re right.', a: 'Henry Ford' },
    { q: 'A year from now you may wish you had started today.', a: 'Karen Lamb' },
    { q: 'The secret of happiness is not in doing what one likes, but in liking what one does.', a: 'James M. Barrie' },
    { q: 'One day or day one. You decide.', a: 'Unknown' },
    { q: 'With the right mindset, we can\'t lose — we either win or we learn.', a: 'Unknown' },
    { q: 'Be so good they can\'t ignore you.', a: 'Steve Martin' },
    { q: 'Success is walking from failure to failure with no loss of enthusiasm.', a: 'Winston Churchill' },
    { q: 'I find that the harder I work, the more luck I seem to have.', a: 'Thomas Jefferson' },
    { q: 'The only place where success comes before work is in the dictionary.', a: 'Vidal Sassoon' },
    { q: 'Opportunity is missed by most people because it is dressed in overalls and looks like work.', a: 'Thomas Edison' },
    { q: 'I\'ve missed more than 9,000 shots in my career. I\'ve lost almost 300 games. I\'ve failed over and over again. And that is why I succeed.', a: 'Michael Jordan' },
    { q: 'Every strike brings me closer to the next home run.', a: 'Babe Ruth' },
    { q: 'Definiteness of purpose is the starting point of all achievement.', a: 'W. Clement Stone' },
    { q: 'Magic is believing in yourself. If you can do that, you can make anything happen.', a: 'Johann Wolfgang von Goethe' },
    { q: 'All our dreams can come true, if we have the courage to pursue them.', a: 'Walt Disney' },
    { q: 'First, think. Second, dream. Third, believe. And finally, dare.', a: 'Walt Disney' },
    { q: 'The way to get started is to quit talking and begin doing.', a: 'Walt Disney' },
    { q: 'It\'s kind of fun to do the impossible.', a: 'Walt Disney' },
  ];

  function _refreshQuote() {
    // Pick a quote index based on the current hour so it changes hourly
    // but is stable within the hour (even across page reloads).
    const hourSlot = Math.floor(Date.now() / (60 * 60 * 1000));
    const { q, a } = QUOTES[hourSlot % QUOTES.length];
    _renderQuote(q, a);
  }

  function _renderQuote(text, author) {
    const el = document.getElementById('panel-quote');
    el.innerHTML =
      `<p class="quote-text">\u201c${text}\u201d</p>` +
      `<p class="quote-author">\u2014 ${author}</p>`;
  }

  // ── Stocks ─────────────────────────────────────────────────────────────────

  function _sparkline(closes, positive) {
    const W = 80, H = 28;
    if (closes.length < 2) return '';
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const range = max - min || 1;
    const pts = closes.map((v, i) => {
      const x = (i / (closes.length - 1)) * W;
      const y = H - 2 - ((v - min) / range) * (H - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const color = positive ? '#34d399' : '#f87171';
    const id = `sg-${Math.random().toString(36).slice(2, 7)}`;
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" class="stock-sparkline">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="M${pts.join(' L')} L${W},${H} L0,${H} Z" fill="url(#${id})"/>
      <polyline points="${pts.join(' ')}" stroke="${color}" stroke-width="1.5" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
  }

  async function refreshStocks() {
    const dow = new Date().getDay();
    const section = document.getElementById('panel-stocks');
    if (dow === 0 || dow === 6) { section.classList.add('hidden'); return; }

    const symbols = JSON.parse(localStorage.getItem(STOCKS_KEY) || '[]').map(s => s.symbol);
    if (!symbols.length) { section.classList.add('hidden'); return; }

    const delays = [5000, 15000, 45000];
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        const quotes = await Api.fetchStockQuotes(symbols);
        _renderStocks(quotes);
        return;
      } catch (_) {
        if (attempt < delays.length) {
          await new Promise(r => setTimeout(r, delays[attempt]));
        }
      }
    }
  }

  function _renderStocks(quotes) {
    const section = document.getElementById('panel-stocks');
    if (!quotes.length) { section.classList.add('hidden'); return; }

    const rows = quotes.map(q => {
      const pos = q.changePercent >= 0;
      const sign = pos ? '+' : '';
      const pct = `${sign}${q.changePercent.toFixed(2)}%`;
      const price = q.price.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const chart = _sparkline(q.closes, pos);
      return `<div class="stock-row">
        <div class="stock-meta">
          <span class="stock-symbol">${q.symbol}</span>
          <span class="stock-name">${q.name}</span>
        </div>
        <div class="stock-chart">${chart}</div>
        <div class="stock-price-col">
          <span class="stock-price">${price}</span>
          <span class="stock-change ${pos ? 'stock-pos' : 'stock-neg'}">${pct}</span>
        </div>
      </div>`;
    }).join('');

    section.innerHTML = `<h2 class="panel-section-title">Stocks</h2><div class="stock-list">${rows}</div>`;
    section.classList.remove('hidden');
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    _tickClock();
    setInterval(_tickClock, 1000);

    refreshWeather();
    refreshTasks();
    refreshStocks();
    _refreshQuote();

    // Refresh weather every 30 min, tasks every 10 min, stocks every 5 min, quote every hour.
    setInterval(refreshWeather, 30 * 60 * 1000);
    setInterval(refreshTasks,   10 * 60 * 1000);
    setInterval(refreshStocks,   5 * 60 * 1000);
    setInterval(_refreshQuote,  QUOTE_TTL);
  }

  return { init, refreshWeather, refreshTasks, refreshStocks };
})();

Panel.init();
