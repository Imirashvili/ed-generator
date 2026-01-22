"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { useRouter } from "next/navigation";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setMsg(""); setErr("");

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });

    if (error) setErr(error.message);
    else setMsg("Письмо отправлено. Проверьте почту.");
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm border border-gray-200 rounded-2xl p-6">
        <div className="text-lg font-semibold mb-4">Восстановление пароля</div>

        <form onSubmit={submit} className="grid gap-3">
          <input
            className="border border-gray-200 rounded-xl p-2"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="rounded-xl bg-orange-600 text-white py-2">
            Отправить письмо
          </button>
        </form>

        {msg && <div className="text-green-700 text-sm mt-3">{msg}</div>}
        {err && <div className="text-red-700 text-sm mt-3">{err}</div>}

        <button
          className="text-sm text-gray-600 mt-4 underline"
          onClick={() => router.push("/login")}
        >
          Назад к входу
        </button>
      </div>
    </div>
  );
}
