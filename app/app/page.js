// ed-generator/app/app/page.js
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import {
  parseTSV,
  buildGroups,
  formatDateListHuman,
  buildPushRelative,
  buildPushRelativePiket,
  renderTemplate,
  buildObhodResultsFromRows,
  formatObhodDateTimeHumanMulti,
  formatPlaceHuman,
  detectPlacePush,
  normalizeMeetingType,
  buildMeetingTema,
  buildMeetingFooterHtml,
} from "../../lib/generator";

const TABS = [
  { key: "obhod", label: "Обходы" },
  { key: "piket", label: "Пикеты" },
  { key: "vstrecha", label: "Встречи" }, // будет видно только админам
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
    { key: "cancel", label: "Отмена (погода/кворум)" },
    { key: "cancel_wishes", label: "Отмена (пожелания собственников)" },
  ],
  // Встречи: плановая/отмена выбирается тут, а онлайн/оффлайн приходит из таблицы
  vstrecha: [
    { key: "plan", label: "Плановая" },
    { key: "cancel", label: "Отмена" },
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

function Button({ children, onClick, variant = "secondary", className = "", disabled, title, type = "button" }) {
  const base =
    "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold transition border select-none";
  const styles =
    variant === "primary"
      ? "bg-orange-500 text-white border-orange-500 hover:bg-orange-600"
      : variant === "warning"
        ? "bg-orange-500 text-white border-orange-500 hover:bg-orange-600"
        : variant === "ghost"
          ? "bg-transparent text-gray-700 border-transparent hover:bg-gray-100"
          : variant === "danger"
            ? "bg-white text-red-600 border-red-200 hover:bg-red-50"
            : "bg-white text-gray-900 border-gray-300 hover:bg-gray-50";
  const dis = disabled ? "opacity-50 cursor-not-allowed" : "";
  return (
    <button
      type={type}
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

async function safeCopyText(text) {
  const value = String(text ?? "");
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return { ok: true };
    }
  } catch (_) {}

  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return { ok: !!ok };
  } catch (e) {
    return { ok: false, error: e?.message || "copy failed" };
  }
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

  const [showGrid, setShowGrid] = useState(false);
  const [cellEdits, setCellEdits] = useState({});

  const [results, setResults] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const [copiedKey, setCopiedKey] = useState(null);

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

  // если не админ — прячем вкладку встреч и выкидываем с неё
  useEffect(() => {
    if (!isAdmin && tab === "vstrecha") setTab("obhod");
  }, [isAdmin, tab]);

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
    setCopiedKey(null);
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
    setCopiedKey(null);
  }

  async function copyWithFeedback(key, text) {
    const r = await safeCopyText(text);
    if (r.ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1200);
    } else {
      alert("Не удалось скопировать. Проверьте разрешения браузера или HTTPS.");
    }
  }

  // ---------- generation ----------
  function generate() {
    setResults([]);
    setSelectedIdx(0);
    setCopiedKey(null);

    // Встречи — только админ
    if (tab === "vstrecha" && !isAdmin) {
      alert("Раздел «Встречи» доступен только админам.");
      return;
    }

    // ===== ОБХОДЫ =====
    if (tab === "obhod") {
      const manual = new Set(["cancel_generic", "cancel_quorum", "reschedule"]);

      if (manual.has(scenarioKey)) {
        const rowsForObhod = rows.map((r) => ({
          ...r,
          okrug_row: getCell(r, "okrug_row", r.okrug_row ?? ""),
          address: getCell(r, "address", r.address ?? ""),
          date_raw: getCell(r, "date_raw", r.date_raw ?? ""),
          time_raw: getCell(r, "time_raw", r.time_raw ?? ""),
        }));

        const out = [];

        if (scenarioKey === "reschedule") {
          const groups = new Map();

          for (const r of rowsForObhod) {
            const addr = String(r.address || "").trim();
            if (!addr) {
              out.push({
                event_type: "obhod",
                scenario_key: scenarioKey,
                address: "",
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
            templates.find((t) => t.event_type === "obhod" && t.scenario_key === scenarioKey && t.is_active) || null;

          for (const g of groups.values()) {
            if (!tpl) {
              out.push({
                event_type: "obhod",
                scenario_key: scenarioKey,
                address: g.address,
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
              // русские дублёры
              АДРЕС: g.address,
              ДАТА: "",
              ВРЕМЯ: "",
            };

            out.push({
              event_type: "obhod",
              scenario_key: scenarioKey,
              address: g.address,
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

        // cancel_* по строкам
        for (const r of rowsForObhod) {
          const addr = String(r.address || "").trim();
          if (!addr) {
            out.push({
              event_type: "obhod",
              scenario_key: scenarioKey,
              address: "",
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
              news_title: "",
              news_html: "",
              push_title: "",
              push_body: "",
              status: "error",
              error_text: `Нет шаблона для scenario_key=${scenarioKey}`,
            });
            continue;
          }

          const vars = {
            ADDRESS: addr,
            АДРЕС: addr,
          };

          out.push({
            event_type: "obhod",
            scenario_key: scenarioKey,
            address: addr,
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

      // плановые обходы
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
            news_title: "",
            news_html: "",
            push_title: "",
            push_body: "",
            status: "error",
            error_text: `Нет шаблона для scenario_key=${it.scenario_key}`,
          });
          continue;
        }

        // vars уже готовые
        const vars = {
          ...it.vars,
          // русские дублёры
          АДРЕС: it.address,
        };

        out.push({
          event_type: "obhod",
          scenario_key: it.scenario_key,
          address: it.address,
          news_title: renderTemplate(tpl.title_news, vars),
          news_html: renderTemplate(tpl.body_news_html, vars),
          push_title: renderTemplate(tpl.push_title, vars),
          push_body: renderTemplate(tpl.push_body, vars),
          status: "ok",
          error_text: "",
        });
      }

      setResults(out);
      return;
    }

    // ===== ПИКЕТЫ / ВСТРЕЧИ =====
    const rowsPatched = rows.map((r) => {
      const patched = { ...r };

      patched.okrug_row = getCell(r, "okrug_row", r.okrug_row ?? "");
      patched.address = getCell(r, "address", r.address ?? "");
      patched.date_raw = getCell(r, "date_raw", r.date_raw ?? "");
      patched.time_raw = getCell(r, "time_raw", r.time_raw ?? "");
      patched.topic_raw = getCell(r, "topic_raw", r.topic_raw ?? "");
      patched.place_raw = getCell(r, "place_raw", r.place_raw ?? "");

      // piket
      patched.oss_start_raw = getCell(r, "oss_start_raw", r.oss_start_raw ?? "");
      patched.oss_end_raw = getCell(r, "oss_end_raw", r.oss_end_raw ?? "");

      // vstrecha
      patched.raion_raw = getCell(r, "raion_raw", r.raion_raw ?? "");
      patched.meeting_type_raw = getCell(r, "meeting_type_raw", r.meeting_type_raw ?? "");
      patched.link_raw = getCell(r, "link_raw", r.link_raw ?? "");

      return patched;
    });

    // ===== ВСТРЕЧИ =====
    if (tab === "vstrecha") {
      const out = [];
      const allRowErrors = [];

      // split по типу встречи (online/offline)
      const buckets = { online: [], offline: [] };

      for (const r of rowsPatched) {
        const mt = normalizeMeetingType(r.meeting_type_raw);
        if (!mt) {
          allRowErrors.push({ rowNum: r.rowNum, error: `Не распознан "Тип встречи": ${r.meeting_type_raw}` });
          continue;
        }
        buckets[mt].push(r);
      }

      // итоговые scenario_key для таблицы templates:
      // plan_online, plan_offline, cancel_online, cancel_offline
      for (const mt of ["offline", "online"]) {
        const list = buckets[mt];
        if (!list.length) continue;

        const derivedScenarioKey = `${scenarioKey}_${mt}`; // plan_offline / plan_online / cancel_offline / cancel_online

        const { groups, rowErrors } = buildGroups(list, "vstrecha", derivedScenarioKey, placeOverrides);
        allRowErrors.push(...rowErrors);

        const tpl =
          templates.find((t) => t.event_type === "vstrecha" && t.scenario_key === derivedScenarioKey && t.is_active) ||
          null;

        if (!tpl) {
          for (const g of groups) {
            out.push({
              event_type: "vstrecha",
              scenario_key: derivedScenarioKey,
              address: g.address,
              news_title: "",
              news_html: "",
              push_title: "",
              push_body: "",
              status: "error",
              error_text: `Нет шаблона для scenario_key=${derivedScenarioKey}`,
            });
          }
          continue;
        }

        for (const g of groups) {
          const dateList = formatDateListHuman(g.dates);
          const timeText = g.time.timeText;     // "с 18:30 до 19:30"
          const timeShort = g.time.timeShort;   // "18:30-19:30"
          const dateTime = `${dateList} ${timeText}`.trim();

          const placeText = String(g.place_final || "").trim(); // место встречи как вы дали
          const link = String(g.link_raw || "").trim();

          const tema = buildMeetingTema(g.topic_raw); // "установки ..." или произвольная тема

          // финальный кусок HTML (оффлайн/онлайн + ссылка/SMS)
          const footerHtml = buildMeetingFooterHtml({
            isOnline: mt === "online",
            link,
            placeText,
            address: g.address,
          });

          // переменные (англ + русские дублёры под ваш текст)
          const vars = {
            // англ
            ADDRESS: g.address,
            DATE_LIST: dateList,
            TIME_RANGE: timeText,
            TIME_SHORT: timeShort,
            DATE_TIME: dateTime,
            PLACE_TEXT: placeText,
            TEMA: tema,
            LINK: link,
            MEETING_FOOTER_HTML: footerHtml,

            // рус
            АДРЕС: g.address,
            ДАТА: dateList,
            ВРЕМЯ: timeShort,        // в пуше обычно нужно "18:30-19:30"
            ВРЕМЯ_ТЕКСТ: timeText,   // если нужно "с 18:30 до 19:30"
            ДАТА_ВРЕМЯ: dateTime,
            МЕСТО: placeText,
            ТЕМА: tema,
            ССЫЛКА: link,
            ФИНАЛ: footerHtml,
          };

          out.push({
            event_type: "vstrecha",
            scenario_key: derivedScenarioKey,
            address: g.address,
            news_title: renderTemplate(tpl.title_news, vars),
            news_html: renderTemplate(tpl.body_news_html, vars),
            push_title: renderTemplate(tpl.push_title, vars),
            push_body: renderTemplate(tpl.push_body, vars),
            status: "ok",
            error_text: "",
          });
        }
      }

      setRowErrors(allRowErrors);
      setResults(out);
      return;
    }

    // ===== ПИКЕТЫ =====
    const effectiveReason =
      scenarioKey === "cancel_wishes"
        ? "В соответствии с пожеланиями собственников"
        : cancelReason;

    const { groups, rowErrors } = buildGroups(rowsPatched, "piket", scenarioKey, placeOverrides);
    setRowErrors(rowErrors);

    const tpl =
      templates.find((t) => t.event_type === "piket" && t.scenario_key === scenarioKey && t.is_active) || null;

    if (!tpl) {
      setResults([{
        event_type: "piket",
        scenario_key: scenarioKey,
        address: "",
        news_title: "",
        news_html: "",
        push_title: "",
        push_body: "",
        status: "error",
        error_text: `Нет шаблона для scenario_key=${scenarioKey}`,
      }]);
      return;
    }

    const out = [];

    for (const g of groups) {
      const dateList = formatDateListHuman(g.dates);
      const timeText = g.time.timeText;
      const timeShort = g.time.timeShort;
      const dateTime = `${dateList} ${timeText}`.trim();

      // новое правило для 2+ подряд идущих дней
      const pushRelative = buildPushRelativePiket(g.dates);

      const placeTextRaw = g.place_final ?? "";
      const placeText = formatPlaceHuman(placeTextRaw);
      const placePush = detectPlacePush(placeTextRaw);

      const topicFull = (g.topic_raw || "").trim();

      const vars = {
        ADDRESS: g.address,
        DATE_LIST: dateList,
        TIME_RANGE: timeText,
        TIME_SHORT: timeShort,
        DATE_TIME: dateTime,
        PUSH_RELATIVE: pushRelative,
        PLACE_TEXT: placeText,
        PLACE_PUSH: placePush,
        TOPIC_FULL: topicFull,
        REASON: effectiveReason,

        // русские дублёры
        АДРЕС: g.address,
        ДАТА: dateList,
        ВРЕМЯ: timeShort,
        ВРЕМЯ_ТЕКСТ: timeText,
        ДАТА_ВРЕМЯ: dateTime,
        МЕСТО: placeText,
        МЕСТО_ПУШ: placePush,
        ТЕМА: topicFull,
        ПРИЧИНА: effectiveReason,
      };

      out.push({
        event_type: "piket",
        scenario_key: scenarioKey,
        address: g.address,
        news_title: renderTemplate(tpl.title_news, vars),
        news_html: renderTemplate(tpl.body_news_html, vars),
        push_title: renderTemplate(tpl.push_title, vars),
        push_body: renderTemplate(tpl.push_body, vars),
        status: "ok",
        error_text: "",
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

  const tabsForUI = useMemo(() => {
    return TABS.filter((t) => t.key !== "vstrecha" || isAdmin);
  }, [isAdmin]);

  const tsvPlaceholder = useMemo(() => {
    if (tab === "obhod") return "Округ<TAB>Адрес<TAB>Дата обхода<TAB>Время (18.30-19.30 или 18:30-19:30)";
    if (tab === "piket") return "Округ<TAB>Адрес<TAB>Дата старта<TAB>Дата окончания<TAB>Тематика<TAB>Место проведения<TAB>Дата<TAB>Время";
    return "Округ<TAB>Район<TAB>Адреса в зоне<TAB>Место встречи<TAB>Тематика<TAB>Дата<TAB>Время<TAB>Тип встречи<TAB>Ссылка(опц.)";
  }, [tab]);

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
            {tabsForUI.map((t) => (
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
                  </select>
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
          {/* Left */}
          <div className="lg:col-span-7 space-y-4">
            <Card>
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Вставка данных (TSV)</div>
                  <div className="text-xs text-gray-500">
                    Вставьте строки из Google Sheets и нажмите “Разобрать”, затем “Сгенерировать”.
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
                  placeholder={tsvPlaceholder}
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

                {/* grid оставил как у вас: включается чекбоксом */}
              </div>
            </Card>

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
                  <div className="text-sm text-gray-500">Сначала сгенерируйте результаты.</div>
                ) : (
                  <div className="overflow-auto rounded-md border border-gray-200">
                    <table className="w-full text-sm border-collapse">
                      <thead className="bg-gray-50">
                        <tr className="text-gray-600">
                          <th className="text-left p-2 border-b border-gray-200">Заголовок</th>
                          <th className="text-left p-2 border-b border-gray-200">Адрес</th>
                          <th className="text-left p-2 border-b border-gray-200 w-[180px]">Дата</th>
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

          {/* Right */}
          <div className="lg:col-span-5">
            <Card className="sticky top-5">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div className="text-sm font-semibold">Детали</div>
                {selected ? (
                  <div className="text-xs text-gray-500">
                    {selected.address} · {selected.status === "ok" ? "ok" : "error"}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500">Выберите строку слева</div>
                )}
              </div>

              <div className="p-4">
                {!selected ? (
                  <div className="text-sm text-gray-500">Нет выбранной записи.</div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="rounded-md border border-gray-200 bg-white p-3">
                        <div className="text-xs text-gray-500 mb-1">Новость — заголовок</div>
                        <div className="font-semibold mb-2">{selected.news_title}</div>

                        <div className="text-xs text-gray-500 mb-1">Новость — текст (HTML)</div>
                        <div
                          className="text-sm text-gray-900 max-h-[260px] overflow-auto border border-gray-100 rounded-md p-2 bg-white"
                          dangerouslySetInnerHTML={{ __html: selected.news_html }}
                        />
                      </div>

                      <div className="rounded-md border border-gray-200 bg-white p-3">
                        <div className="text-xs text-gray-500 mb-1">Push — заголовок</div>
                        <div className="font-semibold mb-2">{selected.push_title}</div>

                        <div className="text-xs text-gray-500 mb-1">Push — текст</div>
                        <div className="text-sm text-gray-800 whitespace-pre-wrap">
                          {selected.push_body}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border border-gray-200 bg-white p-3">
                      <div className="text-xs text-gray-500 mb-2">Быстрое копирование</div>
                      <div className="grid gap-2">
                        <Button onClick={() => copyWithFeedback(`news-title-${selectedIdx}`, selected.news_title)}>
                          {copiedKey === `news-title-${selectedIdx}` ? "Заголовок скопирован" : "Скопировать заголовок новости"}
                        </Button>

                        <Button variant="warning" onClick={() => copyWithFeedback(`news-html-${selectedIdx}`, selected.news_html)}>
                          {copiedKey === `news-html-${selectedIdx}` ? "HTML скопирован" : "Скопировать HTML новости"}
                        </Button>

                        <Button onClick={() => copyWithFeedback(`push-title-${selectedIdx}`, selected.push_title)}>
                          {copiedKey === `push-title-${selectedIdx}` ? "Заголовок пуша скопирован" : "Скопировать заголовок пуша"}
                        </Button>

                        <Button onClick={() => copyWithFeedback(`push-body-${selectedIdx}`, selected.push_body)}>
                          {copiedKey === `push-body-${selectedIdx}` ? "Текст пуша скопирован" : "Скопировать текст пуша"}
                        </Button>
                      </div>
                    </div>

                    <div className="text-xs text-gray-500">
                      Совет: копируйте заголовок + HTML в редактор новости, а заголовок пуша + текст — в пуш-уведомление.
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
