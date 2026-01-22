"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

export default function TemplatesAdmin() {
  const router = useRouter();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      // Проверяем сессию
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData?.session;
      if (!session) {
        router.replace("/login");
        return;
      }

      // Проверяем, что пользователь админ
      const { data: prof } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!prof?.is_admin) {
        router.replace("/app");
        return;
      }

      // Загружаем шаблоны
      const { data, error } = await supabase
        .from("templates")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        setError(error.message);
      } else {
        setTemplates(data || []);
      }

      setLoading(false);
    })();
  }, [router]);

  if (loading) {
    return <div className="p-6">Загрузка шаблонов…</div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-lg font-semibold">Редактор шаблонов</div>
          <div className="text-sm opacity-80">
            Доступ только для администраторов
          </div>
        </div>
        <button
          className="rounded-xl border px-4 py-2"
          onClick={() => router.push("/app")}
        >
          Назад в приложение
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 border border-red-300 bg-red-50 rounded-xl">
          {error}
        </div>
      )}

      <div className="rounded-2xl border p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="font-semibold">Шаблоны</div>
          <button
            className="rounded-xl border px-4 py-2"
            onClick={() => router.push("/admin/templates/new")}
          >
            + Новый шаблон
          </button>
        </div>

        {templates.length === 0 ? (
          <div className="opacity-80">Пока нет шаблонов.</div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">Тип</th>
                <th className="text-left py-2">Сценарий</th>
                <th className="text-left py-2">Название</th>
                <th className="text-left py-2">Активен</th>
                <th className="text-left py-2"></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b last:border-b-0">
                  <td className="py-2">{t.event_type}</td>
                  <td className="py-2">{t.scenario_key}</td>
                  <td className="py-2">{t.name}</td>
                  <td className="py-2">{t.is_active ? "Да" : "Нет"}</td>
                  <td className="py-2 text-right">
                    <button
                      className="rounded-xl border px-3 py-1 text-sm"
                      onClick={() =>
                        router.push(`/admin/templates/${t.id}`)
                      }
                    >
                      Редактировать
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
