// nio-menu-api (Cloudflare Worker) - COMPLETO
// Requiere bindings: env.DB (D1) y env.API_TOKEN (Bearer)
// Endpoints:
// POST /auth
// POST /audit
// POST /link/start
// POST /link/verify
// GET  /formatos/categorias
// GET  /formatos?categoria=...
// GET  /formatos/:id
// POST /menu/action
// GET  /asignaciones/clientes
// GET  /asignaciones/servicios
// GET  /roles/supervision
// GET  /roles/guardias
// POST /reportes/query
// GET  /actividad/ultima
// POST /broadcast/targets

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

function normalizePhone10(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  // MX: si viene 52 + 10 dígitos
  if (d.length === 12 && d.startsWith("52")) return d.slice(2);
  if (d.length === 10) return d;
  return "";
}

async function requireToken(request, env) {
  const expected = (env.API_TOKEN || "").trim();
  if (!expected) return true; // si no hay token, no bloquea
  const auth = request.headers.get("authorization") || "";
  const got = auth.replace(/^Bearer\s+/i, "").trim();
  return got === expected;
}

function nowIso() {
  return new Date().toISOString();
}

// OTP simple (no crypto libs aquí). Para producción: usa WebCrypto.
// Aceptable para MVP porque el hash se guarda, no el OTP.
async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function randOtp6() {
  const n = Math.floor(100000 + Math.random() * 900000);
  return String(n);
}

async function lookupPersonalByTel(env, tel10) {
  const r = await env.DB.prepare(
    `SELECT id_personal, nombre_completo, telefono_whatsapp, rol_principal, nivel, activo
     FROM cat_personal
     WHERE telefono_whatsapp = ?1
     LIMIT 1`
  ).bind(tel10).first();
  return r || null;
}

async function lookupPermisos(env, id_rol) {
  const res = await env.DB.prepare(
    `SELECT cp.codigo_permiso
     FROM rol_permiso rp
     JOIN cat_permisos cp ON cp.id_permiso = rp.id_permiso
     WHERE rp.id_rol = ?1 AND cp.activo = 1`
  ).bind(id_rol).all();

  return (res.results || []).map(r => r.codigo_permiso);
}

async function lookupMenu(env, id_rol, permisos) {
  // Menú por rol (rol_menu) + puedes filtrar por permisos si lo deseas
  const res = await env.DB.prepare(
    `SELECT mo.id_menu_opcion, mo.codigo, mo.titulo, mo.tipo, mo.payload_json, mo.orden
     FROM rol_menu rm
     JOIN menu_opciones mo ON mo.id_menu_opcion = rm.id_menu_opcion
     WHERE rm.id_rol = ?1 AND mo.activo = 1
     ORDER BY mo.orden ASC, mo.id_menu_opcion ASC`
  ).bind(id_rol).all();

  const items = (res.results || []).map(r => ({
    id_menu_opcion: r.id_menu_opcion,
    codigo: r.codigo,
    titulo: r.titulo,
    tipo: r.tipo,
    payload: safeJson(r.payload_json),
  }));

  // Si no hay rol_menu configurado, intenta menú general por codigo prefijo "GEN_"
  if (!items.length) {
    const gen = await env.DB.prepare(
      `SELECT id_menu_opcion, codigo, titulo, tipo, payload_json, orden
       FROM menu_opciones
       WHERE activo = 1 AND (codigo LIKE 'GEN_%' OR codigo LIKE 'GENERAL_%')
       ORDER BY orden ASC, id_menu_opcion ASC`
    ).all();
    return (gen.results || []).map(r => ({
      id_menu_opcion: r.id_menu_opcion,
      codigo: r.codigo,
      titulo: r.titulo,
      tipo: r.tipo,
      payload: safeJson(r.payload_json),
    }));
  }

  return items;
}

function safeJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

async function audit(env, { wa_id, telefono_whatsapp, id_personal, evento, detalle }) {
  await env.DB.prepare(
    `INSERT INTO auditoria_interacciones
     (wa_id, telefono_whatsapp, id_personal, evento, detalle, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))`
  ).bind(
    wa_id || null,
    telefono_whatsapp || null,
    id_personal || null,
    String(evento || "EVENTO"),
    detalle ? String(detalle) : null
  ).run();
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const method = request.method.toUpperCase();

      if (method === "GET" && (path === "/" || path === "/health")) {
        return json({ ok: true, service: "nio-menu-api", hasDB: !!env.DB, now: nowIso() });
      }
      if (!env.DB) return json({ ok: false, error: "D1 binding DB no existe en env" }, 500);

      // TOKEN
      if (!(await requireToken(request, env))) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }

      // =========================
      // POST /auth
      // Body: { wa_id, telefono_whatsapp }
      // Respuesta:
      //  - { autorizado:true, personal, permisos, menu }
      //  - { autorizado:false }
      //  - { needs_link:true }
      // =========================
      if (method === "POST" && path === "/auth") {
        const body = await request.json().catch(() => ({}));
        const wa_id = body.wa_id ? String(body.wa_id).trim() : "";
        let tel10 = normalizePhone10(body.telefono_whatsapp);

        // Si no hay tel10, intenta por vínculo verificado
        if (!tel10 && wa_id) {
          const link = await env.DB.prepare(
            `SELECT telefono_whatsapp, verified
             FROM wa_links
             WHERE wa_id = ?1
             LIMIT 1`
          ).bind(wa_id).first();

          if (link?.verified === 1 && link?.telefono_whatsapp) {
            tel10 = normalizePhone10(link.telefono_whatsapp);
          }
        }

        if (!tel10) {
          // No hay manera de validar aún
          return json({ ok: true, needs_link: true });
        }

        const personal = await lookupPersonalByTel(env, tel10);
        if (!personal || Number(personal.activo) !== 1) {
          return json({ ok: true, autorizado: false });
        }

        const id_rol = personal.rol_principal || "GENERAL";
        const permisos = await lookupPermisos(env, id_rol);
        const menu = await lookupMenu(env, id_rol, permisos);

        return json({
          ok: true,
          autorizado: true,
          telefono_whatsapp: tel10,
          personal,
          id_rol,
          permisos,
          menu
        });
      }

      // =========================
      // POST /audit
      // Body: { wa_id, telefono_whatsapp, id_personal, evento, detalle }
      // =========================
      if (method === "POST" && path === "/audit") {
        const body = await request.json().catch(() => ({}));
        await audit(env, body);
        return json({ ok: true });
      }

      // =========================
      // POST /link/start
      // Body: { wa_id, telefono_whatsapp }
      // - valida que el tel exista activo en cat_personal
      // - genera OTP, guarda hash y exp
      // - (MVP) devuelve otp en respuesta para que el bot lo "simule"
      //   Si quieres SMS real, aquí integras proveedor.
      // =========================
      if (method === "POST" && path === "/link/start") {
        const body = await request.json().catch(() => ({}));
        const wa_id = body.wa_id ? String(body.wa_id).trim() : "";
        const tel10 = normalizePhone10(body.telefono_whatsapp);

        if (!wa_id) return json({ ok: false, error: "Falta wa_id" }, 400);
        if (!tel10 || tel10.length !== 10) return json({ ok: false, error: "telefono_whatsapp inválido (10 dígitos)" }, 400);

        const p = await lookupPersonalByTel(env, tel10);
        if (!p || Number(p.activo) !== 1) {
          return json({ ok: false, error: "Teléfono no existe o inactivo" }, 404);
        }

        const otp = randOtp6();
        const otp_hash = await sha256Hex(`${wa_id}:${tel10}:${otp}`);
        // expira 10 min
        const exp = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        await env.DB.prepare(
          `INSERT INTO wa_links (wa_id, telefono_whatsapp, verified, otp_hash, otp_exp_at, tries, updated_at)
           VALUES (?1, ?2, 0, ?3, ?4, 0, datetime('now'))
           ON CONFLICT(wa_id) DO UPDATE SET
             telefono_whatsapp=excluded.telefono_whatsapp,
             verified=0,
             otp_hash=excluded.otp_hash,
             otp_exp_at=excluded.otp_exp_at,
             tries=0,
             updated_at=datetime('now')`
        ).bind(wa_id, tel10, otp_hash, exp).run();

        return json({ ok: true, sent: true, otp }); // MVP
      }

      // =========================
      // POST /link/verify
      // Body: { wa_id, telefono_whatsapp, otp }
      // =========================
      if (method === "POST" && path === "/link/verify") {
        const body = await request.json().catch(() => ({}));
        const wa_id = body.wa_id ? String(body.wa_id).trim() : "";
        const tel10 = normalizePhone10(body.telefono_whatsapp);
        const otp = String(body.otp || "").trim();

        if (!wa_id) return json({ ok: false, error: "Falta wa_id" }, 400);
        if (!tel10) return json({ ok: false, error: "telefono_whatsapp inválido" }, 400);
        if (!otp || otp.length < 4) return json({ ok: false, error: "otp inválido" }, 400);

        const rec = await env.DB.prepare(
          `SELECT wa_id, telefono_whatsapp, otp_hash, otp_exp_at, tries
           FROM wa_links WHERE wa_id = ?1 LIMIT 1`
        ).bind(wa_id).first();

        if (!rec) return json({ ok: false, error: "No hay solicitud OTP" }, 404);

        const tries = Number(rec.tries || 0);
        if (tries >= 5) return json({ ok: false, error: "Demasiados intentos" }, 429);

        const exp = rec.otp_exp_at ? new Date(rec.otp_exp_at).getTime() : 0;
        if (!exp || Date.now() > exp) return json({ ok: false, error: "OTP expirado" }, 410);

        const expected = await sha256Hex(`${wa_id}:${tel10}:${otp}`);
        if (expected !== rec.otp_hash) {
          await env.DB.prepare(
            `UPDATE wa_links SET tries = tries + 1, updated_at=datetime('now') WHERE wa_id=?1`
          ).bind(wa_id).run();
          return json({ ok: false, error: "OTP incorrecto" }, 401);
        }

        await env.DB.prepare(
          `UPDATE wa_links SET verified=1, otp_hash=NULL, otp_exp_at=NULL, tries=0, updated_at=datetime('now')
           WHERE wa_id=?1`
        ).bind(wa_id).run();

        return json({ ok: true, verified: true, telefono_whatsapp: tel10 });
      }

      // =========================
      // GET /formatos/categorias
      // =========================
      if (method === "GET" && path === "/formatos/categorias") {
        const r = await env.DB.prepare(
          `SELECT categoria, COUNT(*) as total
           FROM formatos
           WHERE activo=1
           GROUP BY categoria
           ORDER BY categoria ASC`
        ).all();
        return json({ ok: true, categorias: (r.results || []) });
      }

      // =========================
      // GET /formatos?categoria=...
      // =========================
      if (method === "GET" && path === "/formatos") {
        const categoria = (url.searchParams.get("categoria") || "").trim();
        const q = categoria
          ? env.DB.prepare(
              `SELECT id_formato, categoria, titulo, orden
               FROM formatos
               WHERE activo=1 AND categoria=?1
               ORDER BY orden ASC, id_formato ASC`
            ).bind(categoria)
          : env.DB.prepare(
              `SELECT id_formato, categoria, titulo, orden
               FROM formatos
               WHERE activo=1
               ORDER BY categoria ASC, orden ASC, id_formato ASC`
            );
        const r = await q.all();
        return json({ ok: true, formatos: (r.results || []) });
      }

      // =========================
      // GET /formatos/:id
      // =========================
      {
        const m = path.match(/^\/formatos\/(\d+)$/);
        if (method === "GET" && m) {
          const id = Number(m[1]);
          const f = await env.DB.prepare(
            `SELECT id_formato, categoria, titulo, cuerpo_texto
             FROM formatos
             WHERE id_formato=?1 AND activo=1
             LIMIT 1`
          ).bind(id).first();
          if (!f) return json({ ok: false, error: "Formato no encontrado" }, 404);
          return json({ ok: true, formato: f });
        }
      }

      // =========================
      // POST /menu/action
      // Body: { id_menu_opcion }
      // =========================
      if (method === "POST" && path === "/menu/action") {
        const body = await request.json().catch(() => ({}));
        const id = Number(body.id_menu_opcion || 0);
        if (!id) return json({ ok: false, error: "Falta id_menu_opcion" }, 400);

        const mo = await env.DB.prepare(
          `SELECT id_menu_opcion, titulo, tipo, payload_json
           FROM menu_opciones
           WHERE id_menu_opcion=?1 AND activo=1
           LIMIT 1`
        ).bind(id).first();

        if (!mo) return json({ ok: false, error: "Opción no encontrada" }, 404);

        return json({
          ok: true,
          action: {
            id_menu_opcion: mo.id_menu_opcion,
            titulo: mo.titulo,
            tipo: mo.tipo,
            payload: safeJson(mo.payload_json),
          }
        });
      }

      // =========================
      // GET /asignaciones/clientes?id_personal=...
      // =========================
      if (method === "GET" && path === "/asignaciones/clientes") {
        const idp = (url.searchParams.get("id_personal") || "").trim();
        if (!idp) return json({ ok: false, error: "Falta id_personal" }, 400);

        const r = await env.DB.prepare(
          `SELECT DISTINCT cliente
           FROM asignaciones_servicios
           WHERE activo=1 AND id_personal=?1
           ORDER BY cliente ASC`
        ).bind(idp).all();

        return json({ ok: true, clientes: (r.results || []).map(x => x.cliente) });
      }

      // =========================
      // GET /asignaciones/servicios?id_personal=...&cliente=...
      // =========================
      if (method === "GET" && path === "/asignaciones/servicios") {
        const idp = (url.searchParams.get("id_personal") || "").trim();
        const cliente = (url.searchParams.get("cliente") || "").trim();
        if (!idp) return json({ ok: false, error: "Falta id_personal" }, 400);
        if (!cliente) return json({ ok: false, error: "Falta cliente" }, 400);

        const r = await env.DB.prepare(
          `SELECT servicio
           FROM asignaciones_servicios
           WHERE activo=1 AND id_personal=?1 AND cliente=?2
           ORDER BY servicio ASC`
        ).bind(idp, cliente).all();

        return json({ ok: true, servicios: (r.results || []).map(x => x.servicio) });
      }

      // =========================
      // GET /roles/supervision?id_personal=...
      // =========================
      if (method === "GET" && path === "/roles/supervision") {
        const idp = (url.searchParams.get("id_personal") || "").trim();
        if (!idp) return json({ ok: false, error: "Falta id_personal" }, 400);

        const r = await env.DB.prepare(
          `SELECT periodo, url
           FROM roles_supervision
           WHERE activo=1 AND id_personal=?1
           ORDER BY periodo DESC, id DESC`
        ).bind(idp).all();

        return json({ ok: true, roles: (r.results || []) });
      }

      // =========================
      // GET /roles/guardias?id_personal=...
      // =========================
      if (method === "GET" && path === "/roles/guardias") {
        const idp = (url.searchParams.get("id_personal") || "").trim();
        if (!idp) return json({ ok: false, error: "Falta id_personal" }, 400);

        const r = await env.DB.prepare(
          `SELECT periodo, url
           FROM roles_guardias
           WHERE activo=1 AND id_personal=?1
           ORDER BY periodo DESC, id DESC`
        ).bind(idp).all();

        return json({ ok: true, roles: (r.results || []) });
      }

      // =========================
      // POST /reportes/query
      // Body: { zona, cliente, servicio, supervisor_id, mes, anio }
      // =========================
      if (method === "POST" && path === "/reportes/query") {
        const b = await request.json().catch(() => ({}));
        const zona = (b.zona || "").trim();
        const cliente = (b.cliente || "").trim();
        const servicio = (b.servicio || "").trim();
        const supervisor_id = (b.supervisor_id || "").trim();
        const mes = Number(b.mes || 0);
        const anio = Number(b.anio || 0);

        // query dinámica simple (MVP)
        let sql = `SELECT
          SUM(asistencias) as asistencias,
          SUM(faltas) as faltas,
          SUM(incapacidades) as incapacidades,
          SUM(incidencias_cubiertas) as incidencias_cubiertas,
          SUM(incidencias_no_cubiertas) as incidencias_no_cubiertas
        FROM metricas WHERE 1=1`;
        const binds = [];
        let i = 1;

        if (zona) { sql += ` AND zona=?${i}`; binds.push(zona); i++; }
        if (cliente) { sql += ` AND cliente=?${i}`; binds.push(cliente); i++; }
        if (servicio) { sql += ` AND servicio=?${i}`; binds.push(servicio); i++; }
        if (supervisor_id) { sql += ` AND supervisor_id=?${i}`; binds.push(supervisor_id); i++; }
        if (anio) { sql += ` AND anio=?${i}`; binds.push(anio); i++; }
        if (mes) { sql += ` AND mes=?${i}`; binds.push(mes); i++; }

        const r = await env.DB.prepare(sql).bind(...binds).first();
        return json({ ok: true, filtros: { zona, cliente, servicio, supervisor_id, mes, anio }, resumen: r || {} });
      }

      // =========================
      // GET /actividad/ultima?id_personal=...
      // =========================
      if (method === "GET" && path === "/actividad/ultima") {
        const idp = (url.searchParams.get("id_personal") || "").trim();
        if (!idp) return json({ ok: false, error: "Falta id_personal" }, 400);

        const last = await env.DB.prepare(
          `SELECT evento, detalle, created_at
           FROM auditoria_interacciones
           WHERE id_personal=?1
           ORDER BY datetime(created_at) DESC
           LIMIT 1`
        ).bind(idp).first();

        const lastLista = await env.DB.prepare(
          `SELECT evento, detalle, created_at
           FROM auditoria_interacciones
           WHERE id_personal=?1 AND evento='LISTA_ARCHIVO_SUBIDO'
           ORDER BY datetime(created_at) DESC
           LIMIT 1`
        ).bind(idp).first();

        return json({ ok: true, ultima_interaccion: last || null, ultima_lista: lastLista || null });
      }

      // =========================
      // POST /broadcast/targets
      // Body: { criterio, excluir_tel10?:[], incluir_solo_tel10?:[] }
      // criterio: "SUPERVISORES" | "COORDINADORES" | "TODOS" | "TODOS_MENOS_X"
      // Nota: MVP filtra por rol_principal (ajústalo a tu catálogo real)
      // =========================
      if (method === "POST" && path === "/broadcast/targets") {
        const b = await request.json().catch(() => ({}));
        const criterio = String(b.criterio || "").trim().toUpperCase();
        const excluir = Array.isArray(b.excluir_tel10) ? b.excluir_tel10.map(normalizePhone10).filter(Boolean) : [];

        let where = `activo=1 AND telefono_whatsapp IS NOT NULL AND telefono_whatsapp<>''`;
        const binds = [];
        let i = 1;

        if (criterio === "SUPERVISORES") {
          where += ` AND (rol_principal LIKE '%SUP%' OR rol_principal LIKE '%SUPERV%')`;
        } else if (criterio === "COORDINADORES") {
          where += ` AND (rol_principal LIKE '%COORD%')`;
        } else if (criterio === "TODOS" || criterio === "TODOS_MENOS_X") {
          // nada extra
        } else {
          return json({ ok: false, error: "criterio inválido" }, 400);
        }

        // Excluir
        if (excluir.length) {
          where += ` AND telefono_whatsapp NOT IN (${excluir.map(() => `?${i++}`).join(",")})`;
          binds.push(...excluir);
        }

        const r = await env.DB.prepare(
          `SELECT id_personal, nombre_completo, telefono_whatsapp
           FROM cat_personal
           WHERE ${where}
           ORDER BY nombre_completo ASC`
        ).bind(...binds).all();

        return json({ ok: true, targets: (r.results || []) });
      }

      return json({ ok: false, error: "Not Found", path }, 404);
    } catch (e) {
      return json({ ok: false, error: e?.message || String(e) }, 500);
    }
  }
};
