"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import {
  parseTSV,
  buildGroups,
  formatDateListHuman,
  buildPushRelative,
  renderTemplate,
  buildObhodResultsFromRows,
  formatObhodDateTimeHumanMulti,
  formatPlaceHuman,
  detectPlacePush,
} from "../../lib/generator";

const TABS = [
  { key: "obhod", label: "Обходы" },
  { key: "piket", label: "Пикеты" },
  { key: "vstrecha", label: "Встречи" },
];

const SCENARIOS = {
  obhod: [
    { key: "regular", label: "Плановые" },
    { key: "cancel_generic", label: "Отмена (пожелания)" },
    { key: "cancel_quorum", label: "Отмена (кворум)" },
    { key: "reschedule", label: "Перенос даты" },
  ],
  piket: [
    { key: "regular", label: "Обычный" },
    { key: "cancel", label: "Отмена" },
  ],
  vstrecha: [
    { key: "offline", label: "Оффлайн" },
    { key: "online", label: "Онлайн" },
  ],
};

// ---------- UI helpers ----------
function cn(...xs) {
  return xs.filter(Boolean).join(" ");
}

function Card({ children, className = "" }) {
  return (
    <div className={cn("rounded-lg border border-gray-200 bg-white shadow-sm", className)}>
      {children}
    </div>
  );
}

function Button({ children, onClick, variant = "secondary", className = "", disabled, title }) {
  const base =
    "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold transition border";
  const styles =
    variant === "primary"
      ? "bg-orange-500 text-white border-orange-500 hover:bg-orange-600"
      : variant === "ghost"
        ? "bg-transparent text-gray-700 border-transparent hover:bg-gray-100"
        : variant === "danger"
          ? "bg-white text-red-600 border-red-200 hover:bg-red-50"
          : "bg-white text-gray-900 border-gray-300 hover:bg-gray-50";
  const dis = disabled ? "opacity-50 cursor-not-allowed" : "";
  return (
    <button
      className={cn(base, styles, dis, className)}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

function TabButton({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-2 text-sm font-semibold rounded-md border transition",
        active
          ? "bg-white border-gray-300 shadow-sm text-gray-900"
          : "bg-transparent border-transparent text-gray-600 hover:bg-white/70 hover:border-gray-200"
      )}
    >
      {children}
    </button>
  );
}

function FieldLabel({ children }) {
  return <div className="text-xs text-gray-500 mb-1">{children}</div>;
}

function copy(text) {
  navigator.clipboard.writeText(text ?? "");
}

export default function AppHome() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [okrug, setOkrug] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const [tab, setTab] = useState("obhod");
  const [scenarioKey, setScenarioKey] = useState("regular");

  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [templatesError, setTemplatesError] = useState("");

  const [tsv, setTsv] = useState("");

  const [parseErrors, setParseErrors] = useState([]);
  const [rows, setRows] = useState([]);
  const [rowErrors, setRowErrors] = useState([]);

  const [placeOverrides, setPlaceOverrides] = useState({});
  const [cancelReason, setCancelReason] = useState("с погодными условиями");
  const [whenWord, setWhenWord] = useState("завтра");
  const [link, setLink] = useState("");
  const [topicShort, setTopicShort] = useState("");

  // табличный режим для ввода — по умолчанию выключен (как ты просил “убрать предпросмотр”)
  const [showGrid, setShowGrid] = useState(false);
  const [cellEdits, setCellEdits] = useState({});

  const [results, setResults] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(0);

  // ---------- auth/profile ----------
  useEffect(() => {
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData?.session;
      if (!session) {
        router.replace("/login");
        return;
      }

      setEmail(session.user.email || "");

      const { data: prof } = await supabase
        .from("profiles")
        .select("okrug,is_admin")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!prof?.okrug) {
        router.replace("/profile");
        return;
      }

      setOkrug(prof.okrug);
      setIsAdmin(!!prof.is_admin);
    })();
  }, [router]);

  // ---------- templates ----------
  useEffect(() => {
    (async () => {
      setLoadingTemplates(true);
      setTemplatesError("");

      const { data, error } = await supabase
        .from("templates")
        .select("*")
        .eq("is_active", true);

      if (error) {
        console.error(error);
        setTemplates([]);
        setTemplatesError(error.message);
      } else {
        setTemplates(data || []);
      }
      setLoadingTemplates(false);
    })();
  }, []);

  // ---------- reset on tab ----------
  useEffect(() => {
    const list = SCENARIOS[tab] || [];
    setScenarioKey(list[0]?.key || "regular");
    setResults([]);
    setSelectedIdx(0);
    setParseErrors([]);
    setRows([]);
    setRowErrors([]);
    setPlaceOverrides({});
    setCellEdits({});
    // showGrid не трогаем: пользовательский выбор
  }, [tab]);

  const scenarioOptions = useMemo(() => SCENARIOS[tab] || [], [tab]);

  const currentTemplate = useMemo(() => {
    return templates.find((t) => t.event_type === tab && t.scenario_key === scenarioKey) || null;
  }, [templates, tab, scenarioKey]);

  // ---------- grid helpers ----------
  function getCell(row, field, fallback = "") {
    const k = `${row.rowNum}:${field}`;
    if (cellEdits[k] !== undefined) return cellEdits[k];
    return row[field] ?? fallback;
  }

  function setCell(row, field, value) {
    const k = `${row.rowNum}:${field}`;
    setCellEdits((prev) => ({ ...prev, [k]: value }));
  }

  function doParse() {
    const { rows, errors } = parseTSV(tsv, tab);
    setRows(rows);
    setParseErrors(errors);
    setRowErrors([]);
    setResults([]);
    setSelectedIdx(0);
    setPlaceOverrides({});
    setCellEdits({});
  }
function detectPlacePush(placeText) {
  const s = placeText.toLowerCase();

  // около дома → двор
  if (s.includes("около дома")) {
    return "в вашем дворе";
  }

  // холл / подъезд → дом
  if (
    s.includes("холл") ||
    s.includes("подъезд") ||
    s.includes("в холле")
  ) {
    return "в вашем доме";
  }

  // fallback (на всякий случай)
  return "в вашем доме";
}
  // ---------- generation ----------
  function generate() {
    setResults([]);
    setSelectedIdx(0);

    // ===== ОБХОДЫ =====
    if (tab === "obhod") {
      const manual = new Set(["cancel_generic", "cancel_quorum", "reschedule"]);

      // ---------- РУЧНЫЕ СЦЕНАРИИ: отмены / перенос ----------
      if (manual.has(scenarioKey)) {
        const rowsForObhod = rows.map((r) => ({
          ...r,
          okrug_row: getCell(r, "okrug_row", r.okrug_row ?? ""),
          address: getCell(r, "address", r.address ?? ""),
          date_raw: getCell(r, "date_raw", r.date_raw ?? ""),
          time_raw: getCell(r, "time_raw", r.time_raw ?? ""),
        }));

        const out = [];

        // ===== RESCHEDULE: группируем по (адрес + дата) и красиво форматируем 1–2 времени =====
        if (scenarioKey === "reschedule") {
          const groups = new Map(); // key: `${address}||${date_raw}` -> { address, date_raw, times[], rowNums[] }

          for (const r of rowsForObhod) {
            const addr = String(r.address || "").trim();
            if (!addr) {
              out.push({
                event_type: "obhod",
                scenario_key: scenarioKey,
                address: "",
                date_list_human: "",
                time_range_human: "",
                news_title: "",
                news_html: "",
                push_title: "",
                push_body: "",
                status: "error",
                error_text: `Строка ${r.rowNum}: пустой адрес`,
              });
              continue;
            }

            const dateRaw = String(r.date_raw || "").trim();
            const timeRaw = String(r.time_raw || "").trim();

            const k = `${addr}||${dateRaw}`;
            if (!groups.has(k)) groups.set(k, { address: addr, date_raw: dateRaw, times: [], rowNums: [] });
            groups.get(k).times.push(timeRaw);
            groups.get(k).rowNums.push(r.rowNum);
          }

          const tpl =
            templates.find((t) => t.event_type === "obhod" && t.scenario_key === scenarioKey && t.is_active) ||
            null;

          for (const g of groups.values()) {
            if (!tpl) {
              out.push({
                event_type: "obhod",
                scenario_key: scenarioKey,
                address: g.address,
                date_list_human: "",
                time_range_human: "",
                news_title: "",
                news_html: "",
                push_title: "",
                push_body: "",
                status: "error",
                error_text: `Нет шаблона для scenario_key=${scenarioKey}`,
              });
              continue;
            }

            const f = formatObhodDateTimeHumanMulti(g.date_raw, g.times);
            if (!f.ok) {
              out.push({
                event_type: "obhod",
                scenario_key: scenarioKey,
                address: g.address,
                date_list_human: "",
                time_range_human: "",
                news_title: "",
                news_html: "",
                push_title: "",
                push_body: "",
                status: "error",
                error_text: `Строки ${g.rowNums.join(", ")}: ${f.error}`,
              });
              continue;
            }

            const vars = {
              ADDRESS: g.address,
              NEWS_DATETIME: f.text,
            };

            out.push({
              event_type: "obhod",
              scenario_key: scenarioKey,
              address: g.address,
              date_list_human: "",
              time_range_human: "",
              news_title: renderTemplate(tpl.title_news, vars),
              news_html: renderTemplate(tpl.body_news_html, vars),
              push_title: renderTemplate(tpl.push_title, vars),
              push_body: renderTemplate(tpl.push_body, vars),
              status: "ok",
              error_text: "",
            });
          }

          setRowErrors([]);
          setResults(out);
          return;
        }

        // ===== CANCEL_*: по каждой строке отдельно =====
        for (const r of rowsForObhod) {
          const addr = String(r.address || "").trim();
          if (!addr) {
            out.push({
              event_type: "obhod",
              scenario_key: scenarioKey,
              address: "",
              date_list_human: "",
              time_range_human: "",
              news_title: "",
              news_html: "",
              push_title: "",
              push_body: "",
              status: "error",
              error_text: `Строка ${r.rowNum}: пустой адрес`,
            });
            continue;
          }

          const tpl =
            templates.find((t) => t.event_type === "obhod" && t.scenario_key === scenarioKey && t.is_active) || null;

          if (!tpl) {
            out.push({
              event_type: "obhod",
              scenario_key: scenarioKey,
              address: addr,
              date_list_human: "",
              time_range_human: "",
              news_title: "",
              news_html: "",
              push_title: "",
              push_body: "",
              status: "error",
              error_text: `Нет шаблона для scenario_key=${scenarioKey}`,
            });
            continue;
          }

          const vars = { ADDRESS: addr };

          out.push({
            event_type: "obhod",
            scenario_key: scenarioKey,
            address: addr,
            date_list_human: "",
            time_range_human: "",
            news_title: renderTemplate(tpl.title_news, vars),
            news_html: renderTemplate(tpl.body_news_html, vars),
            push_title: renderTemplate(tpl.push_title, vars),
            push_body: renderTemplate(tpl.push_body, vars),
            status: "ok",
            error_text: "",
          });
        }

        setRowErrors([]);
        setResults(out);
        return;
      }

      // ---------- АВТО-СЦЕНАРИИ: плановые обходы ----------
      const rowsForObhod = rows.map((r) => ({
        ...r,
        okrug_row: getCell(r, "okrug_row", r.okrug_row ?? ""),
        address: getCell(r, "address", r.address ?? ""),
        date_raw: getCell(r, "date_raw", r.date_raw ?? ""),
        time_raw: getCell(r, "time_raw", r.time_raw ?? ""),
      }));

      const { items, rowErrors } = buildObhodResultsFromRows(rowsForObhod);
      setRowErrors(rowErrors);

      const out = [];

      for (const it of items) {
        const tpl =
          templates.find((t) => t.event_type === "obhod" && t.scenario_key === it.scenario_key && t.is_active) || null;

        if (!tpl) {
          out.push({
            event_type: "obhod",
            scenario_key: it.scenario_key,
            address: it.address,
            date_list_human: it.date_list_human,
            time_range_human: it.time_range_human,
            news_title: "",
            news_html: "",
            push_title: "",
            push_body: "",
            status: "error",
            error_text: `Нет шаблона для scenario_key=${it.scenario_key}`,
          });
          continue;
        }

        out.push({
          event_type: "obhod",
          scenario_key: it.scenario_key,
          address: it.address,
          date_list_human: it.date_list_human,
          time_range_human: it.time_range_human,
          news_title: renderTemplate(tpl.title_news, it.vars),
          news_html: renderTemplate(tpl.body_news_html, it.vars),
          push_title: renderTemplate(tpl.push_title, it.vars),
          push_body: renderTemplate(tpl.push_body, it.vars),
          status: "ok",
          error_text: "",
        });
      }

      setResults(out);
      return;
    }

    // ===== ПИКЕТЫ / ВСТРЕЧИ (старая логика) =====
    if (!currentTemplate) {
      alert("Нет шаблона для выбранного типа и сценария. Создай его в /admin/templates.");
      return;
    }

    const rowsPatched = rows.map((r) => {
      const patched = { ...r };

      patched.okrug_row = getCell(r, "okrug_row", r.okrug_row ?? "");
      patched.address = getCell(r, "address", r.address ?? "");
      patched.date_raw = getCell(r, "date_raw", r.date_raw ?? "");
      patched.time_raw = getCell(r, "time_raw", r.time_raw ?? "");
      patched.topic_raw = getCell(r, "topic_raw", r.topic_raw ?? "");
      patched.place_raw = getCell(r, "place_raw", r.place_raw ?? "");
      patched.oss_start_raw = getCell(r, "oss_start_raw", r.oss_start_raw ?? "");
      patched.oss_end_raw = getCell(r, "oss_end_raw", r.oss_end_raw ?? "");

      return patched;
    });

    const { groups, rowErrors } = buildGroups(rowsPatched, tab, scenarioKey, placeOverrides);
    setRowErrors(rowErrors);

    const out = [];

    for (const g of groups) {
      const dateList = formatDateListHuman(g.dates);
      const timeRange = g.time.timeText;
      const dateTime = `${dateList} ${timeRange}`.trim();
      const pushRelative = buildPushRelative(g.dates);

const placeTextRaw = g.place_final ?? "";
const placeText = formatPlaceHuman(placeTextRaw);
const placePush = detectPlacePush(placeTextRaw);


      const topicFull = (g.topic_raw || "").trim();
      const topicShortFinal = (topicShort || topicFull || "").trim();

      const vars = {
        ADDRESS: g.address,
        DATE_LIST: dateList,
        TIME_RANGE: timeRange,
        DATE_TIME: dateTime,
        PUSH_RELATIVE: pushRelative,
        PLACE_TEXT: placeText,
        PLACE_PUSH: placePush,
        TOPIC_FULL: topicFull,
        TOPIC_SHORT: topicShortFinal,
        REASON: cancelReason,
        WHEN_WORD: whenWord,
        LINK: link,
      };

      const rules = currentTemplate.rules || {};
      const errs = [];

      if (rules.requires_place_text && !placeText) errs.push("Не заполнено место (PLACE_TEXT)");
      if (rules.requires_place_push && !placePush) errs.push("Не выбран вариант PLACE_PUSH");
      if (rules.requires_topic && !topicFull) errs.push("Не заполнена тематика (TOPIC_FULL)");
      if (rules.requires_reason && !cancelReason) errs.push("Не выбрана причина (REASON)");

      out.push({
        event_type: tab,
        scenario_key: scenarioKey,
        address: g.address,
        date_list_human: dateList,
        time_range_human: timeRange,
        news_title: renderTemplate(currentTemplate.title_news, vars),
        news_html: renderTemplate(currentTemplate.body_news_html, vars),
        push_title: renderTemplate(currentTemplate.push_title, vars),
        push_body: renderTemplate(currentTemplate.push_body, vars),
        status: errs.length ? "error" : "ok",
        error_text: errs.join("; "),
      });
    }

    setResults(out);
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const templateHint = useMemo(() => {
    if (loadingTemplates) return "Шаблоны загружаются…";
    if (templatesError) return `Ошибка шаблонов: ${templatesError}`;
    if (currentTemplate) return `Шаблон: ${currentTemplate.name}`;
    return "Шаблон не найден";
  }, [loadingTemplates, templatesError, currentTemplate]);

  const selected = results[selectedIdx] || null;

  return (
    <div className="min-h-screen bg-[#f5f6f8] text-gray-900">
      <div className="mx-auto max-w-[1400px] px-6 py-5">
        {/* Top bar */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">ED Generator</div>
            <div className="text-sm text-gray-500">
              {email}
              {okrug ? ` · ${okrug}` : ""}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button variant="secondary" onClick={() => router.push("/admin/templates")}>
                Шаблоны
              </Button>
            )}
            {isAdmin && (
  <Button onClick={() => router.push("/admin/users")}>Админка</Button>
)}
            <Button variant="secondary" onClick={logout}>
              Выйти
            </Button>
          </div>
        </div>

        {/* Tabs + filters */}
        <Card className="mb-4">
          <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
            {TABS.map((t) => (
              <TabButton key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
                {t.label}
              </TabButton>
            ))}

            <div className="ml-auto text-sm text-gray-500">{templateHint}</div>
          </div>

          <div className="px-4 py-4">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <FieldLabel>Сценарий</FieldLabel>
                <select
                  className="border border-gray-300 rounded-md px-3 py-2 bg-white text-sm focus:outline-none focus:border-orange-400"
                  value={scenarioKey}
                  onChange={(e) => setScenarioKey(e.target.value)}
                >
                  {scenarioOptions.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              {tab === "piket" && scenarioKey === "cancel" && (
                <div>
                  <FieldLabel>Причина отмены</FieldLabel>
                  <select
                    className="border border-gray-300 rounded-md px-3 py-2 bg-white text-sm focus:outline-none focus:border-orange-400"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                  >
                    <option value="с набором кворума">с набором кворума</option>
                    <option value="с погодными условиями">с погодными условиями</option>
                    <option value="В соответствии с пожеланиями собственников">
                      В соответствии с пожеланиями собственников
                    </option>
                  </select>
                </div>
              )}

              {tab === "vstrecha" && (
                <div className="min-w-[280px]">
                  <FieldLabel>TOPIC_SHORT (опц.)</FieldLabel>
                  <input
                    className="border border-gray-300 rounded-md px-3 py-2 bg-white text-sm w-full focus:outline-none focus:border-orange-400"
                    value={topicShort}
                    onChange={(e) => setTopicShort(e.target.value)}
                    placeholder="Коротко для пуша"
                  />
                </div>
              )}

              {tab === "vstrecha" && scenarioKey === "online" && (
                <div className="min-w-[320px]">
                  <FieldLabel>Ссылка (опц.)</FieldLabel>
                  <input
                    className="border border-gray-300 rounded-md px-3 py-2 bg-white text-sm w-full focus:outline-none focus:border-orange-400"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              )}

              <div className="ml-auto flex items-center gap-3">
                <label className="text-sm text-gray-600 flex items-center gap-2 select-none">
                  <input
                    type="checkbox"
                    checked={showGrid}
                    onChange={(e) => setShowGrid(e.target.checked)}
                  />
                  Табличный ввод
                </label>
              </div>
            </div>
          </div>
        </Card>

        {/* Input + Results layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: input + result table */}
          <div className="lg:col-span-7 space-y-4">
            {/* TSV input */}
            <Card>
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Вставка данных (TSV)</div>
                  <div className="text-xs text-gray-500">
                    Вставь строки из Google Sheets и нажми “Разобрать”, затем “Сгенерировать”.
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={doParse} variant="secondary">
                    Разобрать
                  </Button>
                  <Button onClick={generate} variant="primary">
                    Сгенерировать
                  </Button>
                </div>
              </div>

              <div className="px-4 py-4">
                <textarea
                  className="w-full border border-gray-300 rounded-md p-3 bg-white text-sm min-h-[140px] font-mono focus:outline-none focus:border-orange-400"
                  value={tsv}
                  onChange={(e) => setTsv(e.target.value)}
                  placeholder={
                    tab === "obhod"
                      ? "Округ<TAB>Адрес<TAB>Дата обхода<TAB>Время обхода"
                      : "Округ<TAB>Адрес<TAB>Дата старта<TAB>Дата окончания<TAB>Тематика<TAB>Место проведения<TAB>Дата<TAB>Время"
                  }
                />

                {parseErrors.length > 0 && (
                  <div className="mt-3 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm">
                    <div className="font-semibold text-yellow-900 mb-1">Ошибки вставки</div>
                    <ul className="list-disc pl-5 text-yellow-900">
                      {parseErrors.map((e, idx) => (
                        <li key={idx}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {showGrid && rows.length > 0 && (
                  <div className="mt-4">
                    <div className="text-sm font-semibold mb-2">Табличный ввод</div>
                    <div className="overflow-auto rounded-md border border-gray-200 bg-white">
                      <table className="min-w-[900px] w-full text-sm border-collapse">
                        <thead className="bg-gray-50">
                          <tr className="text-gray-600">
                            <th className="p-2 border-b border-gray-200 text-left w-[60px]">#</th>
                            <th className="p-2 border-b border-gray-200 text-left w-[110px]">Округ</th>
                            <th className="p-2 border-b border-gray-200 text-left">Адрес</th>
                            {tab !== "obhod" && (
                              <>
                                <th className="p-2 border-b border-gray-200 text-left w-[140px]">Дата старта</th>
                                <th className="p-2 border-b border-gray-200 text-left w-[140px]">Дата окончания</th>
                                <th className="p-2 border-b border-gray-200 text-left w-[180px]">Тематика</th>
                                <th className="p-2 border-b border-gray-200 text-left w-[220px]">Место</th>
                              </>
                            )}
                            <th className="p-2 border-b border-gray-200 text-left w-[140px]">Дата</th>
                            <th className="p-2 border-b border-gray-200 text-left w-[140px]">Время</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => {
                            const err = rowErrors.find((x) => x.rowNum === r.rowNum);
                            const rowCls = err ? "bg-red-50" : "bg-white";
                            const inputCls =
                              "w-full rounded-md border border-gray-200 px-2 py-1 bg-white focus:outline-none focus:border-orange-400";

                            return (
                              <tr key={r.rowNum} className={rowCls}>
                                <td className="p-2 border-b border-gray-100">{r.rowNum}</td>
                                <td className="p-2 border-b border-gray-100">
                                  <input
                                    className={inputCls}
                                    value={getCell(r, "okrug_row", "")}
                                    onChange={(e) => setCell(r, "okrug_row", e.target.value)}
                                  />
                                </td>
                                <td className="p-2 border-b border-gray-100">
                                  <input
                                    className={inputCls}
                                    value={getCell(r, "address", "")}
                                    onChange={(e) => setCell(r, "address", e.target.value)}
                                  />
                                </td>

                                {tab !== "obhod" && (
                                  <>
                                    <td className="p-2 border-b border-gray-100">
                                      <input
                                        className={inputCls}
                                        value={getCell(r, "oss_start_raw", "")}
                                        onChange={(e) => setCell(r, "oss_start_raw", e.target.value)}
                                      />
                                    </td>
                                    <td className="p-2 border-b border-gray-100">
                                      <input
                                        className={inputCls}
                                        value={getCell(r, "oss_end_raw", "")}
                                        onChange={(e) => setCell(r, "oss_end_raw", e.target.value)}
                                      />
                                    </td>
                                    <td className="p-2 border-b border-gray-100">
                                      <input
                                        className={inputCls}
                                        value={getCell(r, "topic_raw", "")}
                                        onChange={(e) => setCell(r, "topic_raw", e.target.value)}
                                      />
                                    </td>
                                    <td className="p-2 border-b border-gray-100">
                                      <input
                                        className={inputCls}
                                        value={getCell(r, "place_raw", "")}
                                        onChange={(e) => setCell(r, "place_raw", e.target.value)}
                                      />
                                    </td>
                                  </>
                                )}

                                <td className="p-2 border-b border-gray-100">
                                  <input
                                    className={inputCls}
                                    value={getCell(r, "date_raw", "")}
                                    onChange={(e) => setCell(r, "date_raw", e.target.value)}
                                  />
                                </td>
                                <td className="p-2 border-b border-gray-100">
                                  <input
                                    className={inputCls}
                                    value={getCell(r, "time_raw", "")}
                                    onChange={(e) => setCell(r, "time_raw", e.target.value)}
                                  />
                                  {err ? <div className="text-xs text-red-700 mt-1">{err.error}</div> : null}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="text-xs text-gray-500 mt-2">
                      Правки в таблице применяются только к текущей генерации.
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* Results table */}
            <Card>
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Результаты</div>
                  <div className="text-xs text-gray-500">Клик по строке — открыть детали справа.</div>
                </div>
                <div className="text-sm text-gray-500">
                  {results.length ? `Найдено: ${results.length}` : "Нет результатов"}
                </div>
              </div>

              <div className="px-4 py-4">
                {results.length === 0 ? (
                  <div className="text-sm text-gray-500">Сначала сгенерируй результаты.</div>
                ) : (
                  <div className="overflow-auto rounded-md border border-gray-200">
                    <table className="w-full text-sm border-collapse">
<thead className="bg-gray-50">
  <tr className="text-gray-600">
    <th className="text-left p-2 border-b border-gray-200">Заголовок</th>
    <th className="text-left p-2 border-b border-gray-200">Адрес</th>
    <th className="text-left p-2 border-b border-gray-200 w-[140px]">Дата</th>
  </tr>
</thead>

                      <tbody>
                        {results.map((r, idx) => {
                          const active = idx === selectedIdx;
                          return (
                            <tr
                              key={idx}
                              onClick={() => setSelectedIdx(idx)}
                              className={cn(
                                "cursor-pointer border-b border-gray-100",
                                active ? "bg-orange-50" : "bg-white hover:bg-gray-50",
                                r.status === "error" ? "text-red-700" : ""
                              )}
                            >
                              <td className="p-2">
                                <div className="font-semibold text-gray-900">
                                  {r.news_title || "(без заголовка)"}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {r.push_title ? `Push: ${r.push_title}` : ""}
                                </div>
                              </td>
                              <td className="p-2">{r.address}</td>
                              <td className="p-2">{r.date_list_human}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {results.length > 0 && selected?.status === "error" && (
                  <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    {selected.error_text}
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Right: details panel */}
          <div className="lg:col-span-5">
            <Card className="sticky top-5">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div className="text-sm font-semibold">Детали</div>
                {selected ? (
                  <div className="text-xs text-gray-500">
                    {selected.address} · {selected.status === "ok" ? "ok" : "error"}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500">Выбери строку слева</div>
                )}
              </div>

              <div className="p-4">
                {!selected ? (
                  <div className="text-sm text-gray-500">Нет выбранной записи.</div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {/* Two columns inside details */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* NEWS */}
                      <div className="rounded-md border border-gray-200 bg-white p-3">
                        <div className="text-xs text-gray-500 mb-1">Новость — заголовок</div>
                        <div className="font-semibold mb-2">{selected.news_title}</div>

                        <div className="text-xs text-gray-500 mb-1">Новость — текст (HTML)</div>
                        <div
                          className="text-sm text-gray-900 max-h-[260px] overflow-auto border border-gray-100 rounded-md p-2 bg-white"
                          dangerouslySetInnerHTML={{ __html: selected.news_html }}
                        />
                      </div>

                      {/* PUSH */}
                      <div className="rounded-md border border-gray-200 bg-white p-3">
                        <div className="text-xs text-gray-500 mb-1">Push — заголовок</div>
                        <div className="font-semibold mb-2">{selected.push_title}</div>

                        <div className="text-xs text-gray-500 mb-1">Push — текст</div>
                        <div className="text-sm text-gray-800 whitespace-pre-wrap">
                          {selected.push_body}
                        </div>
                      </div>
                    </div>

                    {/* Copy actions */}
                    <div className="rounded-md border border-gray-200 bg-white p-3">
                      <div className="text-xs text-gray-500 mb-2">Быстрое копирование</div>
                      <div className="grid gap-2">
                        <Button variant="secondary" onClick={() => copy(selected.news_title)}>
                          Скопировать заголовок новости
                        </Button>
                        <Button
  onClick={() => navigator.clipboard.writeText(r.news_html)}
  variant="primary"
>
  Скопировать HTML новости
</Button>

                        <Button onClick={() => navigator.clipboard.writeText(r.push_title)}>
  Скопировать заголовок пуша
</Button>

<Button
  onClick={() => navigator.clipboard.writeText(r.push_body)}
  variant="primary"
>
  Скопировать текст пуша
</Button>

                      </div>
                    </div>

                    {/* Small help */}
                    <div className="text-xs text-gray-500">
                      Совет: если нужно “как в админке”, просто копируй заголовок + HTML в редактор новости,
                      и push заголовок + текст в пуш-уведомление.
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
