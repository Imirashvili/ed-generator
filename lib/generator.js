const MONTHS_GEN = [
  "января","февраля","марта","апреля","мая","июня",
  "июля","августа","сентября","октября","ноября","декабря"
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function normalizeTimeRange(raw) {
  if (!raw) return { ok: false, error: "Пустое время" };
  const s = String(raw).trim()
    .replace(/\s+/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\./g, ":");

  // ожидаем 18:30-20:30
  const m = s.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) return { ok: false, error: `Неверный формат времени: ${raw}` };

  const h1 = Number(m[1]), min1 = Number(m[2]);
  const h2 = Number(m[3]), min2 = Number(m[4]);

  if (h1 > 23 || h2 > 23 || min1 > 59 || min2 > 59) {
    return { ok: false, error: `Неверные часы/минуты: ${raw}` };
  }

  const t1 = h1 * 60 + min1;
  const t2 = h2 * 60 + min2;
  if (t2 <= t1) return { ok: false, error: `Время окончания раньше начала: ${raw}` };

  const from = `${pad2(h1)}.${pad2(min1)}`;
  const to = `${pad2(h2)}.${pad2(min2)}`;
  return {
    ok: true,
    fromMinutes: t1,
    toMinutes: t2,
    timeText: `с ${from} до ${to}`,
    key: `${pad2(h1)}:${pad2(min1)}-${pad2(h2)}:${pad2(min2)}`
  };
}

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
// ===== PLACE HELPERS =====

export function normalizePlace(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

export function formatPlaceHuman(raw) {
  if (!raw) return "";

  const s = normalizePlace(raw);

  // холл N подъезда → "в холле N-го подъезда"
  const hallMatch = s.match(/холл\s*(\d+)\s*подъезд/);

  if (hallMatch) {
    const n = hallMatch[1];
    return `в холле ${n}-го подъезда`;
  }

  // около дома — оставляем как есть
  if (s.includes("около дома")) {
    return "около дома";
  }

  // fallback — возвращаем оригинал, но без лишних пробелов
  return raw.trim();
}

export function detectPlacePush(raw) {
  const s = normalizePlace(raw);

  if (s.includes("около дома")) {
    return "в вашем дворе";
  }

  if (s.includes("холл") || s.includes("подъезд")) {
    return "в вашем доме";
  }

  return "в вашем доме";
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

export function buildPushRelative(dates) {
  // В v0.1: "Завтра..." — это просто шаблонный текст, не календарный расчёт.
  if (!dates.length) return "";
  if (dates.length === 1) return "Завтра";

  if (dates.length === 2) {
    const consecutive = areConsecutiveDays(dates);
    if (consecutive) return "Завтра и послезавтра";
    return `Завтра и ${formatDateHuman(dates[1])}`;
  }

  const consecutive = areConsecutiveDays(dates);
  if (consecutive) return `Завтра и следующие ${dates.length - 1} дня`;

  return formatDateListHuman(dates);
}

export function renderTemplate(str, vars) {
  let out = str ?? "";
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v ?? "");
  }
  return out;
}

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
      // piket/vstrecha: 8 колонок
      if (cols.length < 8) {
        errors.push(`Строка ${rowNum}: ожидалось 8 колонок (Округ, Адрес, Дата старта, Дата окончания, Тематика, Место проведения, Дата пикета, Время проведения)`);
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
// ===== ОБХОДЫ: новая логика =====

function dayKey(d) {
  return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
}

function isNextDay(prev, next) {
  return next.ts - prev.ts === 24 * 60 * 60 * 1000;
}

function formatSingleDayWithSlots(d, slots) {
  // slots: array of { timeText } length 1 or 2, sorted by start
  if (slots.length === 1) return `${formatDateHuman(d)} ${slots[0].timeText}`;
  return `${formatDateHuman(d)} ${slots[0].timeText} и ${slots[1].timeText}`;
}

function sameSlot(a, b) {
  // сравниваем по минутам, чтобы не ломалось из-за key/форматирования
  return a && b && a.fromMinutes === b.fromMinutes && a.toMinutes === b.toMinutes;
}

function sameSlotsList(slots1, slots2) {
  if (slots1.length !== slots2.length) return false;
  for (let i = 0; i < slots1.length; i++) {
    if (!sameSlot(slots1[i], slots2[i])) return false;
  }
  return true;
}

// ВАЖНО: правило "объединение только для пары из 2 дней"
// Если 3 дня подряд — будет (20 и 21 ...) + (22 ...)
function buildNewsDateTime(block) {
  // block: [{date, slots}, ...] length 1 or 2
  if (block.length === 1) {
    return formatSingleDayWithSlots(block[0].date, block[0].slots);
  }

  const d1 = block[0];
  const d2 = block[1];

  // ✅ если два дня подряд и времена идентичны (1 или 2 обхода в день)
  // формат: "20 и 21 января с 19.00 до 21.00" (+ второй слот через "и")
  if (sameSlotsList(d1.slots, d2.slots)) {
    const dateList = formatDateListHuman([d1.date, d2.date]); // "20 и 21 января"
    const timePart = d1.slots.map((s) => s.timeText).join(" и "); // "с ... до ..." (+ второй слот)
    return `${dateList} ${timePart}`;
  }

  // иначе: расписываем по дням, внутри дня 1 или 2 слота
  const a = formatSingleDayWithSlots(d1.date, d1.slots);
  const b = formatSingleDayWithSlots(d2.date, d2.slots);
  return `${a} и ${b}`;
}

function selectObhodScenarioKey(block) {
  // block length 1 or 2
  if (block.length === 1) {
    return block[0].slots.length === 2 ? "obhod_1d_2slot" : "obhod_1d_1slot";
  }

  const s1 = block[0].slots.length;
  const s2 = block[1].slots.length;

  if (s1 === 1 && s2 === 1) {
    // ВАЖНО: определяем "same/diff" по минутам, а не по key
    const same = sameSlot(block[0].slots[0], block[1].slots[0]);
    return same ? "obhod_2d_1_1_same" : "obhod_2d_1_1_diff";
  }

  if (s1 === 2 && s2 === 1) return "obhod_2d_2_1";
  if (s1 === 1 && s2 === 2) return "obhod_2d_1_2";
  return "obhod_2d_2_2";
}

export function buildObhodResultsFromRows(rows) {
  // rows: [{rowNum, okrug_row, address, date_raw, time_raw}]
  // returns { items: [...], rowErrors: [...] }

  const rowErrors = [];

  // 1) нормализуем строки -> events
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
      slot: t, // {timeText, key, fromMinutes, toMinutes...}
    });
  }

  // 2) группируем по адресу
  const byAddress = new Map();
  for (const e of events) {
    if (!byAddress.has(e.address)) byAddress.set(e.address, []);
    byAddress.get(e.address).push(e);
  }

  const items = [];

  for (const [address, list] of byAddress.entries()) {
    // 3) сгруппируем внутри адреса по дню
    list.sort((a, b) => a.date.ts - b.date.ts || a.slot.fromMinutes - b.slot.fromMinutes);

    const byDay = new Map();
    for (const e of list) {
      const k = dayKey(e.date);
      if (!byDay.has(k)) byDay.set(k, { date: e.date, slots: [], okrug_row: e.okrug_row });
      byDay.get(k).slots.push(e.slot);
    }

    // слоты внутри дня: уникализируем и максимум 2
    const days = Array.from(byDay.values()).sort((a, b) => a.date.ts - b.date.ts);
    for (const d of days) {
      const uniq = [];
      for (const s of d.slots) {
        // uniq по минутам (а не по key), чтобы не было дублей из-за форматирования
        if (!uniq.find((x) => sameSlot(x, s))) uniq.push(s);
      }
      uniq.sort((a, b) => a.fromMinutes - b.fromMinutes);
      d.slots = uniq.slice(0, 2);
    }

    // 4) режем на блоки: максимум 2 дня подряд
    for (let i = 0; i < days.length; ) {
      // если есть пара подряд — берём ровно 2 дня
      if (i + 1 < days.length && isNextDay(days[i].date, days[i + 1].date)) {
        const block = [days[i], days[i + 1]];
        const scenario_key = selectObhodScenarioKey(block);
        const news_dt = buildNewsDateTime(block);

        const pushDay = "Завтра и послезавтра";
        const pushTime =
          scenario_key === "obhod_2d_1_1_same"
            ? block[0].slots.map((s) => s.timeText).join(" и ") // если 2 слота одинаковых в оба дня — тоже покажем оба
            : "";

        items.push({
          event_type: "obhod",
          scenario_key,
          address,
          // ✅ правильно: "20 и 21 января"
          date_list_human: formatDateListHuman([block[0].date, block[1].date]),
          time_range_human: "",
          vars: {
            ADDRESS: address,
            NEWS_DATETIME: news_dt,
            PUSH_DAY: pushDay,
            PUSH_TIME: pushTime,
          },
          okrug_row: block[0].okrug_row || "",
        });

        i += 2;
        continue;
      }

      // одиночный день
      const block = [days[i]];
      const scenario_key = selectObhodScenarioKey(block);
      const news_dt = buildNewsDateTime(block);

      const pushDay = "Завтра";
      // для 1 дня время подставляем всегда (шаблон может игнорировать)
      const pushTime = block[0].slots.map((s) => s.timeText).join(" и ");

      items.push({
        event_type: "obhod",
        scenario_key,
        address,
        date_list_human: formatDateHuman(block[0].date),
        time_range_human: "",
        vars: {
          ADDRESS: address,
          NEWS_DATETIME: news_dt,
          PUSH_DAY: pushDay,
          PUSH_TIME: pushTime,
        },
        okrug_row: block[0].okrug_row || "",
      });

      i += 1;
    }
  }

  return { items, rowErrors };
}
export function formatObhodDateTimeHuman(dateRaw, timeRaw) {
  const d = parseRuDate(dateRaw);
  if (!d.ok) return { ok: false, error: d.error };

  const t = normalizeTimeRange(timeRaw);
  if (!t.ok) return { ok: false, error: t.error };

  const dateObj = { y: d.y, m: d.m, d: d.d, ts: d.ts };
  return { ok: true, text: `${formatDateHuman(dateObj)} ${t.timeText}` };
}
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