import express from 'express';
import cron from 'node-cron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb, DB_PATH } from './lib/db.js';
import { runCrawlCycle } from './lib/crawl.js';
import { computeTurnover, getStatus } from './lib/analyze.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Конфіг з env ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const CATEGORY_IDS = (process.env.OLX_CATEGORY_IDS || process.env.OLX_CATEGORY_ID || '')
  .split(',').map((s) => s.trim()).filter(Boolean).map(Number);
const REGION_ID = process.env.OLX_REGION_ID ? Number(process.env.OLX_REGION_ID) : null;
const CRAWL_SCHEDULE = process.env.CRAWL_SCHEDULE || '0 9 * * *';   // щодня 09:00
const TZ = process.env.TZ || 'Europe/Kyiv';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';                  // захист ручного краулу
const CRAWL_ON_START = process.env.CRAWL_ON_START === '1';

const db = openDb();
let crawling = false;      // не даємо запустити два краули одночасно
let lastRun = null;        // підсумок останнього краулу для UI

async function doCrawl(trigger) {
  if (crawling) return { skipped: true, reason: 'вже виконується' };
  if (CATEGORY_IDS.length === 0) return { error: 'не задано OLX_CATEGORY_IDS' };
  crawling = true;
  try {
    console.log(`[crawl] старт (${trigger})`);
    const summary = await runCrawlCycle({
      db, categoryIds: CATEGORY_IDS, regionId: REGION_ID,
      onProgress: (m) => process.stdout.write(`\r[crawl] ${m}        `),
    });
    process.stdout.write('\n');
    console.log(`[crawl] готово: ${summary.total} офферів, зникло ${summary.gone}`);
    lastRun = { ...summary, trigger };
    return summary;
  } catch (e) {
    console.error('[crawl] помилка:', e.message);
    return { error: e.message };
  } finally {
    crawling = false;
  }
}

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Статус: краули, кількості, міста, категорії — для шапки й фільтрів.
app.get('/api/status', (req, res) => {
  res.json({
    ...getStatus(db),
    categoryIds: CATEGORY_IDS,
    regionId: REGION_ID,
    schedule: CRAWL_SCHEDULE,
    tz: TZ,
    crawling,
    lastRun,
    dbPath: DB_PATH,
  });
});

// Аналіз оборотності.
app.get('/api/analyze', (req, res) => {
  try {
    res.json(computeTurnover(db, req.query));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Ручний запуск краулу. Захищено ADMIN_TOKEN (якщо заданий).
app.post('/api/crawl', async (req, res) => {
  if (ADMIN_TOKEN && req.get('x-admin-token') !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'потрібен вірний x-admin-token' });
  }
  if (crawling) return res.status(409).json({ error: 'краул уже виконується' });
  // не тримаємо HTTP-запит на весь краул — запускаємо у фоні
  doCrawl('manual');
  res.json({ started: true });
});

app.listen(PORT, () => {
  console.log(`OLX Parfum Terminal → http://localhost:${PORT}`);
  console.log(`  БД: ${DB_PATH}`);
  console.log(`  Категорії: ${CATEGORY_IDS.join(', ') || '(не задано!)'}`);
  console.log(`  Розклад: "${CRAWL_SCHEDULE}" (${TZ})`);

  if (CATEGORY_IDS.length && cron.validate(CRAWL_SCHEDULE)) {
    cron.schedule(CRAWL_SCHEDULE, () => doCrawl('cron'), { timezone: TZ });
  }
  if (CRAWL_ON_START) doCrawl('startup');
});
