const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

// Crear carpeta database si no existe
const dbDir = path.join(__dirname, 'database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log('Carpeta database creada');
}

// Crear conexión a la base de datos
const dbPath = path.join(dbDir, 'checklist.db');
const db = new sqlite3.Database(dbPath);

// Habilitar foreign keys
db.run("PRAGMA foreign_keys = ON");

// =============================================
// CREAR TABLAS (si no existen)
// =============================================
function crearTablas() {
  console.log("🔧 Creando tablas si no existen...");
  
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('SUPERVISOR', 'JEFE_PRODUCCION', 'ADMINISTRADOR')),
    nombre TEXT NOT NULL,
    area TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS secciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    orden_num INTEGER NOT NULL
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seccion_id INTEGER NOT NULL,
    parent_item_id INTEGER,
    descripcion TEXT NOT NULL,
    orden_num INTEGER NOT NULL,
    tiene_subitems BOOLEAN DEFAULT 0,
    FOREIGN KEY (seccion_id) REFERENCES secciones(id),
    FOREIGN KEY (parent_item_id) REFERENCES checklist_items(id)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS checklists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supervisor_id INTEGER NOT NULL,
    numero_turno INTEGER CHECK(numero_turno IN (1,2)),
    fecha TEXT NOT NULL,
    status TEXT DEFAULT 'en_progreso',
    iniciado_en TEXT DEFAULT (datetime('now', '-5 hours')),
    completado_en TEXT,
    observaciones_generales TEXT,
    FOREIGN KEY (supervisor_id) REFERENCES usuarios(id)
)`);
  
  db.run(`CREATE TABLE IF NOT EXISTS respuestas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    checklist_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    verificado INTEGER NOT NULL,
    observaciones TEXT,
    actualizado_en TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (checklist_id) REFERENCES checklists(id),
    FOREIGN KEY (item_id) REFERENCES checklist_items(id),
    UNIQUE(checklist_id, item_id)
  )`);
  
  console.log("✅ Tablas creadas/verificadas");
}

function insertarSecciones() {
  console.log("📋 Insertando secciones...");
  
  const secciones = [
    [1, '1. INICIO DEL TURNO', 1],
    [2, '2. DURANTE DEL TURNO', 2],
    [3, '3. CIERRE DEL TURNO', 3]
  ];
  
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO secciones (id, titulo, orden_num) 
    VALUES (?, ?, ?)
  `);
  
  secciones.forEach(sec => {
    stmt.run(sec);
  });
  
  stmt.finalize();
  console.log("✅ Secciones insertadas");
}

function insertarItemsEjemplo() {
  console.log("📝 Insertando items del checklist...");
  
  const items = [
    // SECCIÓN 1: INICIO DEL TURNO
    [1, 1, null, 'Registrar asistencia y uniforme del personal.', 1, 0],
    [2, 1, null, 'Reunión breve con líderes de línea.', 2, 0],
    [3, 1, null, 'Limpieza.', 3, 0],
    [4, 1, null, 'Manual de producción.', 4, 0],
    [5, 1, null, 'Planificación.', 5, 0],
    [6, 1, null, 'Realizar inspección general del área de producción.', 6, 0],
    [7, 1, null, 'Recepción de informe de personal ausente / Máquinas no disponibles.', 7, 0],
    [8, 1, null, 'Confirmar condiciones generales del área (orden, limpieza, iluminación, temperatura)', 8, 0],
    
    // SECCIÓN 2: DESARROLLO DEL TURNO
    [9, 2, null, 'Seguimiento a metas de producción diarias.', 1, 0],
    [10, 2, null, 'Verificación de calidad en línea de producción.', 2, 1],
    [11, 2, null, 'Supervisar el uso correcto del EPP.', 3, 0],
    [12, 2, null, 'Maquinaria disponible', 4, 0],
    [13, 2, null, 'Maquinaria operativa', 5, 0],
    [14, 2, null, 'Materia prima disponible', 6, 0],
    [15, 2, null, 'Etiquetas', 7, 0],
    [16, 2, null, 'Registro y atención a desviaciones o no conformidades.', 8, 0],
    [17, 2, null, 'Reuniones breves con áreas de soporte según necesidad.', 9, 0],
    [18, 2, null, 'Fomentar trabajo en equipo y retroalimentación positiva.', 10, 0],
    [19, 2, null, 'Reunión de planificación.', 11, 0],
    [20, 2, null, 'Realización de Modulos de trabajo', 12, 0],

    // SECCIÓN 3: CIERRE DEL TURNO
    [21, 3, null, 'Cumplimiento', 1, 0],
    [22, 3, null, 'Confección, empaque y rotación', 2, 0],
    [23, 3, null, 'Elaborar reporte del turno (producción, calidad, incidencias)', 3, 0],
    [24, 3, null, 'Verificar que las máquinas y la luz queden apagadas.', 4, 0],
    [25, 3, null, 'Asegurar que las luces se encuentren apagadas.', 5, 0],
    [26, 3, null, 'Revisar que las puertas se encuentren cerradas.', 6, 0]
  ];
  
  // === ESTO ES LO QUE FALTABA: EL INSERT ===
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO checklist_items (id, seccion_id, parent_item_id, descripcion, orden_num, tiene_subitems) 
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  items.forEach(item => {
    stmt.run(item, function(err) {
      if (err) {
        console.error(`❌ Error insertando item ${item[0]}:`, err.message);
      }
    });
  });
  
  stmt.finalize();
  console.log(`✅ ${items.length} items insertados`);
}

async function insertarUsuarios() {
  console.log("👥 Insertando usuarios de ejemplo...");
  
  const usuarios = [
    ["administrador_tics", "admin123", "ADMINISTRADOR", "Administrador TICS"],
    ["jefe_produccion", "1456", "JEFE_PRODUCCION", "Enma Nelly Morales Collaguazo"],
    ["nancy_de_la_cruz", "1587", "SUPERVISOR", "Nancy Lucía De La Cruz Paguay"],
    ["silvia_llumiquinga", "8965", "SUPERVISOR", "Silvia Dolores Llumiquinga Analuisa"],
    ["lucia_ango", "1245", "SUPERVISOR", "Lucia Otilia Ango Chuquimarca"]
  ];
  
  for (const user of usuarios) {
    const existe = await new Promise((resolve) => {
      db.get("SELECT id FROM usuarios WHERE username = ?", [user[0]], (err, row) => {
        resolve(row);
      });
    });
    
    if (!existe) {
      const hash = await bcrypt.hash(user[1], 10);
      db.run(
        `INSERT INTO usuarios (username, password, role, nombre, area) 
         VALUES (?, ?, ?, ?, ?)`,
        [user[0], hash, user[2], user[3], null],
        function(err) {
          if (err) {
            console.error(`❌ Error al insertar usuario ${user[0]}:`, err.message);
          } else {
            console.log(`✅ Usuario ${user[0]} insertado con ID ${this.lastID} (rol: ${user[2]})`);
          }
        }
      );
    } else {
      console.log(`⚠️ Usuario ${user[0]} ya existe, omitiendo...`);
    }
  }
}

// =============================================
// FUNCIONES HELPER
// =============================================
db.query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

db.queryOne = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

db.runAsync = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

// =============================================
// INICIALIZAR BASE DE DATOS
// =============================================
async function inicializarBaseDatos() {
  console.log("🚀 Inicializando base de datos...");
  
  return new Promise((resolve, reject) => {
    db.serialize(async () => {
      try {
        crearTablas();
        
        setTimeout(async () => {
          insertarSecciones();
          insertarItemsEjemplo();
          await insertarUsuarios();
          
          console.log("✨ Base de datos inicializada correctamente");
          resolve();
        }, 500);
      } catch (error) {
        console.error("❌ Error inicializando:", error);
        reject(error);
      }
    });
  });
}

if (require.main === module) {
  inicializarBaseDatos().then(() => {
    console.log("🎉 Listo!");
    process.exit(0);
  });
}

module.exports = { db, inicializarBaseDatos };