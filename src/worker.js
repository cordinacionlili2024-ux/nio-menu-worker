function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function text(data, status = 200) {
  return new Response(String(data), {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function normalizePhone(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function getBearerToken(request) {
  const h = request.headers.get("authorization") || "";
  return h.replace(/^Bearer\s+/i, "").trim();
}

async function requireToken(request, env) {
  const expected = (env.BOT_API_TOKEN || "").trim();
  if (!expected) return true; // si no hay token configurado, no bloquea
  const got = getBearerToken(request);
  return got && got === expected;
}

export default {
  // IMPORTANTE: async SIEMPRE
  fetch: async (request, env) => {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // ---- HEALTH ----
      if (request.method === "GET" && path === "/health") {
        return json({ ok: true, service: "nio-menu-api", hasDB: !!env.DB });
      }

      // ---- AUTH ----
      if (request.method === "POST" && path === "/auth") {
        if (!(await requireToken(request, env))) return json({ ok: false, error: "Unauthorized" }, 401);
        if (!env.DB) return json({ ok: false, error: "D1 binding DB no existe en env" }, 500);

        const body = await request.json().catch(() => ({}));
        const tel = normalizePhone(body.telefono_whatsapp);

        const personal = await env.DB.prepare(
          `SELECT * FROM cat_personal WHERE telefono_whatsapp=? AND activo=1 LIMIT 1`
        ).bind(tel).first();

        if (!personal) {
          return json({ ok: true, autorizado: false, telefono_whatsapp: tel });
        }

        const role = await env.DB.prepare(
          `SELECT * FROM cat_roles WHERE nombre_rol=? AND activo=1 LIMIT 1`
        ).bind(personal.rol_principal).first();

        if (!role) {
          return json({
            ok: true,
            autorizado: true,
            telefono_whatsapp: tel,
            personal: {
              id_personal: personal.id_personal,
              nombre_completo: personal.nombre_completo,
              rol_principal: personal.rol_principal,
              nivel_acceso: personal.nivel_acceso,
              zona: personal.zona
            },
            permisos: [],
            menu: []
          });
        }

        const permsRes = await env.DB.prepare(
          `
          SELECT cp.codigo_permiso
          FROM rol_permiso rp
          JOIN cat_permisos cp ON cp.id_permiso = rp.id_permiso
          WHERE rp.id_rol = ? AND cp.activo=1
          `
        ).bind(role.id_rol).all();

        const permisos = (permsRes.results || []).map(r => r.codigo_permiso);
        const placeholders = permisos.map(() => "?").join(",") || "NULL";

        const menuRes = await env.DB.prepare(
          `
          SELECT codigo_permiso, texto_menu, orden
          FROM menu_opciones
          WHERE activo=1 AND codigo_permiso IN (${placeholders})
          ORDER BY orden ASC
          `
        ).bind(...permisos).all();

        return json({
          ok: true,
          autorizado: true,
          telefono_whatsapp: tel,
          personal: {
            id_personal: personal.id_personal,
            nombre_completo: personal.nombre_completo,
            rol_principal: personal.rol_principal,
            nivel_acceso: personal.nivel_acceso,
            zona: personal.zona
          },
          permisos,
          menu: (menuRes.results || []).map(r => ({
            codigo_permiso: r.codigo_permiso,
            texto_menu: r.texto_menu
          }))
        });
      }

      // ---- DEFAULT ----
      return json({ ok: false, error: "Not found" }, 404);
    } catch (e) {
      // Para que JAMÁS veas 1101 sin razón
      return text(`WORKER_EXCEPTION:\n${e?.stack || e?.message || String(e)}`, 500);
    }
  },
};
