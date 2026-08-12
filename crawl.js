import { detectBrand, detectType, extractLine } from './brands.js';

const LIMIT = 40;
const MAX_OFFSET = 1000;      // OLX ріже глибоку пагінацію; глибше — сегментуй
const DELAY_MS = 700;
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
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.5',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} (offset ${offset})`);
  return res.json();
}

function parsePrice(params = []) {
  const v = params.find((x) => x.key === 'price')?.value?.value;
  return typeof v === 'number' ? v : null;
}
function parseCondition(params = []) {
  const k = params.find((x) => x.key === 'state')?.value?.key;
  return k === 'new' ? 'new' : k === 'used' ? 'used' : 'unknown';
}
function normalize(o, categoryId) {
  const title = o.title || '';
  const brand = detectBrand(title);
  return {
    offer_id: o.id,
    category_id: categoryId,
    title,
    brand,
    line: extractLine(title, brand),
    type: detectType(title),
    price_uah: parsePrice(o.params),
    condition: parseCondition(o.params),
    city: o.location?.city?.name || null,
    region: o.location?.region?.name || null,
    created_time: o.created_time ? new Date(o.created_time).toISOString() : null,
    promoted:
      o.promotion?.highlighted || o.promotion?.top_ad || o.promotion?.urgent ? 1 : 0,
  };
}

// Краулить ОДНУ категорію в межах циклу з міткою часу `now`.
// `prev` — час попереднього циклу (для відмітки зниклих). Повертає підсумок.
export async function crawlCategory({ db, categoryId, regionId, now, prev, onProgress }) {
  const seen = [];
  for (let offset = 0; offset <= MAX_OFFSET; offset += LIMIT) {
    let page;
    try {
      page = await fetchPage(categoryId, regionId, offset);
    } catch (e) {
      if (onProgress) onProgress(`cat ${categoryId}: ${e.message} — стоп`);
      break;
    }
    const data = page.data || [];
    if (data.length === 0) break;
    for (const o of data) seen.push(normalize(o, categoryId));
    if (onProgress) onProgress(`cat ${categoryId}: ${seen.length}`);
    if (!page.links?.next?.href) break;
    await sleep(DELAY_MS);
  }

  if (seen.length === 0) return { categoryId, count: 0, withBrand: 0, gone: 0 };

  // Межа покриття для ЦІЄЇ категорії — щоб не рахувати зниклим те, що просто
  // не догорнули через ліміт пагінації.
  const oldestCovered = seen
    .map((s) => s.created_time)
    .filter(Boolean)
    .sort()[0];

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

  const tx = db.transaction((rows) => {
    for (const r of rows) upsert.run({ ...r, now });
  });
  tx(seen);

  let gone = 0;
  if (prev) {
    gone = db.prepare(`
      UPDATE offers
      SET gone_at = @now,
          age_days_at_gone = julianday(@now) - julianday(created_time)
      WHERE gone_at IS NULL
        AND category_id = @categoryId
        AND last_seen = @prev
        AND last_seen != @now
        AND created_time >= @oldest
    `).run({ now, prev, categoryId, oldest: oldestCovered }).changes;
  }

  return { categoryId, count: seen.length, withBrand: seen.filter((s) => s.brand).length, gone };
}

// Повний цикл: усі категорії під одним `now`, один рядок у crawls.
export async function runCrawlCycle({ db, categoryIds, regionId, onProgress }) {
  const now = new Date().toISOString();
  const prev = db.prepare('SELECT crawl_ts FROM crawls ORDER BY crawl_ts DESC LIMIT 1')
    .get()?.crawl_ts || null;

  const results = [];
  for (const categoryId of categoryIds) {
    results.push(await crawlCategory({ db, categoryId, regionId, now, prev, onProgress }));
  }

  const total = results.reduce((a, r) => a + r.count, 0);
  db.prepare('INSERT OR REPLACE INTO crawls (crawl_ts, count) VALUES (?,?)').run(now, total);

  return {
    crawledAt: now,
    total,
    withBrand: results.reduce((a, r) => a + r.withBrand, 0),
    gone: results.reduce((a, r) => a + r.gone, 0),
    perCategory: results,
  };
}
