-- =========================
-- NIO MENÚ BOT - D1 SCHEMA
-- =========================

-- 1) Identidad base
CREATE TABLE IF NOT EXISTS cat_personal (
  id_personal INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre_completo TEXT NOT NULL,
  telefono_whatsapp TEXT NOT NULL UNIQUE,
  rol_principal TEXT NOT NULL,
  nivel_acceso INTEGER NOT NULL DEFAULT 1,
  zona TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cat_personal_telefono ON cat_personal(telefono_whatsapp);
CREATE INDEX IF NOT EXISTS idx_cat_personal_activo ON cat_personal(activo);

-- 2) Roles
CREATE TABLE IF NOT EXISTS cat_roles (
  id_rol INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre_rol TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  nivel_acceso_minimo INTEGER NOT NULL DEFAULT 1,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3) Permisos (acciones)
CREATE TABLE IF NOT EXISTS cat_permisos (
  id_permiso INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo_permiso TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cat_permisos_codigo ON cat_permisos(codigo_permiso);

-- 4) Relación rol-permiso (M:N)
CREATE TABLE IF NOT EXISTS rol_permiso (
  id_rol INTEGER NOT NULL,
  id_permiso INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id_rol, id_permiso),
  FOREIGN KEY (id_rol) REFERENCES cat_roles(id_rol),
  FOREIGN KEY (id_permiso) REFERENCES cat_permisos(id_permiso)
);

CREATE INDEX IF NOT EXISTS idx_rol_permiso_rol ON rol_permiso(id_rol);
CREATE INDEX IF NOT EXISTS idx_rol_permiso_permiso ON rol_permiso(id_permiso);

-- 5) Menú dinámico (construido por permisos)
CREATE TABLE IF NOT EXISTS menu_opciones (
  id_menu INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo_permiso TEXT NOT NULL,
  texto_menu TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (codigo_permiso) REFERENCES cat_permisos(codigo_permiso)
);

CREATE INDEX IF NOT EXISTS idx_menu_opciones_permiso ON menu_opciones(codigo_permiso);
CREATE INDEX IF NOT EXISTS idx_menu_opciones_activo_orden ON menu_opciones(activo, orden);

-- 6) Links (Google Forms, etc.) sin hardcodear
CREATE TABLE IF NOT EXISTS links_formularios (
  id_link INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo_permiso TEXT NOT NULL,
  url TEXT NOT NULL,
  descripcion TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (codigo_permiso) REFERENCES cat_permisos(codigo_permiso)
);

CREATE INDEX IF NOT EXISTS idx_links_permiso ON links_formularios(codigo_permiso);

-- 7) Formatos de mensaje (texto exacto)
CREATE TABLE IF NOT EXISTS formatos_mensaje (
  id_formato INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  contenido_texto TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_formatos_activo ON formatos_mensaje(activo);

-- 8) Servicios (para supervisión / coordinación)
CREATE TABLE IF NOT EXISTS cat_servicios (
  id_servicio INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente TEXT NOT NULL,
  zona TEXT,
  nombre_servicio TEXT NOT NULL,
  id_supervisor INTEGER NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (id_supervisor) REFERENCES cat_personal(id_personal)
);

CREATE INDEX IF NOT EXISTS idx_servicios_supervisor ON cat_servicios(id_supervisor);
CREATE INDEX IF NOT EXISTS idx_servicios_cliente ON cat_servicios(cliente);

-- 9) Control listas de asistencia (trazabilidad total)
CREATE TABLE IF NOT EXISTS listas_asistencia (
  id_lista INTEGER PRIMARY KEY AUTOINCREMENT,
  id_supervisor INTEGER NOT NULL,
  id_servicio INTEGER NOT NULL,
  cliente TEXT NOT NULL,
  mes INTEGER NOT NULL,
  quincena INTEGER NOT NULL CHECK (quincena IN (1,2)),
  anio INTEGER NOT NULL DEFAULT 2026,
  r2_path TEXT NOT NULL,
  url_publico TEXT,
  fecha_carga TEXT NOT NULL DEFAULT (datetime('now')),
  estatus TEXT NOT NULL DEFAULT 'RECIBIDO',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (id_supervisor) REFERENCES cat_personal(id_personal),
  FOREIGN KEY (id_servicio) REFERENCES cat_servicios(id_servicio)
);

CREATE INDEX IF NOT EXISTS idx_listas_supervisor_mes ON listas_asistencia(id_supervisor, anio, mes, quincena);
CREATE INDEX IF NOT EXISTS idx_listas_servicio ON listas_asistencia(id_servicio);

-- 10) Roles (URLs) por supervisor
CREATE TABLE IF NOT EXISTS roles_supervision (
  id_supervisor INTEGER PRIMARY KEY,
  url_rol TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (id_supervisor) REFERENCES cat_personal(id_personal)
);

CREATE TABLE IF NOT EXISTS roles_guardias (
  id_supervisor INTEGER PRIMARY KEY,
  url_carpeta_roles TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (id_supervisor) REFERENCES cat_personal(id_personal)
);

-- 11) Actividad supervisor (última actividad)
CREATE TABLE IF NOT EXISTS actividad_supervisor (
  id_evento INTEGER PRIMARY KEY AUTOINCREMENT,
  id_supervisor INTEGER NOT NULL,
  tipo_evento TEXT NOT NULL,
  referencia TEXT,
  fecha_evento TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (id_supervisor) REFERENCES cat_personal(id_personal)
);

CREATE INDEX IF NOT EXISTS idx_actividad_supervisor_fecha ON actividad_supervisor(id_supervisor, fecha_evento);

-- 12) Envíos masivos (controlados)
CREATE TABLE IF NOT EXISTS envios_masivos (
  id_envio INTEGER PRIMARY KEY AUTOINCREMENT,
  mensaje TEXT NOT NULL,
  criterio_envio TEXT NOT NULL,
  fecha_envio TEXT NOT NULL DEFAULT (datetime('now')),
  enviado_por INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (enviado_por) REFERENCES cat_personal(id_personal)
);

-- 13) Auditoría de interacciones (todo logueado)
CREATE TABLE IF NOT EXISTS auditoria_interacciones (
  id_auditoria INTEGER PRIMARY KEY AUTOINCREMENT,
  telefono_whatsapp TEXT NOT NULL,
  id_personal INTEGER,
  evento TEXT NOT NULL,
  detalle TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (id_personal) REFERENCES cat_personal(id_personal)
);

CREATE INDEX IF NOT EXISTS idx_auditoria_tel ON auditoria_interacciones(telefono_whatsapp, created_at);

-- 14) Sesiones del bot (estado conversacional persistente)
CREATE TABLE IF NOT EXISTS bot_sesiones (
  telefono_whatsapp TEXT PRIMARY KEY,
  estado TEXT NOT NULL DEFAULT 'IDLE',
  contexto_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
