"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useRouter } from "next/navigation";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    // если пользователь открыл страницу без recovery-сессии — можно редиректить на login
    supabase.auth.getSession().then(({ data }) => {
      if (!data?.session) {
        // не всегда нужно редиректить сразу, но чаще так удобнее
      }
    });
  }, []);

  async function submit(e) {
    e.preventDefault();
    setMsg(""); setErr("");

    const { error } = await supabase.auth.updateUser({ password });

    if (error) setErr(error.message);
    else {
      setMsg("Пароль обновлён. Сейчас перенаправим на вход.");
      setTimeout(() => router.push("/login"), 800);
    }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm border border-gray-200 rounded-2xl p-6">
        <div className="text-lg font-semibold mb-4">Новый пароль</div>

        <form onSubmit={submit} className="grid gap-3">
          <input
            type="password"
            className="border border-gray-200 rounded-xl p-2"
            placeholder="Введите новый пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="rounded-xl bg-orange-600 text-white py-2">
            Сохранить
          </button>
        </form>

        {msg && <div className="text-green-700 text-sm mt-3">{msg}</div>}
        {err && <div className="text-red-700 text-sm mt-3">{err}</div>}
      </div>
    </div>
  );
}
