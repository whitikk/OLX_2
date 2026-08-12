const $ = (s) => document.querySelector(s);
const fmtInt = (n) => (n == null ? '—' : n.toLocaleString('uk-UA'));
const fmtPrice = (n) => (n == null ? '—' : n.toLocaleString('uk-UA') + ' ₴');
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

let status = null;

// колір heat bar: fastest(minV)→gold, slowest(maxV)→cool
function heatColor(vel, minV, maxV) {
  const gold = [230, 178, 76], cool = [94, 147, 168];
  const t = maxV > minV ? (vel - minV) / (maxV - minV) : 0;
  const c = gold.map((g, i) => Math.round(g + (cool[i] - g) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

async function loadStatus() {
  status = await fetch('/api/status').then((r) => r.json());
  renderStatus();
  fillFilters();
}

function renderStatus() {
  const dot = $('#statusDot');
  if (status.crawling) dot.dataset.state = 'busy';
  else if (status.crawlCount >= 2) dot.dataset.state = 'ok';
  else if (status.crawlCount === 1) dot.dataset.state = 'one';
  else dot.dataset.state = 'idle';

  $('#statusChips').innerHTML = [
    ['краулів', status.crawlCount],
    ['активних', fmtInt(status.liveOffers)],
    ['всього', fmtInt(status.totalOffers)],
    ['останній', fmtDate(status.lastCrawl)],
  ].map(([k, v]) => `<div class="chip"><b>${v}</b><span>${k}</span></div>`).join('');

  $('#footMeta').textContent =
    `категорії ${status.categoryIds.join(', ') || '—'} · розклad ${status.schedule} (${status.tz})`
      .replace('розклad', 'розклад');

  $('#crawlBtn').disabled = status.crawling;
  $('#crawlBtn').textContent = status.crawling ? 'Збираю…' : 'Зібрати зараз';
}

function fillFilters() {
  const city = $('#city');
  if (city.options.length <= 1 && status.cities?.length) {
    for (const c of status.cities) city.add(new Option(c, c));
  }
  const cat = $('#category');
  if (cat.options.length <= 1 && status.categories?.length > 1) {
    for (const c of status.categories) cat.add(new Option(`#${c.id} (${c.n})`, c.id));
  }
}

function params() {
  return new URLSearchParams({
    maxAge: $('#maxAge').value,
    minSold: $('#minSold').value,
    city: $('#city').value,
    type: $('#type').value,
    categoryId: $('#category').value,
  }).toString();
}

async function loadBoard() {
  const board = $('#board');
  if (status.crawlCount < 2) return renderEmpty(board);

  const data = await fetch('/api/analyze?' + params()).then((r) => r.json());
  const rows = data.rows || [];
  if (!rows.length) {
    board.innerHTML = `<div class="empty"><h2>Під ці фільтри ще нема продажів</h2>
      <p>Немає молодих оголошень, що зникли за правилом. Пом'якши поріг віку або прибери фільтри міста/типу.</p></div>`;
    return;
  }

  const vels = rows.map((r) => r.velocityDays).filter((v) => v != null);
  const minV = Math.min(...vels), maxV = Math.max(...vels);

  const head = `<div class="grid head">
    <div class="num">#</div><div>Бренд</div>
    <div>Швидкість продажу · частка</div>
    <div class="num">Продажі</div>
    <div class="num col-sell">Sell-%</div>
    <div class="num">Медіана дн</div>
    <div class="num">Ціна прод.</div>
    <div class="num col-plive">Ціна ринок</div>
  </div>`;

  const body = rows.map((r, i) => {
    const w = Math.max(4, Math.min(100, r.sellThrough ?? 0));
    const color = r.velocityDays != null ? heatColor(r.velocityDays, minV, maxV) : 'var(--muted)';
    return `<div class="grid row">
      <div class="num rank ${i < 3 ? 'top' : ''}">${String(i + 1).padStart(2, '0')}</div>
      <div><div class="brandname">${r.brand}</div>
        <div class="brandsub">${r.total} оголошень · ${r.live} активні</div></div>
      <div class="heat">
        <div class="track"><div class="fill" style="width:${w}%;background:${color}"></div></div>
        <div class="vel" style="color:${color}">${r.velocityDays ?? '—'} дн</div>
      </div>
      <div class="num big">${r.sold}</div>
      <div class="num col-sell">${r.sellThrough ?? '—'}%</div>
      <div class="num dim">${r.velocityDays ?? '—'}</div>
      <div class="num">${fmtPrice(r.priceSold)}</div>
      <div class="num dim col-plive">${fmtPrice(r.priceLive)}</div>
    </div>`;
  }).join('');

  board.innerHTML = head + body;
}

function renderEmpty(board) {
  const msg = status.crawlCount === 0
    ? `Ще немає даних. Тисни «Зібрати зараз», щоб зняти перший знімок каталогу — і повтори завтра.`
    : `Є перший знімок. Оборотність зʼявиться після другого краулу: наступний за розкладом (${status.schedule}, ${status.tz}), або тисни «Зібрати зараз» іншого дня.`;
  board.innerHTML = `<div class="empty">
    <h2>${status.crawlCount === 0 ? 'Порожньо' : 'Потрібен другий знімок'}</h2>
    <p>${msg}</p>
    <button class="btn" id="emptyCrawl">Зібрати зараз</button>
  </div>`;
  $('#emptyCrawl').onclick = crawlNow;
}

async function crawlNow() {
  let token = localStorage.getItem('adminToken') || '';
  const res = await fetch('/api/crawl', {
    method: 'POST',
    headers: token ? { 'x-admin-token': token } : {},
  });
  if (res.status === 401) {
    token = prompt('Потрібен ADMIN_TOKEN (той, що в env Railway):', '');
    if (!token) return;
    localStorage.setItem('adminToken', token);
    return crawlNow();
  }
  // краул іде у фоні — опитуємо статус, поки не завершиться
  poll();
}

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  const iv = setInterval(async () => {
    await loadStatus();
    if (!status.crawling) {
      clearInterval(iv); polling = false;
      loadBoard();
    }
  }, 2500);
}

// події
$('#maxAge').addEventListener('input', () => {
  $('#maxAgeOut').textContent = $('#maxAge').value + ' дн';
});
['maxAge', 'minSold', 'city', 'type', 'category'].forEach((id) =>
  $('#' + id).addEventListener('change', loadBoard));
$('#crawlBtn').addEventListener('click', crawlNow);

// старт
$('#maxAgeOut').textContent = $('#maxAge').value + ' дн';
(async () => { await loadStatus(); await loadBoard(); })();
