-- ==========================
-- BASE DE DATOS PARA EL CHECKLIST DE PRODUCCIÓN
-- ==========================

CREATE TABLE usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('SUPERVISOR', 'JEFE_PRODUCCION', 'ADMINISTRADOR')),
    nombre TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    order_num INTEGER NOT NULL
);

CREATE TABLE checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL,
    parent_item_id INTEGER,
    description TEXT NOT NULL,
    order_num INTEGER NOT NULL,
    has_subitems BOOLEAN DEFAULT 0,
    FOREIGN KEY (section_id) REFERENCES sections(id),
    FOREIGN KEY (parent_item_id) REFERENCES checklist_items(id)
);

CREATE TABLE checklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supervisor_id INTEGER NOT NULL,
    shift_number INTEGER CHECK(shift_number IN (1, 2)),
    date TEXT NOT NULL,
    status TEXT DEFAULT 'in_progress',
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    observation_generales TEXT,
    FOREIGN KEY (supervisor_id) REFERENCES usuarios(id)
);

CREATE TABLE responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    checklist_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    verified INTEGER NOT NULL,
    observation TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (checklist_id) REFERENCES checklist(id),
    FOREIGN KEY (item_id) REFERENCES checklist_items(id),
    UNIQUE (checklist_id, item_id)
);

