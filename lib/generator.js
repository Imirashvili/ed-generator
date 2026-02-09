// ed-generator/lib/generator.js

const MONTHS_GEN = [
  "января","февраля","марта","апреля","мая","июня",
  "июля","августа","сентября","октября","ноября","декабря"
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function clampInt(n, min, max) {
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

// ===================== TIME =====================
// Требование: везде двоеточие 18:30-20:30, а в тексте "с 18:30 до 20:30"
export function normalizeTimeRange(raw) {
  if (!raw) return { ok: false, error: "Пустое время" };
  const s = String(raw).trim()
    .replace(/\s+/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\./g, ":");

  // ожидаем 18:30-20:30
  const m = s.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) return { ok: false, error: `Неверный формат времени: ${raw}` };

  const h1 = clampInt(Number(m[1]), 0, 23);
  const min1 = clampInt(Number(m[2]), 0, 59);
  const h2 = clampInt(Number(m[3]), 0, 23);
  const min2 = clampInt(Number(m[4]), 0, 59);

  if (h1 === null || min1 === null || h2 === null || min2 === null) {
    return { ok: false, error: `Неверные часы/минуты: ${raw}` };
  }

  const t1 = h1 * 60 + min1;
  const t2 = h2 * 60 + min2;
  if (t2 <= t1) return { ok: false, error: `Время окончания раньше начала: ${raw}` };

  const from = `${pad2(h1)}:${pad2(min1)}`;
  const to = `${pad2(h2)}:${pad2(min2)}`;

  return {
    ok: true,
    fromMinutes: t1,
    toMinutes: t2,
    timeText: `с ${from} до ${to}`,
    key: `${pad2(h1)}:${pad2(min1)}-${pad2(h2)}:${pad2(min2)}`
  };
}

// ===================== DATE =====================
export function parseRuDate(raw) {
  // dd.mm.yyyy
  if (!raw) return { ok: false, error: "Пустая дата" };
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return { ok: false, error: `Неверный формат даты: ${raw}` };

  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);

  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { ok: false, error: `Неверная дата: ${raw}` };

  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== (mo - 1) || dt.getUTCDate() !== d) {
    return { ok: false, error: `Несуществующая дата: ${raw}` };
  }
  return { ok: true, y, m: mo, d, ts: dt.getTime() };
}

export function formatDateHuman(dObj) {
  return `${dObj.d} ${MONTHS_GEN[dObj.m - 1]}`;
}

export function formatDateListHuman(dates) {
  if (!dates.length) return "";
  if (dates.length === 1) return formatDateHuman(dates[0]);

  const sameMonth = dates.every((x) => x.m === dates[0].m && x.y === dates[0].y);

  if (!sameMonth) {
    if (dates.length === 2) {
      return `${formatDateHuman(dates[0])} и ${formatDateHuman(dates[1])}`;
    }
    const parts = dates.map(formatDateHuman);
    return `${parts.slice(0, -1).join(", ")} и ${parts[parts.length - 1]}`;
  }

  const monthWord = MONTHS_GEN[dates[0].m - 1];
  const days = dates.map((x) => x.d);

  if (days.length === 2) {
    return `${days[0]} и ${days[1]} ${monthWord}`;
  }

  return `${days.slice(0, -1).join(", ")} и ${days[days.length - 1]} ${monthWord}`;
}

function areConsecutiveDays(dates) {
  if (dates.length <= 1) return true;
  for (let i = 1; i < dates.length; i++) {
    const prev = dates[i - 1].ts;
    const cur = dates[i].ts;
    if (cur - prev !== 24 * 60 * 60 * 1000) return false;
  }
  return true;
}

// ===================== PUSH RELATIVE (пикеты/встречи) =====================
// Требование: для 2+ подряд пикетов:
// - до 6 подряд: "Ближайшие N дней" (для 3 — словами "три")
// - если 7: "Ближайшую неделю"
function ruNumberWord(n) {
  // Нужны именно слова хотя бы для 3; сделаем 2..6
  const map = {
    2: "два",
    3: "три",
    4: "четыре",
    5: "пять",
    6: "шесть",
  };
  return map[n] || String(n);
}

function ruDayWord(n) {
  // день/дня/дней
  if (n % 100 >= 11 && n % 100 <= 14) return "дней";
  const last = n % 10;
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дня";
  return "дней";
}

export function buildPushRelative(dates) {
  // В v0.1: "Завтра..." — шаблонный текст без вычисления по календарю.
  if (!dates.length) return "";
  if (dates.length === 1) return "Завтра";

  const consecutive = areConsecutiveDays(dates);
  if (consecutive) {
    // для 7 подряд — неделя
    if (dates.length === 7) return "Ближайшую неделю";

    // правило актуально максимум для 6 подряд (как ты и просил)
    if (dates.length >= 2 && dates.length <= 6) {
      const nWord = ruNumberWord(dates.length);
      const dWord = ruDayWord(dates.length);
      return `Ближайшие ${nWord} ${dWord}`;
    }

    // fallback, если вдруг >7 (на всякий случай)
    return `Ближайшие ${dates.length} ${ruDayWord(dates.length)}`;
  }

  // если не подряд — показываем списком дат
  return formatDateListHuman(dates);
}

// ===================== TEMPLATES =====================
export function renderTemplate(str, vars) {
  let out = str ?? "";
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v ?? "");
  }
  return out;
}

// ===================== TSV PARSE =====================
export function parseTSV(tsv, eventType) {
  const lines = String(tsv || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (!lines.length) return { rows: [], errors: ["Пустая вставка"] };

  const rows = [];
  const errors = [];

  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split("\t").map((c) => c.trim());
    const rowNum = i + 1;

    if (eventType === "obhod") {
      // Округ, Адрес, Дата обхода, Время обхода
      if (cols.length < 4) {
        errors.push(`Строка ${rowNum}: ожидалось 4 колонки (Округ, Адрес, Дата обхода, Время обхода)`);
        continue;
      }
      rows.push({
        rowNum,
        okrug_row: cols[0],
        address: cols[1],
        date_raw: cols[2],
        time_raw: cols[3],
      });
    } else {
      // piket/vstrecha (пока оставляем старую схему: 8 колонок)
      if (cols.length < 8) {
        errors.push(`Строка ${rowNum}: ожидалось 8 колонок (Округ, Адрес, Дата старта, Дата окончания, Тематика, Место проведения, Дата, Время)`);
        continue;
      }
      rows.push({
        rowNum,
        okrug_row: cols[0],
        address: cols[1],
        oss_start_raw: cols[2],
        oss_end_raw: cols[3],
        topic_raw: cols[4],
        place_raw: cols[5],
        date_raw: cols[6],
        time_raw: cols[7],
      });
    }
  }

  return { rows, errors };
}

// ===================== PIKET/VSTRECHA GROUPING =====================
export function buildGroups(rows, eventType, scenarioKey, placeOverrides) {
  const groupsMap = new Map();
  const rowErrors = [];

  for (const r of rows) {
    const t = normalizeTimeRange(r.time_raw);
    if (!t.ok) {
      rowErrors.push({ rowNum: r.rowNum, error: t.error });
      continue;
    }

    const d = parseRuDate(r.date_raw);
    if (!d.ok) {
      rowErrors.push({ rowNum: r.rowNum, error: d.error });
      continue;
    }

    const address = (r.address || "").trim();
    if (!address) {
      rowErrors.push({ rowNum: r.rowNum, error: "Пустой адрес" });
      continue;
    }

    const key = `${eventType}|${scenarioKey}|${address}|${t.key}`;
    if (!groupsMap.has(key)) {
      const placeOriginal = r.place_raw ?? "";
      const override = placeOverrides?.[r.rowNum]?.place_final;
      const placeFinal = override ?? placeOriginal;

      groupsMap.set(key, {
        key,
        eventType,
        scenarioKey,
        address,
        time: t,
        dates: [],
        place_original: placeOriginal,
        place_final: placeFinal,
        place_edited: !!override,
        topic_raw: r.topic_raw ?? "",
        okrug_row: r.okrug_row ?? "",
        sourceRows: [],
      });
    }

    const g = groupsMap.get(key);
    g.dates.push({ y: d.y, m: d.m, d: d.d, ts: d.ts });
    g.sourceRows.push(r);
  }

  const groups = Array.from(groupsMap.values()).map((g) => {
    g.dates.sort((a, b) => a.ts - b.ts);
    const uniq = [];
    for (const x of g.dates) {
      const last = uniq[uniq.length - 1];
      if (!last || last.ts !== x.ts) uniq.push(x);
    }
    g.dates = uniq;
    return g;
  });

  return { groups, rowErrors };
}

// ===================== PLACE (пикеты) =====================
export function formatPlaceHuman(placeRaw) {
  // приводит "Холл 1 подъезда" -> "в холле 1-го подъезда"
  // и в целом нормализует регистр
  const s0 = String(placeRaw || "").trim();
  if (!s0) return "";

  const s = s0.toLowerCase();

  // холл N подъезда
  // варианты: "холл 1 подъезда", "холл №1 подъезда", "в холле 1 подъезда"
  const m = s.match(/холл\s*№?\s*(\d+)\s*подъезда/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) {
      return `в холле ${n}-го подъезда`;
    }
    return "в холле подъезда";
  }

  // около дома
  if (s.includes("около дома")) return "около дома";

  // fallback: вернуть как есть, но строчными
  return s;
}

export function detectPlacePush(placeRaw) {
  const s = String(placeRaw || "").trim().toLowerCase();

  // около дома → двор
  if (s.includes("около дома")) return "в вашем дворе";

  // холл/подъезд → дом
  if (s.includes("холл") || s.includes("подъезд") || s.includes("в холле")) return "в вашем доме";

  // default
  return "в вашем доме";
}

// ===================== ОБХОДЫ (новая логика) =====================
function dayKey(d) {
  return `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`;
}

function isNextDay(prev, next) {
  return next.ts - prev.ts === 24 * 60 * 60 * 1000;
}

function formatSingleDayWithSlots(d, slots) {
  // slots: array of { timeText } length 1 or 2, sorted by start
  if (slots.length === 1) return `${formatDateHuman(d)} ${slots[0].timeText}`;
  return `${formatDateHuman(d)} ${slots[0].timeText} и ${slots[1].timeText}`;
}

function selectObhodScenarioKey(days) {
  // days length 1 or 2
  if (days.length === 1) {
    return days[0].slots.length === 2 ? "obhod_1d_2slot" : "obhod_1d_1slot";
  }

  const s1 = days[0].slots.length;
  const s2 = days[1].slots.length;

  if (s1 === 1 && s2 === 1) {
    const t1 = days[0].slots[0].key;
    const t2 = days[1].slots[0].key;
    return t1 === t2 ? "obhod_2d_1_1_same" : "obhod_2d_1_1_diff";
  }

  if (s1 === 2 && s2 === 1) return "obhod_2d_2_1";
  if (s1 === 1 && s2 === 2) return "obhod_2d_1_2";
  return "obhod_2d_2_2";
}

// ВАЖНО: строго только для пар из двух дней:
// если даты подряд и время одинаковое в оба дня, то:
// "20 и 21 января с 19:00 до 21:00"
function buildNewsDateTime(blockDays) {
  if (!blockDays || blockDays.length === 0) return "";

  // helper: сравнение слотов (ожидаем, что они уже uniq + отсортированы по fromMinutes)
  function sameSlots(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if ((a[i]?.key ?? "") !== (b[i]?.key ?? "")) return false;
    }
    return true;
  }

  if (blockDays.length === 1) {
    const d = blockDays[0];
    return formatSingleDayWithSlots(d.date, d.slots);
  }

  // 2 дня
  const d1 = blockDays[0];
  const d2 = blockDays[1];

  const sameMonth = d1.date.m === d2.date.m && d1.date.y === d2.date.y;
  const consecutive = isNextDay(d1.date, d2.date);

  // ✅ условие группировки: подряд + одинаковые слоты (1 или 2) в оба дня
  // Пример: "3 и 4 февраля с 10:30 до 13:00 и с 18:30 до 20:30"
  if (
    consecutive &&
    (d1.slots.length === 1 || d1.slots.length === 2) &&
    sameSlots(d1.slots, d2.slots)
  ) {
    const monthWord = MONTHS_GEN[d1.date.m - 1];
    const timePart = d1.slots.map((s) => s.timeText).join(" и ");

    if (sameMonth) {
      return `${d1.date.d} и ${d2.date.d} ${monthWord} ${timePart}`;
    }

    // на случай разных месяцев (маловероятно для подряд), но корректно
    return `${formatDateHuman(d1.date)} и ${formatDateHuman(d2.date)} ${timePart}`;
  }

  // иначе — как раньше: "3 февраля ... и 4 февраля ..."
  return `${formatSingleDayWithSlots(d1.date, d1.slots)} и ${formatSingleDayWithSlots(d2.date, d2.slots)}`;
}

// ===== PUSH helpers (обходы) =====
export function buildObhodPushDay(blockDays) {
  if (!blockDays || blockDays.length === 0) return "";
  if (blockDays.length === 1) return "Завтра";
  return "Завтра и послезавтра";
}

export function buildObhodPushTime(blockDays) {
  if (!blockDays || blockDays.length === 0) return "";

  if (blockDays.length === 1) {
    const d = blockDays[0];
    if (d?.slots?.length === 1) return d.slots[0].timeText;
    return "";
  }

  const d1 = blockDays[0];
  const d2 = blockDays[1];
  if (d1?.slots?.length === 1 && d2?.slots?.length === 1) {
    if (d1.slots[0].key === d2.slots[0].key) return d1.slots[0].timeText;
  }
  return "";
}

export function buildObhodResultsFromRows(rows) {
  const rowErrors = [];
  const events = [];

  for (const r of rows) {
    const address = (r.address || "").trim();
    if (!address) {
      rowErrors.push({ rowNum: r.rowNum, error: "Пустой адрес" });
      continue;
    }

    const d = parseRuDate(r.date_raw);
    if (!d.ok) {
      rowErrors.push({ rowNum: r.rowNum, error: d.error });
      continue;
    }

    const t = normalizeTimeRange(r.time_raw);
    if (!t.ok) {
      rowErrors.push({ rowNum: r.rowNum, error: t.error });
      continue;
    }

    events.push({
      rowNum: r.rowNum,
      okrug_row: r.okrug_row || "",
      address,
      date: { y: d.y, m: d.m, d: d.d, ts: d.ts },
      slot: t,
    });
  }

  // group by address
  const byAddress = new Map();
  for (const e of events) {
    if (!byAddress.has(e.address)) byAddress.set(e.address, []);
    byAddress.get(e.address).push(e);
  }

  const items = [];

  for (const [address, list] of byAddress.entries()) {
    list.sort((a, b) => a.date.ts - b.date.ts || a.slot.fromMinutes - b.slot.fromMinutes);

    // group by day
    const byDay = new Map();
    for (const e of list) {
      const k = dayKey(e.date);
      if (!byDay.has(k)) byDay.set(k, { date: e.date, slots: [], okrug_row: e.okrug_row });
      byDay.get(k).slots.push(e.slot);
    }

    const days = Array.from(byDay.values()).sort((a, b) => a.date.ts - b.date.ts);

    // uniq slots inside day, max 2
    for (const d of days) {
      const uniq = [];
      for (const s of d.slots) {
        if (!uniq.find((x) => x.key === s.key)) uniq.push(s);
      }
      uniq.sort((a, b) => a.fromMinutes - b.fromMinutes);
      d.slots = uniq.slice(0, 2);
    }

    // split into blocks: max 2 consecutive days
    for (let i = 0; i < days.length; ) {
      const is2days = i + 1 < days.length && isNextDay(days[i].date, days[i + 1].date);

      const block = is2days ? [days[i], days[i + 1]] : [days[i]];
      const scenario_key = selectObhodScenarioKey(block);

      const news_dt = buildNewsDateTime(block);
      const pushDay = buildObhodPushDay(block);
      const pushTime = buildObhodPushTime(block);

      items.push({
        event_type: "obhod",
        scenario_key,
        address,
        date_list_human: is2days
          ? `${formatDateHuman(block[0].date)} и ${formatDateHuman(block[1].date)}`
          : formatDateHuman(block[0].date),
        time_range_human: "",
        vars: {
          ADDRESS: address,
          NEWS_DATETIME: news_dt,
          PUSH_DAY: pushDay,
          PUSH_TIME: pushTime,
        },
        okrug_row: block[0]?.okrug_row || "",
      });

      i += is2days ? 2 : 1;
    }
  }

  return { items, rowErrors };
}
// reschedule helper (обходы)
export function formatObhodDateTimeHumanMulti(dateRaw, timeRaws) {
  const d = parseRuDate(dateRaw);
  if (!d.ok) return { ok: false, error: d.error };

  const dateObj = { y: d.y, m: d.m, d: d.d, ts: d.ts };

  const times = (timeRaws || [])
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  if (times.length === 0) return { ok: false, error: "Пустое время" };
  if (times.length > 2) return { ok: false, error: "Больше двух обходов в день не поддерживается" };

  const parsed = [];
  for (const tr of times) {
    const t = normalizeTimeRange(tr);
    if (!t.ok) return { ok: false, error: t.error };
    parsed.push(t);
  }

  // uniq + sort by start
  const uniq = [];
  for (const t of parsed) {
    if (!uniq.find((x) => x.key === t.key)) uniq.push(t);
  }
  uniq.sort((a, b) => a.fromMinutes - b.fromMinutes);

  const timePart = uniq.map((x) => x.timeText).join(" и ");
  return { ok: true, text: `${formatDateHuman(dateObj)} ${timePart}` };
}
