// Словник брендів. Кожен запис: канонічна назва + regex з варіантами
// написання (латиниця, кирилиця, алаяси). Список неповний — доповнюй під
// свою нішу, це найважливіша частина точності аналізу.
const BRANDS = [
  { name: 'Dior',              rx: /\b(dior|sauvage|діор|диор|саваж|соваж)\b/iu },
  { name: 'Chanel',            rx: /\b(chanel|шанель|bleu de chanel)\b/iu },
  { name: 'Tom Ford',          rx: /\b(tom\s*ford|том\s*форд)\b/iu },
  { name: 'YSL',               rx: /\b(ysl|yves\s*saint\s*laurent|сен[-\s]?лоран|ів\s*сен)\b/iu },
  { name: 'Lancome',           rx: /\b(lancome|lancôme|ланком)\b/iu },
  { name: 'Versace',           rx: /\b(versace|версаче|версаус)\b/iu },
  { name: 'Giorgio Armani',    rx: /\b(armani|армані|армани|acqua di gio|аква ди джио)\b/iu },
  { name: 'Paco Rabanne',      rx: /\b(paco\s*rabanne|rabanne|пако\s*рабан|рабан)\b/iu },
  { name: 'Jean Paul Gaultier',rx: /\b(jean\s*paul\s*gaultier|jpg|готьє|готье|le male)\b/iu },
  { name: 'Hugo Boss',         rx: /\b(hugo\s*boss|hugo|boss\b|хьюго\s*бос|бос)\b/iu },
  { name: 'Calvin Klein',      rx: /\b(calvin\s*klein|ck\s*one|кельвін\s*кл|келвин\s*кл|\bck\b)\b/iu },
  { name: 'Dolce & Gabbana',   rx: /\b(dolce\s*&?\s*gabbana|d&g|dg\b|дольче|габбана)\b/iu },
  { name: 'Givenchy',          rx: /\b(givenchy|живанші|живанши)\b/iu },
  { name: 'Guerlain',          rx: /\b(guerlain|герлен)\b/iu },
  { name: 'Creed',             rx: /\b(creed|крід|крид|aventus|авентус)\b/iu },
  { name: 'Montale',           rx: /\b(montale|монталь)\b/iu },
  { name: 'Mancera',           rx: /\b(mancera|мансера)\b/iu },
  { name: 'Lattafa',           rx: /\b(lattafa|латтафа|khamrah|хамра|asad|асад)\b/iu },
  { name: 'Armaf',             rx: /\b(armaf|армаф|club de nuit|клуб де нуит)\b/iu },
  { name: 'Xerjoff',           rx: /\b(xerjoff|ксерджофф|зерджофф)\b/iu },
  { name: 'Byredo',            rx: /\b(byredo|байредо)\b/iu },
  { name: 'MFK',               rx: /\b(mfk|maison\s*francis\s*kurkdjian|baccarat|баккара)\b/iu },
  { name: 'Nishane',           rx: /\b(nishane|нишане|нішане)\b/iu },
  { name: 'Parfums de Marly',  rx: /\b(parfums?\s*de\s*marly|pdm|марли|марлі|layton|delina)\b/iu },
  { name: 'Prada',             rx: /\b(prada|прада)\b/iu },
  { name: 'Gucci',             rx: /\b(gucci|гуччі|гуччи)\b/iu },
  { name: 'Burberry',          rx: /\b(burberry|барбері|барберри)\b/iu },
  { name: 'Kenzo',             rx: /\b(kenzo|кензо)\b/iu },
  { name: 'Kilian',            rx: /\b(kilian|кіліан|килиан)\b/iu },
  { name: 'Amouage',           rx: /\b(amouage|амуаж)\b/iu },
  { name: 'Initio',            rx: /\b(initio|инитио|ініціо)\b/iu },
  { name: 'Bvlgari',           rx: /\b(bvlgari|bulgari|булгарі|булгари)\b/iu },
  { name: 'Carolina Herrera',  rx: /\b(carolina\s*herrera|good\s*girl|каролина эррера|360)\b/iu },
  { name: 'Azzaro',            rx: /\b(azzaro|азаро|the most wanted)\b/iu },
  { name: 'Narciso Rodriguez', rx: /\b(narciso|нарцисо|нарциссо)\b/iu },
  { name: 'Mugler',            rx: /\b(mugler|thierry\s*mugler|мюглер|alien|angel)\b/iu },
  { name: 'Escentric Molecules',rx: /\b(escentric|molecule|молекула|молекюл)\b/iu },
  { name: 'Zara',              rx: /\b(zara|зара)\b/iu },
];

// Стоп-слова, які прибираємо при вгадуванні лінійки.
const STOP = new Set([
  'мл', 'ml', 'ml.', 'г', 'парфум', 'парфуми', 'парфюм', 'духи', 'туалетна',
  'парфумована', 'парфюмированная', 'вода', 'вод', 'edp', 'edt', 'edc', 'parfum',
  'оригінал', 'оригинал', 'original', 'тестер', 'tester', 'розпив', 'распив',
  'відлив', 'отлив', 'ліцензія', 'лицензия', 'люкс', 'lux', 'новий', 'нова',
  'новые', 'new', 'for', 'men', 'women', 'жіночі', 'чоловічі', 'женский',
  'мужской', 'аромат', 'perfume', 'the', 'de', 'на', 'і', 'та', 'и', 'ua',
]);

export function detectBrand(title) {
  if (!title) return null;
  for (const b of BRANDS) {
    if (b.rx.test(title)) return b.name;
  }
  return null;
}

export function detectType(title) {
  const t = (title || '').toLowerCase();
  if (/розпив|распив|відлив|отлив|decant|\bмл\b.*\bмл\b/u.test(t)) return 'decant';
  if (/тестер|tester/u.test(t)) return 'tester';
  return 'full';
}

// Груба здогадка по лінійці: прибираємо бренд, об'єми, стоп-слова, беремо
// перші кілька значущих токенів. Це чернетка для угруповання, не істина.
export function extractLine(title, brand) {
  if (!title) return null;
  let t = title.toLowerCase();
  const b = BRANDS.find((x) => x.name === brand);
  if (b) t = t.replace(b.rx, ' ');
  t = t
    .replace(/\d+[\s]?(мл|ml|г|g)\b/gu, ' ')  // об'єми
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')          // пунктуація
    .replace(/\s+/gu, ' ')
    .trim();
  const tokens = t
    .split(' ')
    .filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
  const line = tokens.slice(0, 3).join(' ').trim();
  return line || null;
}
