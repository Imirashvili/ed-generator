// ed-generator/lib/generator.js

const MONTHS_GEN = [
  "января","февраля","марта","апреля","мая","июня",
  "июля","августа","сентября","октября","ноября","декабря"
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function normalizeTimeRange(raw) {
  if (!raw) return { ok: false, error: "Пустое время" };

  const s = String(raw)
    .trim()
    .replace(/\s+/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\./g, ":"); // 18.30-19.30 -> 18:30-19:30

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

  const from = `${pad2(h1)}:${pad2(min1)}`;
  const to = `${pad2(h2)}:${pad2(min2)}`;

  return {
    ok: true,
    fromMinutes: t1,
    toMinutes: t2,
    // для новостей
    timeText: `с ${from} до ${to}`,
    // для пушей
    timeShort: `${from}-${to}`,
    key: `${from}-${to}`,
  };
}

export function parseRuDate(raw) {
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
    if (dates.length === 2) return `${formatDateHuman(dates[0])} и ${formatDateHuman(dates[1])}`;
    const parts = dates.map(formatDateHuman);
    return `${parts.slice(0, -1).join(", ")} и ${parts[parts.length - 1]}`;
  }

  const monthWord = MONTHS_GEN[dates[0].m - 1];
  const days = dates.map((x) => x.d);
  if (days.length === 2) return `${days[0]} и ${days[1]} ${monthWord}`;
  return `${days.slice(0, -1).join(", ")} и ${days[days.length - 1]} ${monthWord}`;
}

function areConsecutiveDays(dates) {
  if (dates.length <= 1) return true;
  for (let i = 1; i < dates.length; i++) {
    if (dates[i].ts - dates[i - 1].ts !== 24 * 60 * 60 * 1000) return false;
  }
  return true;
}

function pluralDays(n) {
  const nn = Math.abs(Number(n));
  const mod10 = nn % 10;
  const mod100 = nn % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}

export function buildPushRelative(dates) {
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

export function buildPushRelativePiket(dates) {
  if (!dates.length) return "";
  if (dates.length === 1) return "Завтра";

  const consecutive = areConsecutiveDays(dates);
  if (consecutive) {
    if (dates.length >= 2 && dates.length <= 6) return `Ближайшие ${dates.length} ${pluralDays(dates.length)}`;
    if (dates.length === 7) return "Ближайшую неделю";
    return `Ближайшие ${dates.length} ${pluralDays(dates.length)}`;
  }
  return buildPushRelative(dates);
}

export function renderTemplate(str, vars) {
  let out = str ?? "";
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v ?? "");
  }
  return out;
}

/**
 * TSV:
 * - obhod: 4 кол
 * - piket: 8 кол (как было)
 * - vstrecha: 8 кол + опционально 9-я "Ссылка"
 *
 * vstrecha колонки:
 * Округ | Район | Адреса в зоне | Место встречи | Тематика | Дата | Время | Тип встречи | [Ссылка]
 */
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
      continue;
    }

    if (eventType === "vstrecha") {
      if (cols.length < 8) {
        errors.push(`Строка ${rowNum}: ожидалось 8 колонок (Округ, Район, Адреса..., Место встречи, Тематика, Дата, Время, Тип встречи)`);
        continue;
      }
      rows.push({
        rowNum,
        okrug_row: cols[0],
        raion_raw: cols[1],
        address: cols[2],
        place_raw: cols[3],
        topic_raw: cols[4],
        date_raw: cols[5],
        time_raw: cols[6],
        meeting_type_raw: cols[7], // онлайн/оффлайн
        link_raw: cols[8] ?? "",     // опционально
      });
      continue;
    }

    // piket (как было): 8 колонок
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

  return { rows, errors };
}

/**
 * Общая группировка (piket/vstrecha).
 * Группируем по (тип, сценарий, адрес, время). Даты агрегируем.
 */
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
        topic_raw: r.topic_raw ?? "",
        okrug_row: r.okrug_row ?? "",
        raion_raw: r.raion_raw ?? "",
        meeting_type_raw: r.meeting_type_raw ?? "",
        link_raw: r.link_raw ?? "",
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

// ----- пикеты: место -----
function formatPodiezdGenitive(n) {
  const nn = Number(n);
  if (!Number.isFinite(nn) || nn <= 0) return "";
  return `${nn}-го`;
}

export function formatPlaceHuman(placeRaw) {
  const s0 = String(placeRaw || "").trim();
  if (!s0) return "";

  const s = s0.replace(/\s+/g, " ").trim().toLowerCase();

  if (s.includes("около дома")) return "около дома";

  const m = s.match(/холл\s*(\d+)\s*(?:-?го)?\s*подъезда/);
  if (m) {
    const ord = formatPodiezdGenitive(m[1]);
    return ord ? `в холле ${ord} подъезда` : "в холле подъезда";
  }

  if (s.includes("холл") && s.includes("подъезд")) return "в холле подъезда";

  return s0.replace(/\s+/g, " ").trim();
}

export function detectPlacePush(placeRaw) {
  const s = String(placeRaw || "").trim().toLowerCase().replace(/\s+/g, " ");

  if (s.includes("около дома")) return "в вашем дворе";

  if (s.includes("холл") || s.includes("подъезд") || s.includes("в холле")) {
    return "в вашем доме";
  }

  return "в вашем доме";
}

// ----- встречи: онлайн/оффлайн + тематика -----
export function normalizeMeetingType(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (s.includes("онлайн") || s.includes("online")) return "online";
  if (s.includes("оффлайн") || s.includes("офлайн") || s.includes("offline")) return "offline";
  return "";
}

/**
 * Возвращает фразу для подстановки в "по вопросам ..."
 * - "умный домофон" -> "установки умного домофона"
 * - "шлагбаум" -> "установки шлагбаума"
 * - иначе -> исходная тематика (как есть)
 */
export function normalizeMeetingTopic(topicRaw) {
  const s = String(topicRaw || "").trim();
  const low = s.toLowerCase();

  if (low === "умный домофон") return "установки умного домофона";
  if (low === "шлагбаум") return "установки шлагбаума";

  return s; // любые другие темы — как есть
}

/**
 * Для шаблонов, где есть "по вопросам {TEMA}" — отдаем то, что надо поставить вместо ТЕМА.
 * Гарантия: никогда не вернём "ТЕМА" или пустую "дыру".
 */
export function buildMeetingTema(topicRaw) {
  const t = normalizeMeetingTopic(topicRaw);
  return t ? t : "ОСС";
}

export function buildMeetingFooterHtml({ isOnline, link, placeText, address }) {
  const addr = String(address || "").trim();
  const place = String(placeText || "").trim();
  const ln = String(link || "").trim();

  if (!isOnline) {
    // оффлайн
    return `<div><br />Встреча пройдет ${place} по адресу: ${addr}.</div>`;
  }

  // онлайн
  if (ln) {
    // ссылка в таблице — вшиваем
    const safe = ln.replace(/"/g, "&quot;");
    return `<div><br />Встреча пройдет в онлайн-формате – подключиться можно будет по <a href="${safe}" target="_blank" rel="noopener noreferrer">ссылке</a>.</div>`;
  }

  // без ссылки — SMS
  return `<div><br />Встреча пройдет в онлайн-формате. Ссылка на встречу была направлена в СМС-сообщении.</div>`;
}

// ----- обходы: перенос даты (используется в app/app/page.js) -----
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

  const uniq = [];
  for (const t of parsed) {
    if (!uniq.find((x) => x.key === t.key)) uniq.push(t);
  }
  uniq.sort((a, b) => a.fromMinutes - b.fromMinutes);

  const timePart = uniq.map((x) => x.timeText).join(" и ");
  return { ok: true, text: `${formatDateHuman(dateObj)} ${timePart}` };
}

// ----- обходы (ваша текущая логика) -----
function dayKey(d) {
  return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
}
function isNextDay(prev, next) {
  return next.ts - prev.ts === 24 * 60 * 60 * 1000;
}
function sameSlots(aSlots, bSlots) {
  if (aSlots.length !== bSlots.length) return false;
  for (let i = 0; i < aSlots.length; i++) {
    if (aSlots[i].key !== bSlots[i].key) return false;
  }
  return true;
}
function formatSingleDayWithSlots(d, slots) {
  if (slots.length === 1) return `${formatDateHuman(d)} ${slots[0].timeText}`;
  return `${formatDateHuman(d)} ${slots[0].timeText} и ${slots[1].timeText}`;
}
function buildNewsDateTime(block) {
  if (!block || block.length === 0) return "";

  if (block.length === 1) {
    return formatSingleDayWithSlots(block[0].date, block[0].slots);
  }

  const d1 = block[0].date;
  const d2 = block[1].date;

  if (sameSlots(block[0].slots, block[1].slots)) {
    const dateList = formatDateListHuman([d1, d2]);
    const timePart = block[0].slots.map((s) => s.timeText).join(" и ");
    return `${dateList} ${timePart}`.trim();
  }

  return `${formatSingleDayWithSlots(d1, block[0].slots)} и ${formatSingleDayWithSlots(d2, block[1].slots)}`;
}
function selectObhodScenarioKey(days) {
  if (days.length === 1) return days[0].slots.length === 2 ? "obhod_1d_2slot" : "obhod_1d_1slot";

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

export function buildObhodResultsFromRows(rows) {
  const rowErrors = [];
  const events = [];

  // 1) normalize rows -> events
  for (const r of rows) {
    const address = String(r.address || "").trim();
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
      slot: t, // { timeText, key, fromMinutes, toMinutes }
    });
  }

  // 2) group by address
  const byAddress = new Map();
  for (const e of events) {
    if (!byAddress.has(e.address)) byAddress.set(e.address, []);
    byAddress.get(e.address).push(e);
  }

  // helpers (локально, чтобы ничего не забыть импортировать)
  const isConsecutivePair = (d0, d1) => d1.ts - d0.ts === 24 * 60 * 60 * 1000;

  const buildPushDay = (blockDays) => {
    // blockDays: [{date, slots}, ...] length 1 or 2
    if (blockDays.length === 1) return "Завтра";
    const d0 = blockDays[0].date;
    const d1 = blockDays[1].date;
    return isConsecutivePair(d0, d1) ? "Завтра и послезавтра" : `Завтра и ${formatDateHuman(d1)}`;
  };

  const buildPushTime = (blockDays, scenarioKey) => {
    // Для 2 дней подставляем время только если 1 обход в день и время одинаковое
    if (blockDays.length === 2 && scenarioKey === "obhod_2d_1_1_same") {
      return blockDays[0].slots?.[0]?.timeText || "";
    }
    // Для 1 дня можно подставлять первое окно (шаблон может не использовать)
    if (blockDays.length === 1) {
      return blockDays[0].slots?.[0]?.timeText || "";
    }
    return "";
  };

  const items = [];

  for (const [address, list] of byAddress.entries()) {
    // 3) sort and group within address by day
    list.sort((a, b) => a.date.ts - b.date.ts || a.slot.fromMinutes - b.slot.fromMinutes);

    const byDay = new Map();
    for (const e of list) {
      const k = dayKey(e.date);
      if (!byDay.has(k)) byDay.set(k, { date: e.date, slots: [], okrug_row: e.okrug_row });
      byDay.get(k).slots.push(e.slot);
    }

    // 4) uniq slots inside day, max 2
    const days = Array.from(byDay.values()).sort((a, b) => a.date.ts - b.date.ts);
    for (const d of days) {
      const uniq = [];
      for (const s of d.slots) {
        if (!uniq.find((x) => x.key === s.key)) uniq.push(s);
      }
      uniq.sort((a, b) => a.fromMinutes - b.fromMinutes);
      d.slots = uniq.slice(0, 2);
    }

    // 5) cut into blocks: max 2 consecutive days
    for (let i = 0; i < days.length; ) {
      // block of 2 consecutive days
      if (i + 1 < days.length && isNextDay(days[i].date, days[i + 1].date)) {
        const block = [days[i], days[i + 1]];
const scenario_key = selectObhodScenarioKey(block);
const news_dt = buildNewsDateTime(block);

const pushDay = buildObhodPushDay(block);
const pushTime = buildObhodPushTime(block, scenario_key);

items.push({
  event_type: "obhod",
  scenario_key,
  address,
  date_list_human: `${formatDateHuman(block[0].date)} и ${formatDateHuman(block[1].date)}`,
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

      // block of 1 day
      const block = [days[i]];
const scenario_key = selectObhodScenarioKey(block);
const news_dt = buildNewsDateTime(block);

const pushDay = buildObhodPushDay(block);
const pushTime = buildObhodPushTime(block, scenario_key);

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
