"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

const OKRUGS = ["САО","СВАО","СЗАО","ЦАО","ЮАО","ЮВАО","ЮЗАО","ВАО","ЗАО","ЗелАО","ТиНАО"];

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [okrug, setOkrug] = useState("");
  const [message, setMessage] = useState("");

  const okrugOptions = useMemo(() => OKRUGS, []);

  useEffect(() => {
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData?.session;
      if (!session) {
        router.replace("/login");
        return;
      }

      setEmail(session.user.email || "");

      // пробуем загрузить профиль
      const { data: prof, error } = await supabase
        .from("profiles")
        .select("okrug")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (error) {
        setMessage(error.message);
      } else if (prof?.okrug) {
        setOkrug(prof.okrug);
      }

      setLoading(false);
    })();
  }, [router]);

  async function saveProfile() {
    setMessage("");

    if (!okrug) {
      setMessage("Выберите округ.");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;
    if (!session) {
      router.replace("/login");
      return;
    }

    // upsert профиля (создаст или обновит)
    const { error } = await supabase
      .from("profiles")
      .upsert({ user_id: session.user.id, okrug }, { onConflict: "user_id" });

    if (error) {
      setMessage(error.message);
      return;
    }

    router.replace("/app");
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return <div className="p-6">Загрузка…</div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border p-6 shadow-sm">
        <h1 className="text-xl font-semibold mb-2">Профиль</h1>
        <p className="text-sm opacity-80 mb-4">Пользователь: {email}</p>

        <label className="text-sm">Округ</label>
        <select
          className="w-full border rounded-xl p-2 mb-4"
          value={okrug}
          onChange={(e) => setOkrug(e.target.value)}
        >
          <option value="">— выберите —</option>
          {okrugOptions.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>

        <div className="flex gap-2">
          <button className="rounded-xl border px-4 py-2" onClick={saveProfile}>
            Сохранить и продолжить
          </button>
          <button className="rounded-xl border px-4 py-2" onClick={logout}>
            Выйти
          </button>
        </div>

        {message && <p className="text-sm mt-4 opacity-80">{message}</p>}
      </div>
    </div>
  );
}
