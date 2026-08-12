const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x, d = 1) => (x == null ? null : Number(x.toFixed(d)));

export function getStatus(db) {
  const crawls = db.prepare('SELECT crawl_ts, count FROM crawls ORDER BY crawl_ts').all();
  const totalOffers = db.prepare('SELECT COUNT(*) n FROM offers').get().n;
  const liveOffers = db.prepare('SELECT COUNT(*) n FROM offers WHERE gone_at IS NULL').get().n;
  const cities = db.prepare(
    "SELECT city FROM offers WHERE city IS NOT NULL GROUP BY city ORDER BY COUNT(*) DESC LIMIT 40"
  ).all().map((r) => r.city);
  const categories = db.prepare(
    'SELECT category_id id, COUNT(*) n FROM offers GROUP BY category_id ORDER BY n DESC'
  ).all();
  return {
    crawlCount: crawls.length,
    firstCrawl: crawls[0]?.crawl_ts || null,
    lastCrawl: crawls.at(-1)?.crawl_ts || null,
    totalOffers,
    liveOffers,
    cities,
    categories,
  };
}

// Оборотність по брендах. Опції: { maxAge, city, type, minSold, categoryId }.
export function computeTurnover(db, opts = {}) {
  const maxAge = Number(opts.maxAge ?? 21);
  const minSold = Number(opts.minSold ?? 2);
  const city = opts.city || null;
  const type = opts.type || null;
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
    const sold = items.filter(
      (r) => r.gone_at != null && r.age_days_at_gone != null &&
        r.age_days_at_gone >= 0 && r.age_days_at_gone <= maxAge
    );
    if (sold.length < minSold) continue;

    stats.push({
      brand,
      sold: sold.length,
      live: live.length,
      total: items.length,
      sellThrough: round((sold.length / items.length) * 100),
      velocityDays: round(median(sold.map((r) => r.age_days_at_gone))),
      priceSold: round(median(sold.map((r) => r.price_uah).filter((x) => x != null)), 0),
      priceLive: round(median(live.map((r) => r.price_uah).filter((x) => x != null)), 0),
    });
  }

  stats.sort((a, b) =>
    b.sold - a.sold || (a.velocityDays ?? 999) - (b.velocityDays ?? 999));

  return { params: { maxAge, minSold, city, type, categoryId }, rows: stats };
}
