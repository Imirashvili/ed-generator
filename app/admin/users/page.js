"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

function cn(...xs) {
  return xs.filter(Boolean).join(" ");
}

function Button({ children, onClick, variant = "secondary", disabled, className = "" }) {
  const base =
    "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition border";
  const styles =
    variant === "primary"
      ? "bg-orange-600 text-white border-orange-600 hover:bg-orange-500"
      : variant === "danger"
      ? "bg-white text-red-600 border-red-200 hover:bg-red-50"
      : "bg-white text-gray-900 border-gray-200 hover:bg-gray-50";
  return (
    <button
      className={cn(base, styles, disabled ? "opacity-50 cursor-not-allowed" : "", className)}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export default function AdminUsersPage() {
  const router = useRouter();

  const [me, setMe] = useState({ email: "", okrug: "", isAdmin: false });
  const [loadingMe, setLoadingMe] = useState(true);

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState(null); // {found, user_id, okrug, is_admin, email}
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

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
.select("user_email,okrug,is_admin")
        .eq("user_id", session.user.id)
        .maybeSingle();

      const isAdmin = !!prof?.is_admin;

      setMe({
  email: session.user.email || prof?.user_email || "",
  okrug: prof?.okrug || "",
  isAdmin: !!prof?.is_admin,
});

      setLoadingMe(false);

      if (!isAdmin) {
        router.replace("/app"); // или покажем страницу "нет доступа"
      }
    })();
  }, [router]);

  async function check() {
    setMsg(""); setErr(""); setStatus(null);

    const e = email.trim();
    if (!e) {
      setErr("Введите email");
      return;
    }

    const { data, error } = await supabase.rpc("get_profile_by_email", { target_email: e });

    if (error) {
      setErr(error.message);
      return;
    }

    if (!data || data.length === 0) {
      setStatus({ found: false });
      return;
    }

    setStatus({ found: true, ...data[0] });
  }

  async function setAdmin(makeAdmin) {
    setMsg(""); setErr("");

    const e = email.trim();
    if (!e) {
      setErr("Введите email");
      return;
    }

    const { error } = await supabase.rpc("set_admin_by_email", {
      target_email: e,
      make_admin: makeAdmin,
    });

    if (error) {
      setErr(error.message);
      return;
    }

    setMsg(makeAdmin ? "Готово: админ назначен" : "Готово: админ снят");
    await check();
  }

  if (loadingMe) {
    return <div className="min-h-screen bg-white p-6">Загрузка…</div>;
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="text-xl font-semibold">Админка</div>
            <div className="text-sm text-gray-500">
              {me.email}{me.okrug ? ` · ${me.okrug}` : ""}
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={() => router.push("/app")}>Назад</Button>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="text-base font-semibold">Назначение админа по email</div>
            <div className="text-sm text-gray-500 mt-1">
              Введите email пользователя из profiles. Доступно только администраторам.
            </div>
          </div>

          <div className="px-5 py-4 grid gap-4">
            <div className="grid gap-2">
              <div className="text-xs text-gray-500">Email</div>
              <input
                className="border border-gray-200 rounded-xl p-2 bg-white text-sm"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <div className="flex gap-2 flex-wrap">
                <Button onClick={check}>Проверить</Button>
                <Button onClick={() => setAdmin(true)} variant="primary">
                  Сделать админом
                </Button>
                <Button onClick={() => setAdmin(false)} variant="danger">
                  Снять админа
                </Button>
              </div>
            </div>

            {err && (
              <div className="p-3 border border-red-200 bg-red-50 rounded-2xl text-sm text-red-800">
                {err}
              </div>
            )}

            {msg && (
              <div className="p-3 border border-green-200 bg-green-50 rounded-2xl text-sm text-green-800">
                {msg}
              </div>
            )}

            {status && (
              <div className="p-3 border border-gray-200 bg-gray-50 rounded-2xl text-sm">
                {status.found === false ? (
                  <div className="text-gray-700">Профиль не найден по этому email.</div>
                ) : (
                  <div className="grid gap-1 text-gray-800">
                    <div><span className="text-gray-500">Email:</span> {status.email}</div>
                    <div><span className="text-gray-500">Округ:</span> {status.okrug || "—"}</div>
                    <div>
                      <span className="text-gray-500">is_admin:</span>{" "}
                      <span className={status.is_admin ? "text-green-700 font-semibold" : "text-gray-700"}>
                        {status.is_admin ? "true" : "false"}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      user_id: {status.user_id}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="text-xs text-gray-500 mt-4">
          Примечание: если профиль не находится — проверь, что в таблице profiles заполнена колонка email.
        </div>
      </div>
    </div>
  );
}
