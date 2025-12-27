-- =========================
-- SEED TEST: Rol + permisos + usuario
-- =========================

-- 1) Crear roles base
INSERT OR IGNORE INTO cat_roles (nombre_rol, descripcion, nivel_acceso_minimo, activo)
VALUES
('general', 'Usuario general (menú base)', 1, 1),
('supervision', 'Supervisor operativo', 2, 1),
('direccion', 'Dirección / responsables', 5, 1);

-- 2) Permisos al rol GENERAL (menú base)
INSERT OR IGNORE INTO rol_permiso (id_rol, id_permiso)
SELECT
  (SELECT id_rol FROM cat_roles WHERE nombre_rol='general'),
  id_permiso
FROM cat_permisos
WHERE codigo_permiso IN (
  'SOLICITAR_VIATICOS',
  'REQ_PAPELERIA',
  'REQ_MATERIAL_EQUIPO',
  'REQ_SERVICIOS',
  'COMPROBACION_GASTOS',
  'ACLARACION_NOMINA',
  'FORMATOS_MENSAJE'
);

-- 3) Permisos al rol SUPERVISIÓN (menú base + extras)
INSERT OR IGNORE INTO rol_permiso (id_rol, id_permiso)
SELECT
  (SELECT id_rol FROM cat_roles WHERE nombre_rol='supervision'),
  id_permiso
FROM cat_permisos
WHERE codigo_permiso IN (
  'SOLICITAR_VIATICOS',
  'REQ_PAPELERIA',
  'REQ_MATERIAL_EQUIPO',
  'REQ_SERVICIOS',
  'COMPROBACION_GASTOS',
  'ACLARACION_NOMINA',
  'FORMATOS_MENSAJE',
  'CARGAR_LISTAS',
  'VER_ROL_SUPERVISION',
  'VER_ROLES_GUARDIAS'
);

-- 4) Alta de usuario de prueba (TÚ)
INSERT OR IGNORE INTO cat_personal
(nombre_completo, telefono_whatsapp, rol_principal, nivel_acceso, zona, activo)
VALUES
('Lili Mendoza', 'PON_AQUI_TU_TELEFONO', 'supervision', 2, 'N/A', 1);

-- 5) Links de prueba (cámbialos por tus links reales cuando gustes)
INSERT OR IGNORE INTO links_formularios (codigo_permiso, url, descripcion, activo)
VALUES
('SOLICITAR_VIATICOS', 'https://forms.gle/TU_FORM', 'Formulario de viáticos', 1),
('REQ_PAPELERIA', 'https://forms.gle/TU_FORM', 'Formulario de papelería', 1),
('REQ_MATERIAL_EQUIPO', 'https://forms.gle/TU_FORM', 'Formulario de material/equipo', 1),
('REQ_SERVICIOS', 'https://forms.gle/TU_FORM', 'Formulario de requisición de servicios', 1),
('COMPROBACION_GASTOS', 'https://forms.gle/TU_FORM', 'Formulario de comprobación', 1),
('ACLARACION_NOMINA', 'https://forms.gle/TU_FORM', 'Formulario de aclaración nómina', 1);

-- 6) Formato de mensaje de prueba
INSERT OR IGNORE INTO formatos_mensaje (nombre, contenido_texto, activo)
VALUES
('COBERTURA - FORMATO BASE', 'COBERTURA:\nZONA:\nSERVICIO:\nFECHA:\nELEMENTO:\nESTATUS:\nEVIDENCIA:', 1);
