"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    // если уже залогинен — отправим дальше
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session) router.replace("/profile");
    })();
  }, [router]);

  async function handleLogin() {
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return setMessage(error.message);
    router.replace("/profile");
  }

  async function handleRegister() {
    setMessage("");
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) return setMessage(error.message);
    setMessage("Регистрация успешна. Если включено подтверждение email — проверь почту.");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border p-6 shadow-sm">
        <h1 className="text-xl font-semibold mb-4">Вход в ED Generator</h1>

        <label className="text-sm">Email</label>
        <input
          className="w-full border rounded-xl p-2 mb-3"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@company.ru"
        />

        <label className="text-sm">Пароль</label>
        <input
          className="w-full border rounded-xl p-2 mb-4"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />

        <div className="flex gap-2">
          <button className="rounded-xl border px-4 py-2" onClick={handleLogin}>
            Войти
          </button>
          <button className="rounded-xl border px-4 py-2" onClick={handleRegister}>
            Зарегистрироваться
          </button>
          <button
  type="button"
  className="text-sm text-gray-600 underline"
  onClick={() => router.push("/forgot-password")}
>
  Забыли пароль?
</button>

        </div>

        {message && <p className="text-sm mt-4 opacity-80">{message}</p>}
      </div>
    </div>
  );
}
