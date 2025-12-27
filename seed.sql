-- =========================
-- SEED BASE - PERMISOS + MENÚ
-- =========================

INSERT OR IGNORE INTO cat_permisos (codigo_permiso, descripcion) VALUES
('SOLICITAR_VIATICOS', 'Solicitud de viáticos'),
('REQ_PAPELERIA', 'Requisición de papelería'),
('REQ_MATERIAL_EQUIPO', 'Requisición de material o equipo'),
('REQ_SERVICIOS', 'Requisición de servicios'),
('COMPROBACION_GASTOS', 'Comprobación de gastos'),
('ACLARACION_NOMINA', 'Aclaración de nómina'),
('FORMATOS_MENSAJE', 'Formatos de mensaje'),
('CARGAR_LISTAS', 'Carga de listas de asistencia'),
('VER_ROL_SUPERVISION', 'Ver rol de supervisión'),
('VER_ROLES_GUARDIAS', 'Ver carpeta de roles de guardias'),
('MENSAJE_MASIVO', 'Envio masivo controlado');

INSERT OR IGNORE INTO menu_opciones (codigo_permiso, texto_menu, orden, activo) VALUES
('SOLICITAR_VIATICOS', '1) Solicitud de viáticos', 10, 1),
('REQ_PAPELERIA', '2) Requisición de papelería', 20, 1),
('REQ_MATERIAL_EQUIPO', '3) Requisición de material o equipo', 30, 1),
('REQ_SERVICIOS', '4) Requisición de servicios', 40, 1),
('COMPROBACION_GASTOS', '5) Comprobación de gastos', 50, 1),
('ACLARACION_NOMINA', '6) Aclaración de nómina', 60, 1),
('FORMATOS_MENSAJE', '7) Formatos de mensaje', 70, 1),
('CARGAR_LISTAS', '8) Carga de listas (solo supervisión)', 80, 1),
('VER_ROL_SUPERVISION', '9) Ver rol supervisión', 90, 1),
('VER_ROLES_GUARDIAS', '10) Ver carpeta roles guardias', 100, 1);

