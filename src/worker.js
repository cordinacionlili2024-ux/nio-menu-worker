// =====================================================
// NIO MENU API – Cloudflare Worker
// =====================================================
// Requiere bindings en wrangler.toml:
// [[d1_databases]] binding = "DB"
// vars / secrets: API_TOKEN
// =====================================================

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function requireToken(request, env) {
  if (!env.API_TOKEN) return true;
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return token === env.API_TOKEN;
}

function normalizePhone10(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("52")) return d.slice(2);
  if (d.length === 10) return d;
  return "";
}

async function audit(env, { wa_id, telefono_whatsapp, id_personal, evento, detalle }) {
  await env.DB.prepare(`
    INSERT INTO auditoria_interacciones
    (wa_id, telefono_whatsapp, id_personal, evento, detalle, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
  `).bind(
    wa_id || null,
    telefono_whatsapp || null,
    id_personal || null,
    evento,
    detalle || null
  ).run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    const method = request.method.toUpperCase();

    if (!(await requireToken(request, env))) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    // -------------------------
    // HEALTH
    // -------------------------
    if (method === "GET" && (path === "" || path === "/" || path === "/health")) {
      return json({ ok: true, service: "nio-menu-api" });
    }

    // -------------------------
    // AUTH
    // -------------------------
    if (method === "POST" && path === "/auth") {
      const body = await request.json().catch(() => ({}));
      const wa_id = String(body.wa_id || "").trim();
      let tel10 = normalizePhone10(body.telefono_whatsapp);

      if (!tel10 && wa_id) {
        const link = await env.DB.prepare(`
          SELECT telefono_whatsapp, verified
          FROM wa_links
          WHERE wa_id = ?1
        `).bind(wa_id).first();

        if (link?.verified === 1) {
          tel10 = normalizePhone10(link.telefono_whatsapp);
        }
      }

      if (!tel10) {
        return json({ ok: true, needs_link: true });
      }

      const personal = await env.DB.prepare(`
        SELECT *
        FROM cat_personal
        WHERE telefono_whatsapp = ?1 AND activo = 1
      `).bind(tel10).first();

      if (!personal) {
        await audit(env, {
          wa_id,
          telefono_whatsapp: tel10,
          evento: "AUTH_FAIL",
          detalle: "telefono no autorizado"
        });
        return json({ ok: true, autorizado: false });
      }

      const menu = await env.DB.prepare(`
        SELECT mo.id_menu_opcion, mo.titulo, mo.tipo, mo.payload_json
        FROM rol_menu rm
        JOIN menu_opciones mo ON mo.id_menu_opcion = rm.id_menu_opcion
        WHERE rm.id_rol = ?1 AND mo.activo = 1
        ORDER BY mo.orden ASC
      `).bind(personal.rol_principal).all();

      return json({
        ok: true,
        autorizado: true,
        telefono_whatsapp: tel10,
        personal,
        menu: menu.results || []
      });
    }

    // -------------------------
    // AUDIT
    // -------------------------
    if (method === "POST" && path === "/audit") {
      const body = await request.json().catch(() => ({}));
      await audit(env, body);
      return json({ ok: true });
    }

    // -------------------------
    // LINK START (OTP)
    // -------------------------
    if (method === "POST" && path === "/link/start") {
      const body = await request.json().catch(() => ({}));
      const wa_id = String(body.wa_id || "").trim();
      const tel10 = normalizePhone10(body.telefono_whatsapp);

      if (!wa_id || !tel10) {
        return json({ ok: false, error: "datos incompletos" }, 400);
      }

      const p = await env.DB.prepare(`
        SELECT id_personal FROM cat_personal
        WHERE telefono_whatsapp = ?1 AND activo = 1
      `).bind(tel10).first();

      if (!p) {
        return json({ ok: false, error: "telefono no existe" }, 404);
      }

      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const exp = new Date(Date.now() + 10 * 60000).toISOString();

      await env.DB.prepare(`
        INSERT INTO wa_links (wa_id, telefono_whatsapp, verified, otp_hash, otp_exp_at)
        VALUES (?1, ?2, 0, ?3, ?4)
        ON CONFLICT(wa_id) DO UPDATE SET
          telefono_whatsapp=excluded.telefono_whatsapp,
          verified=0,
          otp_hash=excluded.otp_hash,
          otp_exp_at=excluded.otp_exp_at
      `).bind(
        wa_id,
        tel10,
        otp,
        exp
      ).run();

      return json({ ok: true, otp }); // MVP
    }

    // -------------------------
    // LINK VERIFY
    // -------------------------
    if (method === "POST" && path === "/link/verify") {
      const body = await request.json().catch(() => ({}));
      const wa_id = String(body.wa_id || "").trim();
      const otp = String(body.otp || "").trim();

      const rec = await env.DB.prepare(`
        SELECT telefono_whatsapp, otp_hash, otp_exp_at
        FROM wa_links WHERE wa_id = ?1
      `).bind(wa_id).first();

      if (!rec) return json({ ok: false, error: "sin solicitud" }, 404);
      if (rec.otp_hash !== otp) return json({ ok: false, error: "otp incorrecto" }, 401);
      if (Date.now() > new Date(rec.otp_exp_at).getTime()) {
        return json({ ok: false, error: "otp expirado" }, 410);
      }

      await env.DB.prepare(`
        UPDATE wa_links SET verified=1, otp_hash=NULL, otp_exp_at=NULL
        WHERE wa_id=?1
      `).bind(wa_id).run();

      return json({ ok: true, telefono_whatsapp: rec.telefono_whatsapp });
    }

    // -------------------------
    // FORMATOS
    // -------------------------
    if (method === "GET" && path === "/formatos/categorias") {
      const r = await env.DB.prepare(`
        SELECT categoria, COUNT(*) total
        FROM formatos WHERE activo=1
        GROUP BY categoria
      `).all();
      return json({ ok: true, categorias: r.results || [] });
    }

    if (method === "GET" && path.startsWith("/formatos/")) {
      const id = Number(path.split("/").pop());
      const f = await env.DB.prepare(`
        SELECT * FROM formatos
        WHERE id_formato=?1 AND activo=1
      `).bind(id).first();

      if (!f) return json({ ok: false, error: "no encontrado" }, 404);
      return json({ ok: true, formato: f });
    }

    // -------------------------
    // ASIGNACIONES
    // -------------------------
    if (method === "GET" && path === "/asignaciones/clientes") {
      const idp = url.searchParams.get("id_personal");
      const r = await env.DB.prepare(`
        SELECT DISTINCT cliente FROM asignaciones_servicios
        WHERE id_personal=?1 AND activo=1
      `).bind(idp).all();
      return json({ ok: true, clientes: r.results.map(x => x.cliente) });
    }

    if (method === "GET" && path === "/asignaciones/servicios") {
      const idp = url.searchParams.get("id_personal");
      const cliente = url.searchParams.get("cliente");
      const r = await env.DB.prepare(`
        SELECT servicio FROM asignaciones_servicios
        WHERE id_personal=?1 AND cliente=?2 AND activo=1
      `).bind(idp, cliente).all();
      return json({ ok: true, servicios: r.results.map(x => x.servicio) });
    }

    return json({ ok: false, error: "Not Found" }, 404);
  }
};
