"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const EVENT_TYPES = [
  { value: "obhod", label: "Обходы" },
  { value: "piket", label: "Пикеты" },
  { value: "vstrecha", label: "Встречи" },
];

export default function EditTemplatePage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id;

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [form, setForm] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData?.session;
      if (!session) {
        router.replace("/login");
        return;
      }

      const { data: prof } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!prof?.is_admin) {
        router.replace("/app");
        return;
      }

      setReady(true);

      const { data, error } = await supabase
        .from("templates")
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      setForm({
        ...data,
        rulesText: JSON.stringify(data.rules ?? {}, null, 2),
      });
      setLoading(false);
    })();
  }, [router, id]);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setError("");
    if (!form) return;

    let rulesObj = {};
    try {
      rulesObj = form.rulesText.trim() ? JSON.parse(form.rulesText) : {};
    } catch {
      return setError("Поле rules должно быть валидным JSON.");
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;

    const payload = {
      event_type: form.event_type,
      scenario_key: (form.scenario_key || "").trim(),
      name: (form.name || "").trim(),
      title_news: form.title_news ?? "",
      body_news_html: form.body_news_html ?? "",
      push_title: form.push_title ?? "",
      push_body: form.push_body ?? "",
      rules: rulesObj,
      is_active: !!form.is_active,
      updated_by: session?.user?.id ?? null,
    };

    if (!payload.name) return setError("Заполни поле «Название».");
    if (!payload.scenario_key) return setError("Заполни поле «scenario_key».");

    const { error } = await supabase.from("templates").update(payload).eq("id", id);
    if (error) return setError(error.message);

    router.replace("/admin/templates");
  }

  async function remove() {
    if (!confirm("Удалить шаблон?")) return;
    const { error } = await supabase.from("templates").delete().eq("id", id);
    if (error) return setError(error.message);
    router.replace("/admin/templates");
  }

  if (!ready) return <div className="p-6">Загрузка…</div>;
  if (loading) return <div className="p-6">Загрузка шаблона…</div>;
  if (!form) return <div className="p-6">Шаблон не найден</div>;

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-lg font-semibold">Редактирование шаблона</div>
          <div className="text-sm opacity-80">id: {id}</div>
        </div>
        <button
          className="rounded-xl border px-4 py-2"
          onClick={() => router.push("/admin/templates")}
        >
          Назад
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 border border-red-300 bg-red-50 rounded-xl">
          {error}
        </div>
      )}

      <div className="grid gap-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-sm">Тип</label>
            <select
              className="w-full border rounded-xl p-2"
              value={form.event_type}
              onChange={(e) => setField("event_type", e.target.value)}
            >
              {EVENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm">scenario_key</label>
            <input
              className="w-full border rounded-xl p-2"
              value={form.scenario_key}
              onChange={(e) => setField("scenario_key", e.target.value)}
            />
          </div>

          <div className="flex items-end gap-2">
            <label className="text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!form.is_active}
                onChange={(e) => setField("is_active", e.target.checked)}
              />
              Активен
            </label>
          </div>
        </div>

        <div>
          <label className="text-sm">Название</label>
          <input
            className="w-full border rounded-xl p-2"
            value={form.name || ""}
            onChange={(e) => setField("name", e.target.value)}
          />
        </div>

        <div>
          <label className="text-sm">Заголовок новости</label>
          <input
            className="w-full border rounded-xl p-2"
            value={form.title_news || ""}
            onChange={(e) => setField("title_news", e.target.value)}
          />
        </div>

        <div>
          <label className="text-sm">Текст новости HTML</label>
          <textarea
            className="w-full border rounded-xl p-2 min-h-[160px]"
            value={form.body_news_html || ""}
            onChange={(e) => setField("body_news_html", e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm">Push title</label>
            <input
              className="w-full border rounded-xl p-2"
              value={form.push_title || ""}
              onChange={(e) => setField("push_title", e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm">Push body</label>
            <input
              className="w-full border rounded-xl p-2"
              value={form.push_body || ""}
              onChange={(e) => setField("push_body", e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="text-sm">rules (JSON)</label>
          <textarea
            className="w-full border rounded-xl p-2 min-h-[120px] font-mono text-xs"
            value={form.rulesText || "{}"}
            onChange={(e) => setField("rulesText", e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <button className="rounded-xl border px-4 py-2" onClick={save}>
            Сохранить
          </button>
          <button className="rounded-xl border px-4 py-2" onClick={remove}>
            Удалить
          </button>
        </div>
      </div>
    </div>
  );
}
