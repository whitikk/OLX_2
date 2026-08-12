import express from 'express';
import cron from 'node-cron';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ════════════════════════════════════════════════════════════════════════
//  БД
// ════════════════════════════════════════════════════════════════════════
const DB_PATH = process.env.OLX_DB || './data/olx.db';

function openDb(path = DB_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS offers (
      offer_id INTEGER PRIMARY KEY, category_id INTEGER, title TEXT, brand TEXT,
      line TEXT, type TEXT, price_uah REAL, condition TEXT, city TEXT, region TEXT,
      created_time TEXT, promoted INTEGER, first_seen TEXT, last_seen TEXT,
      gone_at TEXT, age_days_at_gone REAL
    );
    CREATE TABLE IF NOT EXISTS crawls (crawl_ts TEXT PRIMARY KEY, count INTEGER);
    CREATE INDEX IF NOT EXISTS idx_offers_brand ON offers(brand);
    CREATE INDEX IF NOT EXISTS idx_offers_gone  ON offers(gone_at);
    CREATE INDEX IF NOT EXISTS idx_offers_cat   ON offers(category_id);
  `);
  return db;
}

// ════════════════════════════════════════════════════════════════════════
//  Бренди (головний важіль точності — дописуй під свою нішу)
// ════════════════════════════════════════════════════════════════════════
const BRANDS = [
  { name: 'Dior',               rx: /\b(dior|sauvage|діор|диор|саваж|соваж)\b/iu },
  { name: 'Chanel',             rx: /\b(chanel|шанель|bleu de chanel)\b/iu },
  { name: 'Tom Ford',           rx: /\b(tom\s*ford|том\s*форд)\b/iu },
  { name: 'YSL',                rx: /\b(ysl|yves\s*saint\s*laurent|сен[-\s]?лоран|ів\s*сен)\b/iu },
  { name: 'Lancome',            rx: /\b(lancome|lancôme|ланком)\b/iu },
  { name: 'Versace',            rx: /\b(versace|версаче|версаус)\b/iu },
  { name: 'Giorgio Armani',     rx: /\b(armani|армані|армани|acqua di gio|аква ди джио)\b/iu },
  { name: 'Paco Rabanne',       rx: /\b(paco\s*rabanne|rabanne|пако\s*рабан|рабан)\b/iu },
  { name: 'Jean Paul Gaultier', rx: /\b(jean\s*paul\s*gaultier|jpg|готьє|готье|le male)\b/iu },
  { name: 'Hugo Boss',          rx: /\b(hugo\s*boss|hugo|boss\b|хьюго\s*бос|бос)\b/iu },
  { name: 'Calvin Klein',       rx: /\b(calvin\s*klein|ck\s*one|кельвін\s*кл|келвин\s*кл|\bck\b)\b/iu },
  { name: 'Dolce & Gabbana',    rx: /\b(dolce\s*&?\s*gabbana|d&g|dg\b|дольче|габбана)\b/iu },
  { name: 'Givenchy',           rx: /\b(givenchy|живанші|живанши)\b/iu },
  { name: 'Guerlain',           rx: /\b(guerlain|герлен)\b/iu },
  { name: 'Creed',              rx: /\b(creed|крід|крид|aventus|авентус)\b/iu },
  { name: 'Montale',            rx: /\b(montale|монталь)\b/iu },
  { name: 'Mancera',            rx: /\b(mancera|мансера)\b/iu },
  { name: 'Lattafa',            rx: /\b(lattafa|латтафа|khamrah|хамра|asad|асад)\b/iu },
  { name: 'Armaf',              rx: /\b(armaf|армаф|club de nuit|клуб де нуит)\b/iu },
  { name: 'Xerjoff',            rx: /\b(xerjoff|ксерджофф|зерджофф)\b/iu },
  { name: 'Byredo',             rx: /\b(byredo|байредо)\b/iu },
  { name: 'MFK',                rx: /\b(mfk|maison\s*francis\s*kurkdjian|baccarat|баккара)\b/iu },
  { name: 'Nishane',            rx: /\b(nishane|нишане|нішане)\b/iu },
  { name: 'Parfums de Marly',   rx: /\b(parfums?\s*de\s*marly|pdm|марли|марлі|layton|delina)\b/iu },
  { name: 'Prada',              rx: /\b(prada|прада)\b/iu },
  { name: 'Gucci',              rx: /\b(gucci|гуччі|гуччи)\b/iu },
  { name: 'Burberry',           rx: /\b(burberry|барбері|барберри)\b/iu },
  { name: 'Kenzo',              rx: /\b(kenzo|кензо)\b/iu },
  { name: 'Kilian',             rx: /\b(kilian|кіліан|килиан)\b/iu },
  { name: 'Amouage',            rx: /\b(amouage|амуаж)\b/iu },
  { name: 'Initio',             rx: /\b(initio|инитио|ініціо)\b/iu },
  { name: 'Bvlgari',            rx: /\b(bvlgari|bulgari|булгарі|булгари)\b/iu },
  { name: 'Carolina Herrera',   rx: /\b(carolina\s*herrera|good\s*girl|каролина эррера|360)\b/iu },
  { name: 'Azzaro',             rx: /\b(azzaro|азаро|the most wanted)\b/iu },
  { name: 'Narciso Rodriguez',  rx: /\b(narciso|нарцисо|нарциссо)\b/iu },
  { name: 'Mugler',             rx: /\b(mugler|thierry\s*mugler|мюглер|alien|angel)\b/iu },
  { name: 'Escentric Molecules',rx: /\b(escentric|molecule|молекула|молекюл)\b/iu },
  { name: 'Zara',               rx: /\b(zara|зара)\b/iu },
];
const STOP = new Set(['мл','ml','ml.','г','парфум','парфуми','парфюм','духи','туалетна',
  'парфумована','парфюмированная','вода','вод','edp','edt','edc','parfum','оригінал',
  'оригинал','original','тестер','tester','розпив','распив','відлив','отлив','ліцензія',
  'лицензия','люкс','lux','новий','нова','новые','new','for','men','women','жіночі',
  'чоловічі','женский','мужской','аромат','perfume','the','de','на','і','та','и','ua']);

function detectBrand(title) {
  if (!title) return null;
  for (const b of BRANDS) if (b.rx.test(title)) return b.name;
  return null;
}
function detectType(title) {
  const t = (title || '').toLowerCase();
  if (/розпив|распив|відлив|отлив|decant/u.test(t)) return 'decant';
  if (/тестер|tester/u.test(t)) return 'tester';
  return 'full';
}
function extractLine(title, brand) {
  if (!title) return null;
  let t = title.toLowerCase();
  const b = BRANDS.find((x) => x.name === brand);
  if (b) t = t.replace(b.rx, ' ');
  t = t.replace(/\d+[\s]?(мл|ml|г|g)\b/gu, ' ')
       .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/gu, ' ').trim();
  const tokens = t.split(' ').filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
  return tokens.slice(0, 3).join(' ').trim() || null;
}

// ════════════════════════════════════════════════════════════════════════
//  Краул
// ════════════════════════════════════════════════════════════════════════
const LIMIT = 40, MAX_OFFSET = 1000, DELAY_MS = 700;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(categoryId, regionId, offset) {
  const url = new URL('https://www.olx.ua/api/v1/offers/');
  url.searchParams.set('category_id', String(categoryId));
  url.searchParams.set('limit', String(LIMIT));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('sort_by', 'created_at:desc');
  if (regionId) url.searchParams.set('region_id', String(regionId));
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json',
               'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.5' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} (offset ${offset})`);
  return res.json();
}
const parsePrice = (p = []) => {
  const v = p.find((x) => x.key === 'price')?.value?.value;
  return typeof v === 'number' ? v : null;
};
const parseCondition = (p = []) => {
  const k = p.find((x) => x.key === 'state')?.value?.key;
  return k === 'new' ? 'new' : k === 'used' ? 'used' : 'unknown';
};
function normalize(o, categoryId) {
  const title = o.title || '';
  const brand = detectBrand(title);
  return {
    offer_id: o.id, category_id: categoryId, title, brand,
    line: extractLine(title, brand), type: detectType(title),
    price_uah: parsePrice(o.params), condition: parseCondition(o.params),
    city: o.location?.city?.name || null, region: o.location?.region?.name || null,
    created_time: o.created_time ? new Date(o.created_time).toISOString() : null,
    promoted: o.promotion?.highlighted || o.promotion?.top_ad || o.promotion?.urgent ? 1 : 0,
  };
}

async function crawlCategory({ db, categoryId, regionId, now, prev, onProgress }) {
  const seen = [];
  for (let offset = 0; offset <= MAX_OFFSET; offset += LIMIT) {
    let page;
    try { page = await fetchPage(categoryId, regionId, offset); }
    catch (e) { if (onProgress) onProgress(`cat ${categoryId}: ${e.message} — стоп`); break; }
    const data = page.data || [];
    if (data.length === 0) break;
    for (const o of data) seen.push(normalize(o, categoryId));
    if (onProgress) onProgress(`cat ${categoryId}: ${seen.length}`);
    if (!page.links?.next?.href) break;
    await sleep(DELAY_MS);
  }
  if (seen.length === 0) return { categoryId, count: 0, withBrand: 0, gone: 0 };

  const oldestCovered = seen.map((s) => s.created_time).filter(Boolean).sort()[0];
  const upsert = db.prepare(`
    INSERT INTO offers
      (offer_id, category_id, title, brand, line, type, price_uah, condition,
       city, region, created_time, promoted, first_seen, last_seen, gone_at, age_days_at_gone)
    VALUES
      (@offer_id, @category_id, @title, @brand, @line, @type, @price_uah, @condition,
       @city, @region, @created_time, @promoted, @now, @now, NULL, NULL)
    ON CONFLICT(offer_id) DO UPDATE SET
      last_seen = @now, price_uah = @price_uah, promoted = @promoted,
      gone_at = NULL, age_days_at_gone = NULL
  `);
  db.transaction((rows) => { for (const r of rows) upsert.run({ ...r, now }); })(seen);

  let gone = 0;
  if (prev) {
    gone = db.prepare(`
      UPDATE offers SET gone_at = @now,
        age_days_at_gone = julianday(@now) - julianday(created_time)
      WHERE gone_at IS NULL AND category_id = @categoryId
        AND last_seen = @prev AND last_seen != @now AND created_time >= @oldest
    `).run({ now, prev, categoryId, oldest: oldestCovered }).changes;
  }
  return { categoryId, count: seen.length, withBrand: seen.filter((s) => s.brand).length, gone };
}

async function runCrawlCycle({ db, categoryIds, regionId, onProgress }) {
  const now = new Date().toISOString();
  const prev = db.prepare('SELECT crawl_ts FROM crawls ORDER BY crawl_ts DESC LIMIT 1')
    .get()?.crawl_ts || null;
  const results = [];
  for (const categoryId of categoryIds)
    results.push(await crawlCategory({ db, categoryId, regionId, now, prev, onProgress }));
  const total = results.reduce((a, r) => a + r.count, 0);
  db.prepare('INSERT OR REPLACE INTO crawls (crawl_ts, count) VALUES (?,?)').run(now, total);
  return {
    crawledAt: now, total,
    withBrand: results.reduce((a, r) => a + r.withBrand, 0),
    gone: results.reduce((a, r) => a + r.gone, 0),
    perCategory: results,
  };
}

// ════════════════════════════════════════════════════════════════════════
//  Аналіз
// ════════════════════════════════════════════════════════════════════════
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x, d = 1) => (x == null ? null : Number(x.toFixed(d)));

function getStatus(db) {
  const crawls = db.prepare('SELECT crawl_ts, count FROM crawls ORDER BY crawl_ts').all();
  return {
    crawlCount: crawls.length,
    firstCrawl: crawls[0]?.crawl_ts || null,
    lastCrawl: crawls.at(-1)?.crawl_ts || null,
    totalOffers: db.prepare('SELECT COUNT(*) n FROM offers').get().n,
    liveOffers: db.prepare('SELECT COUNT(*) n FROM offers WHERE gone_at IS NULL').get().n,
    cities: db.prepare("SELECT city FROM offers WHERE city IS NOT NULL GROUP BY city ORDER BY COUNT(*) DESC LIMIT 40").all().map((r) => r.city),
    categories: db.prepare('SELECT category_id id, COUNT(*) n FROM offers GROUP BY category_id ORDER BY n DESC').all(),
  };
}

function computeTurnover(db, opts = {}) {
  const maxAge = Number(opts.maxAge ?? 21), minSold = Number(opts.minSold ?? 2);
  const city = opts.city || null, type = opts.type || null;
  const categoryId = opts.categoryId ? Number(opts.categoryId) : null;

  let rows = db.prepare('SELECT * FROM offers WHERE brand IS NOT NULL').all();
  if (city) rows = rows.filter((r) => r.city === city);
  if (type) rows = rows.filter((r) => r.type === type);
  if (categoryId) rows = rows.filter((r) => r.category_id === categoryId);

  const byBrand = new Map();
  for (const r of rows) {
    if (!byBrand.has(r.brand)) byBrand.set(r.brand, []);
    byBrand.get(r.brand).push(r);
  }
  const stats = [];
  for (const [brand, items] of byBrand) {
    const live = items.filter((r) => r.gone_at == null);
    const sold = items.filter((r) => r.gone_at != null && r.age_days_at_gone != null &&
      r.age_days_at_gone >= 0 && r.age_days_at_gone <= maxAge);
    if (sold.length < minSold) continue;
    stats.push({
      brand, sold: sold.length, live: live.length, total: items.length,
      sellThrough: round((sold.length / items.length) * 100),
      velocityDays: round(median(sold.map((r) => r.age_days_at_gone))),
      priceSold: round(median(sold.map((r) => r.price_uah).filter((x) => x != null)), 0),
      priceLive: round(median(live.map((r) => r.price_uah).filter((x) => x != null)), 0),
    });
  }
  stats.sort((a, b) => b.sold - a.sold || (a.velocityDays ?? 999) - (b.velocityDays ?? 999));
  return { params: { maxAge, minSold, city, type, categoryId }, rows: stats };
}

// Зріз ПОТОЧНОЇ пропозиції (працює з одного краулу): скільки й яких брендів
// зараз виставлено, частка, присутність на "перших сторінках" (найсвіжіші).
function computeSupply(db, opts = {}) {
  const city = opts.city || null, type = opts.type || null;
  const categoryId = opts.categoryId ? Number(opts.categoryId) : null;
  const fresh = Math.max(20, Number(opts.fresh ?? 80)); // "перші сторінки" ≈ N найсвіжіших

  const last = db.prepare('SELECT crawl_ts FROM crawls ORDER BY crawl_ts DESC LIMIT 1').get()?.crawl_ts;
  let rows = db.prepare('SELECT * FROM offers WHERE gone_at IS NULL').all();
  if (last) rows = rows.filter((r) => r.last_seen === last);      // тільки реально присутні зараз
  if (city) rows = rows.filter((r) => r.city === city);
  if (type) rows = rows.filter((r) => r.type === type);
  if (categoryId) rows = rows.filter((r) => r.category_id === categoryId);

  const totalLive = rows.length;
  const branded = rows.filter((r) => r.brand);
  // "перші сторінки" = найсвіжіші за датою створення
  const freshSet = [...branded]
    .sort((a, b) => (b.created_time || '').localeCompare(a.created_time || ''))
    .slice(0, fresh);
  const freshByBrand = new Map();
  for (const r of freshSet) freshByBrand.set(r.brand, (freshByBrand.get(r.brand) || 0) + 1);

  const byBrand = new Map();
  for (const r of branded) {
    if (!byBrand.has(r.brand)) byBrand.set(r.brand, []);
    byBrand.get(r.brand).push(r);
  }
  const stats = [];
  for (const [brand, items] of byBrand) {
    const prices = items.map((r) => r.price_uah).filter((x) => x != null);
    stats.push({
      brand,
      listings: items.length,
      share: round((items.length / (branded.length || 1)) * 100),
      onFirstPages: freshByBrand.get(brand) || 0,
      promoted: items.filter((r) => r.promoted).length,
      medianPrice: round(median(prices), 0),
      newCount: items.filter((r) => r.condition === 'new').length,
      usedCount: items.filter((r) => r.condition === 'used').length,
    });
  }
  stats.sort((a, b) => b.listings - a.listings);
  return {
    meta: { totalLive, withBrand: branded.length, unbranded: totalLive - branded.length,
            brands: stats.length, fresh, lastCrawl: last },
    rows: stats,
  };
}

// ════════════════════════════════════════════════════════════════════════
//  Фронт (зашитий у сервер — жодних окремих файлів)
// ════════════════════════════════════════════════════════════════════════
// Клієнтська логіка живе як функція; у сторінку вставляється її .toString(),
// тож ${...} всередині лишаються кодом браузера, а не інтерполюються сервером.
function clientApp() {
  const $ = (s) => document.querySelector(s);
  const fmtInt = (n) => (n == null ? '—' : n.toLocaleString('uk-UA'));
  const fmtPrice = (n) => (n == null ? '—' : n.toLocaleString('uk-UA') + ' ₴');
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('uk-UA',
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  let status = null;
  let mode = 'supply';   // 'supply' = пропозиція зараз (1 краул), 'turnover' = оборотність (2+)

  function heatColor(vel, minV, maxV) {
    const gold = [230, 178, 76], cool = [94, 147, 168];
    const t = maxV > minV ? (vel - minV) / (maxV - minV) : 0;
    const c = gold.map((g, i) => Math.round(g + (cool[i] - g) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  async function loadStatus() {
    status = await fetch('/api/status').then((r) => r.json());
    const dot = $('#statusDot');
    dot.dataset.state = status.crawling ? 'busy'
      : status.crawlCount >= 2 ? 'ok' : status.crawlCount === 1 ? 'one' : 'idle';
    $('#statusChips').innerHTML = [
      ['краулів', status.crawlCount], ['активних', fmtInt(status.liveOffers)],
      ['всього', fmtInt(status.totalOffers)], ['останній', fmtDate(status.lastCrawl)],
    ].map(([k, v]) => `<div class="chip"><b>${v}</b><span>${k}</span></div>`).join('');
    $('#footMeta').textContent =
      `категорії ${(status.categoryIds || []).join(', ') || '—'} · розклад ${status.schedule} (${status.tz})`;
    $('#crawlBtn').disabled = status.crawling;
    $('#crawlBtn').textContent = status.crawling ? 'Збираю…' : 'Зібрати зараз';
    const city = $('#city');
    if (city.options.length <= 1 && status.cities?.length)
      for (const c of status.cities) city.add(new Option(c, c));
    const cat = $('#category');
    if (cat.options.length <= 1 && status.categories?.length > 1)
      for (const c of status.categories) cat.add(new Option(`#${c.id} (${c.n})`, c.id));
  }
  function params() {
    return new URLSearchParams({
      maxAge: $('#maxAge').value, minSold: $('#minSold').value,
      city: $('#city').value, type: $('#type').value, categoryId: $('#category').value,
    }).toString();
  }
  const emptyBox = (h, p, btn) =>
    `<div class="empty"><h2>${h}</h2><p>${p}</p>${btn ? '<button class="btn" id="emptyCrawl">Зібрати зараз</button>' : ''}</div>`;

  async function loadBoard() {
    const board = $('#board');
    const needed = mode === 'turnover' ? 2 : 1;
    if (status.crawlCount < needed) {
      const msg = status.crawlCount === 0
        ? 'Ще немає даних. Тисни «Зібрати зараз», щоб зняти перший знімок каталогу.'
        : `Є перший знімок. «Пропозиція зараз» уже доступна — перемкни режим угорі. Оборотність зʼявиться після другого краулу (за розкладом ${status.schedule}, ${status.tz}).`;
      board.innerHTML = emptyBox(status.crawlCount === 0 ? 'Порожньо' : 'Потрібен другий знімок', msg, true);
      $('#emptyCrawl').onclick = crawlNow;
      return;
    }
    return mode === 'supply' ? renderSupply(board) : renderTurnover(board);
  }

  async function renderTurnover(board) {
    const data = await fetch('/api/analyze?' + params()).then((r) => r.json());
    const rows = data.rows || [];
    if (!rows.length) { board.innerHTML = emptyBox('Під ці фільтри ще нема продажів', "Немає молодих оголошень, що зникли за правилом. Пом'якши поріг віку або прибери фільтри."); return; }
    const vels = rows.map((r) => r.velocityDays).filter((v) => v != null);
    const minV = Math.min(...vels), maxV = Math.max(...vels);
    const head = `<div class="grid head"><div class="num">#</div><div>Бренд</div><div>Швидкість продажу · частка</div><div class="num">Продажі</div><div class="num col-sell">Sell-%</div><div class="num">Медіана дн</div><div class="num">Ціна прод.</div><div class="num col-plive">Ціна ринок</div></div>`;
    const body = rows.map((r, i) => {
      const w = Math.max(4, Math.min(100, r.sellThrough ?? 0));
      const color = r.velocityDays != null ? heatColor(r.velocityDays, minV, maxV) : '#8b8398';
      return `<div class="grid row"><div class="num rank ${i < 3 ? 'top' : ''}">${String(i + 1).padStart(2, '0')}</div><div><div class="brandname">${r.brand}</div><div class="brandsub">${r.total} оголошень · ${r.live} активні</div></div><div class="heat"><div class="track"><div class="fill" style="width:${w}%;background:${color}"></div></div><div class="vel" style="color:${color}">${r.velocityDays ?? '—'} дн</div></div><div class="num big">${r.sold}</div><div class="num col-sell">${r.sellThrough ?? '—'}%</div><div class="num dim">${r.velocityDays ?? '—'}</div><div class="num">${fmtPrice(r.priceSold)}</div><div class="num dim col-plive">${fmtPrice(r.priceLive)}</div></div>`;
    }).join('');
    board.innerHTML = head + body;
  }

  async function renderSupply(board) {
    const data = await fetch('/api/supply?' + params()).then((r) => r.json());
    const rows = data.rows || [], meta = data.meta || {};
    if (!rows.length) { board.innerHTML = emptyBox('Ще нема розпізнаних брендів', 'Зроби краул або прибери фільтри. Нерозпізнані назви не рахуються — бренди дописуються в масиві BRANDS.'); return; }
    const maxPromo = Math.max(0.0001, ...rows.map((r) => (r.listings ? r.promoted / r.listings : 0)));
    const cap = `<div class="cap">Активних оголошень зараз: <b>${meta.totalLive ?? '—'}</b> · з розпізнаним брендом: <b>${meta.withBrand ?? '—'}</b> · без бренду: ${meta.unbranded ?? '—'} · «перші сторінки» = ${meta.fresh} найсвіжіших</div>`;
    const head = `<div class="grid head"><div class="num">#</div><div>Бренд</div><div>Частка пропозиції</div><div class="num">Оголошень</div><div class="num col-sell">На 1-х стор.</div><div class="num">Промо</div><div class="num">Медіана ціни</div><div class="num col-plive">Частка</div></div>`;
    const body = rows.map((r, i) => {
      const w = Math.max(4, Math.min(100, r.share ?? 0));
      const t = (r.listings ? r.promoted / r.listings : 0) / maxPromo;
      const c = [139, 131, 152].map((m, idx) => Math.round(m + ([230, 178, 76][idx] - m) * t));
      const color = `rgb(${c[0]},${c[1]},${c[2]})`;
      return `<div class="grid row"><div class="num rank ${i < 3 ? 'top' : ''}">${String(i + 1).padStart(2, '0')}</div><div><div class="brandname">${r.brand}</div><div class="brandsub">${r.newCount} нов · ${r.usedCount} б.у.</div></div><div class="heat"><div class="track"><div class="fill" style="width:${w}%;background:${color}"></div></div><div class="vel" style="color:${color}">${r.share ?? '—'}%</div></div><div class="num big">${r.listings}</div><div class="num col-sell">${r.onFirstPages}</div><div class="num dim">${r.promoted}</div><div class="num">${fmtPrice(r.medianPrice)}</div><div class="num dim col-plive">${r.share ?? '—'}%</div></div>`;
    }).join('');
    board.innerHTML = cap + head + body;
  }
  let polling = false;
  function poll() {
    if (polling) return; polling = true;
    const iv = setInterval(async () => {
      await loadStatus();
      if (!status.crawling) { clearInterval(iv); polling = false; loadBoard(); }
    }, 2500);
  }
  async function crawlNow() {
    let token = localStorage.getItem('adminToken') || '';
    const res = await fetch('/api/crawl', { method: 'POST', headers: token ? { 'x-admin-token': token } : {} });
    if (res.status === 401) {
      token = prompt('Потрібен ADMIN_TOKEN (той, що в env Railway):', '');
      if (!token) return;
      localStorage.setItem('adminToken', token);
      return crawlNow();
    }
    poll();
  }
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
    $('#maxAgeWrap').style.display = mode === 'turnover' ? '' : 'none';
    loadBoard();
  }));
  $('#maxAge').addEventListener('input', () => { $('#maxAgeOut').textContent = $('#maxAge').value + ' дн'; });
  ['maxAge', 'minSold', 'city', 'type', 'category'].forEach((id) => $('#' + id).addEventListener('change', loadBoard));
  $('#crawlBtn').addEventListener('click', crawlNow);
  $('#maxAgeWrap').style.display = mode === 'turnover' ? '' : 'none';
  $('#maxAgeOut').textContent = $('#maxAge').value + ' дн';
  (async () => { await loadStatus(); await loadBoard(); })();
}

const CSS = `
:root{--ink:#16131c;--panel:#1e1a26;--panel-2:#262130;--line:#332c40;--text:#ece6f2;--muted:#8b8398;--gold:#e6b24c;--cool:#5e93a8;--green:#6fbf8a;--r:4px}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1200px 600px at 80% -10%,#221a2e 0%,transparent 60%),var(--ink);color:var(--text);font-family:Inter,system-ui,sans-serif;font-size:14px;min-height:100vh}
.muted{color:var(--muted)}
.topbar{display:flex;align-items:center;gap:18px;padding:14px 20px;border-bottom:1px solid var(--line);background:linear-gradient(var(--panel),var(--ink));position:sticky;top:0;z-index:5}
.brand{display:flex;align-items:center;gap:10px}
.wordmark{font-family:'Space Grotesk',sans-serif;font-weight:700;letter-spacing:.14em;font-size:15px}
.wordmark .sep{color:var(--gold);margin:0 4px}
.tag{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);border:1px solid var(--line);padding:2px 6px;border-radius:999px;letter-spacing:.1em}
.dot{width:9px;height:9px;border-radius:50%;background:var(--muted)}
.dot[data-state=ok]{background:var(--green)}
.dot[data-state=one]{background:var(--gold)}
.dot[data-state=busy]{background:var(--gold);animation:pulse 1s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(230,178,76,.6)}100%{box-shadow:0 0 0 8px rgba(230,178,76,0)}}
.status{display:flex;gap:8px;margin-left:auto;flex-wrap:wrap;font-family:'IBM Plex Mono',monospace;font-size:12px}
.chip{border:1px solid var(--line);border-radius:var(--r);padding:5px 10px;background:var(--panel-2);display:flex;gap:6px;align-items:baseline}
.chip b{color:var(--gold);font-weight:600}
.chip span{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em}
.btn{font-family:'Space Grotesk',sans-serif;font-weight:600;background:var(--gold);color:#201704;border:none;padding:9px 16px;border-radius:var(--r);cursor:pointer}
.btn:hover{filter:brightness(1.08)}
.btn:disabled{opacity:.5;cursor:not-allowed;filter:none}
.controls{display:flex;gap:22px;flex-wrap:wrap;align-items:center;padding:14px 20px;border-bottom:1px solid var(--line);background:var(--panel)}
.controls label{display:flex;flex-direction:column;gap:6px;font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted)}
.controls .hint{text-transform:none;letter-spacing:0;font-size:11px}
.controls select{background:var(--panel-2);color:var(--text);border:1px solid var(--line);border-radius:var(--r);padding:7px 9px;font-family:'IBM Plex Mono',monospace;font-size:13px;min-width:120px}
.rangewrap{display:flex;align-items:center;gap:10px}
.controls input[type=range]{accent-color:var(--gold);width:130px}
.controls output{font-family:'IBM Plex Mono',monospace;color:var(--gold);font-size:13px;min-width:46px}
.board{padding:8px 20px 40px}
.grid{display:grid;grid-template-columns:44px 1.4fr 2fr 72px 72px 92px 110px 110px;align-items:center}
.grid.head{position:sticky;top:57px;z-index:3;font-family:'IBM Plex Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);padding:12px 12px 8px;border-bottom:1px solid var(--line);background:var(--ink)}
.grid.head .num,.grid.row .num{text-align:right}
.grid.row{padding:11px 12px;border-bottom:1px solid #241f2d;animation:fade .35s ease both}
.grid.row:hover{background:var(--panel)}
@keyframes fade{from{opacity:0;transform:translateY(3px)}to{opacity:1}}
@media(prefers-reduced-motion:reduce){.grid.row{animation:none}.dot[data-state=busy]{animation:none}}
.rank{font-family:'IBM Plex Mono',monospace;color:var(--muted);font-size:13px}
.rank.top{color:var(--gold)}
.brandname{font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:15px}
.brandsub{font-size:10px;color:var(--muted);font-family:'IBM Plex Mono',monospace}
.num{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;font-size:14px}
.num.big{font-size:18px;font-weight:600;color:var(--gold)}
.num.dim{color:var(--muted)}
.heat{display:flex;align-items:center;gap:10px;padding-right:16px}
.heat .track{flex:1;height:8px;background:#241f2d;border-radius:999px;overflow:hidden}
.heat .fill{height:100%;border-radius:999px}
.heat .vel{font-family:'IBM Plex Mono',monospace;font-size:12px;min-width:52px;text-align:right}
.empty{margin:60px auto;max-width:520px;text-align:center;border:1px dashed var(--line);border-radius:8px;padding:40px 30px;background:var(--panel)}
.empty h2{font-family:'Space Grotesk',sans-serif;font-size:20px;margin:0 0 10px}
.empty p{color:var(--muted);line-height:1.6;margin:0}
.empty .btn{margin-top:22px}
.foot{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;padding:14px 20px;border-top:1px solid var(--line);font-family:'IBM Plex Mono',monospace;font-size:11px}
.seg{display:flex;border:1px solid var(--line);border-radius:var(--r);overflow:hidden;align-self:end}
.seg button{background:var(--panel-2);color:var(--muted);border:none;padding:8px 14px;cursor:pointer;font-family:'Space Grotesk',sans-serif;font-size:12px;font-weight:600}
.seg button.on{background:var(--gold);color:#201704}
.seg button:not(.on):hover{color:var(--text)}
.cap{font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--muted);padding:6px 12px 12px}
.cap b{color:var(--gold)}
@media(max-width:820px){.grid{grid-template-columns:34px 1.3fr 100px 64px 90px}.grid .heat,.grid .col-sell,.grid .col-plive{display:none}.status{display:none}}
`;

const PAGE = `<!doctype html><html lang="uk"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Parfum · Turnover Terminal</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500&display=swap" rel="stylesheet"/>
<style>${CSS}</style></head><body>
<header class="topbar"><div class="brand"><span class="dot" id="statusDot" data-state="idle"></span>
<span class="wordmark">PARFUM<span class="sep">·</span>TURNOVER</span><span class="tag">OLX.ua</span></div>
<div class="status" id="statusChips"><span class="muted">завантаження…</span></div>
<button class="btn" id="crawlBtn">Зібрати зараз</button></header>
<section class="controls">
<div class="seg"><button data-mode="supply" class="on">Пропозиція зараз</button><button data-mode="turnover">Оборотність</button></div>
<label id="maxAgeWrap">Правило продажу<span class="hint">зникло у віці ≤</span>
<span class="rangewrap"><input type="range" id="maxAge" min="5" max="45" step="1" value="21"/><output id="maxAgeOut">21 дн</output></span></label>
<label>Категорія<select id="category"><option value="">усі</option></select></label>
<label>Місто<select id="city"><option value="">вся Україна</option></select></label>
<label>Тип<select id="type"><option value="">будь-який</option><option value="full">флакон</option><option value="tester">тестер</option><option value="decant">розпив</option></select></label>
<label>Мін. продажів<select id="minSold"><option>2</option><option>3</option><option>5</option><option>8</option></select></label>
</section>
<main class="board" id="board"></main>
<footer class="foot"><span id="footMeta" class="muted"></span>
<span class="muted">продаж ≈ молоде оголошення зникло · це проксі, дивись медіани</span></footer>
<script>(${clientApp.toString()})()</script>
</body></html>`;

// ════════════════════════════════════════════════════════════════════════
//  Сервер
// ════════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
const CATEGORY_IDS = (process.env.OLX_CATEGORY_IDS || process.env.OLX_CATEGORY_ID || '')
  .split(',').map((s) => s.trim()).filter(Boolean).map(Number);
const REGION_ID = process.env.OLX_REGION_ID ? Number(process.env.OLX_REGION_ID) : null;
const CRAWL_SCHEDULE = process.env.CRAWL_SCHEDULE || '0 9 * * *';
const TZ = process.env.TZ || 'Europe/Kyiv';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const CRAWL_ON_START = process.env.CRAWL_ON_START === '1';

const db = openDb();
let crawling = false, lastRun = null;

async function doCrawl(trigger) {
  if (crawling) return { skipped: true };
  if (CATEGORY_IDS.length === 0) return { error: 'не задано OLX_CATEGORY_IDS' };
  crawling = true;
  try {
    console.log(`[crawl] старт (${trigger})`);
    const summary = await runCrawlCycle({ db, categoryIds: CATEGORY_IDS, regionId: REGION_ID,
      onProgress: (m) => process.stdout.write(`\r[crawl] ${m}        `) });
    process.stdout.write('\n');
    console.log(`[crawl] готово: ${summary.total} офферів, зникло ${summary.gone}`);
    lastRun = { ...summary, trigger };
    return summary;
  } catch (e) { console.error('[crawl] помилка:', e.message); return { error: e.message }; }
  finally { crawling = false; }
}

const app = express();
app.use(express.json());
app.get('/', (req, res) => res.type('html').send(PAGE));
app.get('/api/status', (req, res) => res.json({
  ...getStatus(db), categoryIds: CATEGORY_IDS, regionId: REGION_ID,
  schedule: CRAWL_SCHEDULE, tz: TZ, crawling, lastRun, dbPath: DB_PATH,
}));
app.get('/api/analyze', (req, res) => {
  try { res.json(computeTurnover(db, req.query)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/supply', (req, res) => {
  try { res.json(computeSupply(db, req.query)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/crawl', (req, res) => {
  if (ADMIN_TOKEN && req.get('x-admin-token') !== ADMIN_TOKEN)
    return res.status(401).json({ error: 'потрібен вірний x-admin-token' });
  if (crawling) return res.status(409).json({ error: 'краул уже виконується' });
  doCrawl('manual');
  res.json({ started: true });
});

app.listen(PORT, () => {
  console.log(`OLX Parfum Terminal → http://localhost:${PORT}`);
  console.log(`  БД: ${DB_PATH}`);
  console.log(`  Категорії: ${CATEGORY_IDS.join(', ') || '(не задано!)'}`);
  console.log(`  Розклад: "${CRAWL_SCHEDULE}" (${TZ})`);
  if (CATEGORY_IDS.length && cron.validate(CRAWL_SCHEDULE))
    cron.schedule(CRAWL_SCHEDULE, () => doCrawl('cron'), { timezone: TZ });
  if (CRAWL_ON_START) doCrawl('startup');
});
