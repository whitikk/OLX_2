import { openDb } from './lib/db.js';
import { runCrawlCycle } from './lib/crawl.js';

const CATEGORY_IDS = (process.env.OLX_CATEGORY_IDS || process.env.OLX_CATEGORY_ID || '')
  .split(',').map((s) => s.trim()).filter(Boolean).map(Number);
const REGION_ID = process.env.OLX_REGION_ID ? Number(process.env.OLX_REGION_ID) : null;

if (!CATEGORY_IDS.length) {
  console.error('Задай OLX_CATEGORY_IDS. Приклад: OLX_CATEGORY_IDS=1665,1666 npm run crawl');
  process.exit(1);
}

const db = openDb();
const summary = await runCrawlCycle({
  db, categoryIds: CATEGORY_IDS, regionId: REGION_ID,
  onProgress: (m) => process.stdout.write(`\r${m}        `),
});
process.stdout.write('\n');
console.log(`Готово: ${summary.total} офферів (бренд: ${summary.withBrand}), зникло ${summary.gone}`);
db.close();
