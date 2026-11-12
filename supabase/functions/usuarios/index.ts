// Horus · Función de servidor para que el ADMIN gestione cuentas desde la app.
// (Crear usuarios y cambiar contraseñas necesita la clave secreta, que nunca va en la página web.)
//
// Instalar:  npx supabase login
//            npx supabase functions deploy usuarios --project-ref TU-PROYECTO
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY las entrega Supabase automáticamente.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const ROLES = ["admin", "jefe", "operario", "cliente", "pendiente"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ error: "Método no permitido" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // 1. ¿Quién llama? Debe ser un administrador activo.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: quien, error: errQuien } = await admin.auth.getUser(token);
  if (errQuien || !quien?.user) return responder({ error: "Sesión no válida" }, 401);
  const { data: perfil } = await admin.from("perfiles").select("rol, activo").eq("id", quien.user.id).maybeSingle();
  if (!perfil || perfil.rol !== "admin" || !perfil.activo) return responder({ error: "Solo un administrador puede hacer esto" }, 403);

  let b: Record<string, string | null>;
  try { b = await req.json(); } catch { return responder({ error: "Datos inválidos" }, 400); }

  // 2. Acciones
  if (b.accion === "crear") {
    const email = String(b.email || "").trim().toLowerCase();
    const password = String(b.password || "");
    const rol = String(b.rol || "pendiente");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return responder({ error: "Correo inválido" }, 400);
    if (password.length < 8) return responder({ error: "La contraseña debe tener al menos 8 caracteres" }, 400);
    if (!ROLES.includes(rol)) return responder({ error: "Rol inválido" }, 400);

    const { data: nuevo, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) return responder({ error: /already/i.test(error.message) ? "Ya existe un usuario con ese correo" : error.message }, 400);

    // El trigger crea el perfil como "pendiente"; aquí se asigna el rol pedido
    const { error: e2 } = await admin.from("perfiles").update({
      nombre: b.nombre || null, rol,
      empresa_id: rol === "operario" || rol === "jefe" ? b.empresa_id : null,
      cliente_id: rol === "cliente" ? b.cliente_id : null,
    }).eq("id", nuevo.user.id);
    if (e2) {
      await admin.auth.admin.deleteUser(nuevo.user.id);
      return responder({ error: e2.message }, 400);
    }
    return responder({ ok: true, id: nuevo.user.id });
  }

  if (b.accion === "clave") {
    if (!b.id || String(b.password || "").length < 8) return responder({ error: "Contraseña inválida" }, 400);
    const { error } = await admin.auth.admin.updateUserById(b.id, { password: String(b.password) });
    return error ? responder({ error: error.message }, 400) : responder({ ok: true });
  }

  if (b.accion === "eliminar") {
    if (!b.id) return responder({ error: "Falta el usuario" }, 400);
    if (b.id === quien.user.id) return responder({ error: "No puedes eliminar tu propia cuenta" }, 400);
    const { error } = await admin.auth.admin.deleteUser(b.id);
    return error ? responder({ error: error.message }, 400) : responder({ ok: true });
  }

  return responder({ error: "Acción desconocida" }, 400);
});
