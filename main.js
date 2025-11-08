// ===== main.js (drop-in) =====

const OWM_KEY = '59e48c0c7f2f08f2e8503df5be19f555';

// ---- DOM参照 ----
const $ = (sel) => document.querySelector(sel);
const els = {
  city: document.getElementById('cityInput'),
  saveCityBtn: document.getElementById('saveCityBtn'),
  cityForm: document.getElementById('city-form'),
  title: document.getElementById('titleInput'),
  date: document.getElementById('dateInput'),
  time: document.getElementById('timeInput'),
  addBtn: document.getElementById('addBtn'),
  taskForm: document.getElementById('task-form'),
  list: document.getElementById('list'),
  status: document.getElementById('status'),
};

// ---- 状態 ----
let tasks = [];
const GEO_CACHE = new Map();      // city -> {lat, lon}
const WX_CACHE = new Map();       // city -> {data, ts}
const WX_TTL_MS = 10 * 60 * 1000; // 10分

// ---- util ----
const notify = (msg) => {
  if (els.status) {
    els.status.textContent = msg;
    els.status.hidden = !msg;
  } else {
    console.log(msg);
  }
};

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );

const fetchWithTimeout = (url, opts = {}, ms = 8000) => {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(id));
};

// ---- 保存/復元 ----
function save() {
  localStorage.setItem('tasks', JSON.stringify(tasks));
}
function load() {
  try {
    tasks = JSON.parse(localStorage.getItem('tasks') || '[]');
  } catch {
    tasks = [];
  }
}

// ---- 都市設定 ----
if (els.city) {
  els.city.value = localStorage.getItem('defaultCity') || els.city.value || 'Sapporo';
}
const handleSaveCity = (e) => {
  e?.preventDefault?.();
  if (!els.city) return;
  const city = els.city.value.trim();
  localStorage.setItem('defaultCity', city || 'Sapporo');
  notify('都市を保存しました');
  setTimeout(() => notify(''), 1200);
};
els.saveCityBtn && (els.saveCityBtn.onclick = handleSaveCity);
els.cityForm && els.cityForm.addEventListener('submit', handleSaveCity);

// ---- タスク追加 ----
function addTaskFromInputs(e) {
  e?.preventDefault?.();
  const title = (els.title?.value || '').trim();
  const date = els.date?.value || '';
  const time = els.time?.value || '';
  const city = (els.city?.value || localStorage.getItem('defaultCity') || 'Sapporo').trim();

  if (!title || !date || !time) {
    notify('タスク名・日付・時間を入力してください');
    return;
  }

  const dateISO = new Date(`${date}T${time}:00`).toISOString();
  const t = {
    id: crypto.randomUUID(),
    title,
    dateISO,
    city,
    completed: false,
  };
  tasks.unshift(t);
  els.title && (els.title.value = '');
  els.time && (els.time.value = '');
  save();
  render();
  notify('タスクを追加しました');
  setTimeout(() => notify(''), 800);
}
els.addBtn && (els.addBtn.onclick = addTaskFromInputs);
els.taskForm && els.taskForm.addEventListener('submit', addTaskFromInputs);

// ---- 天気処理（キャッシュ付き） ----
async function geocodeCity(city) {
  if (GEO_CACHE.has(city)) return GEO_CACHE.get(city);
  const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${OWM_KEY}`;
  const res = await fetchWithTimeout(url, {}, 8000);
  if (!res.ok) throw new Error('Geocode fetch failed');
  const js = await res.json();
  if (!js[0]) throw new Error('都市が見つかりません');
  const loc = { lat: js[0].lat, lon: js[0].lon };
  GEO_CACHE.set(city, loc);
  return loc;
}

async function fetchCurrentWeather(lat, lon) {
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OWM_KEY}&units=metric&lang=ja`;
  const res = await fetchWithTimeout(url, {}, 8000);
  if (!res.ok) throw new Error('Weather fetch failed');
  const d = await res.json();
  return {
    icon: d.weather?.[0]?.icon ?? '01d',
    desc: d.weather?.[0]?.description ?? '',
    tempC: d.main?.temp ?? NaN,
    pressure: d.main?.pressure ?? NaN,
  };
}

async function ensureCityWeather(city) {
  const cached = WX_CACHE.get(city);
  const now = Date.now();
  if (cached && now - cached.ts < WX_TTL_MS) {
    return cached.data;
  }
  const { lat, lon } = await geocodeCity(city);
  const data = await fetchCurrentWeather(lat, lon);
  WX_CACHE.set(city, { data, ts: now });
  return data;
}

function updateBadge(taskId, wx) {
  const el = document.getElementById(`wx-${taskId}`);
  if (!el) return;
  const iconUrl = `https://openweathermap.org/img/wn/${wx.icon}.png`;
  const t = Number.isFinite(wx.tempC) ? `${Math.round(wx.tempC)}℃` : '';
  const p = Number.isFinite(wx.pressure) ? `${wx.pressure}hPa` : '';
  el.innerHTML = `
    <img src="${iconUrl}" alt="${wx.desc}" width="25" height="25" style="vertical-align:middle;">
    ${escapeHtml(wx.desc)} ${t ? ` / ${t}` : ''} ${p ? ` / ${p}` : ''}
  `;
  if (Number.isFinite(wx.pressure) && wx.pressure < 1005) {
    el.innerHTML += '（低気圧注意）';
  }
}

async function refreshWeatherForAll() {
  const cities = [...new Set(tasks.map(t => t.city || 'Sapporo'))];
  await Promise.all(cities.map(async (city) => {
    try {
      const wx = await ensureCityWeather(city);
      tasks.filter(t => (t.city || 'Sapporo') === city)
           .forEach(t => updateBadge(t.id, wx));
    } catch (e) {
      tasks.filter(t => (t.city || 'Sapporo') === city)
           .forEach(t => {
             const el = document.getElementById(`wx-${t.id}`);
             if (el) el.textContent = '天気取得失敗';
           });
    }
  }));
}

// ---- 描画 ----
function taskItemHTML(t) {
  return `
    <div>
      <input type="checkbox" ${t.completed ? 'checked' : ''} data-id="${t.id}" class="chk" />
      ${escapeHtml(t.title)}
    </div>
    <div class="meta">
      ${new Date(t.dateISO).toLocaleString()} ／ ${escapeHtml(t.city)}
      <span class="badge" id="wx-${t.id}">天気取得中...</span>
    </div>
    <button data-id="${t.id}" class="del">削除</button>
  `;
}

function render() {
  if (!els.list) return;
  els.list.innerHTML = '';
  for (const t of tasks) {
    const li = document.createElement('li');
    li.className = 'card';
    li.innerHTML = taskItemHTML(t);
    els.list.appendChild(li);
  }

  els.list.onclick = (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.classList.contains('del')) {
      const id = target.dataset.id;
      tasks = tasks.filter(x => x.id !== id);
      save();
      render();
      return;
    }
  };

  els.list.onchange = (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.classList.contains('chk')) {
      const t = tasks.find(x => x.id === target.dataset.id);
      if (t) {
        t.completed = target.checked;
        save();
      }
    }
  };

  refreshWeatherForAll();
}

// ---- 起動 ----
load();
if (!localStorage.getItem('defaultCity') && els.city) {
  localStorage.setItem('defaultCity', els.city.value || 'Sapporo');
}
render();
