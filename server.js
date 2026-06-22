const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { db, inicializarBaseDatos } = require('./db');

const app = express();
const PORT = 5000;
const JWT_SECRET = 'tu-secreto-super-seguro-cambiar-en-produccion';

// Middleware
app.use(cors());
app.use(express.json());

// =============================================
// MIDDLEWARE DE AUTENTICACIÓN
// =============================================

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido' });
    }
    req.user = user;
    next();
  });
};

const checkRole = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    next();
  };
};

// =============================================
// ENDPOINTS DE AUTENTICACIÓN
// =============================================

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }
  
  try {
    const user = await db.queryOne(
      'SELECT * FROM usuarios WHERE username = ?',
      [username]
    );
    
    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    
    const bcrypt = require('bcrypt');
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        nombre: user.nombre,
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        nombre: user.nombre,
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Listar usuarios para el login (solo nombre visible, sin contraseña)
app.get('/api/usuarios', async (req, res) => {
  try {
    const usuarios = await db.query(
      'SELECT id, username, nombre, role FROM usuarios ORDER BY nombre ASC'
    );
    res.json(usuarios);
  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// =============================================
// ENDPOINTS PARA SUPERVISOR
// =============================================

// Obtener checklist activo del supervisor (o crear uno nuevo)
app.get('/api/supervisor/active-checklist', authenticateToken, checkRole(['SUPERVISOR']), async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const supervisorId = req.user.id;
  
  try {
    // Buscar checklist del día (en progreso o completado)
    let checklist = await db.queryOne(
      `SELECT * FROM checklists 
       WHERE supervisor_id = ? AND fecha = ? AND status IN ('en_progreso', 'completado')
       ORDER BY id DESC LIMIT 1`,
      [supervisorId, today]
    );
    
    if (!checklist) {
      // Crear nuevo checklist para hoy
      const result = await db.runAsync(
        `INSERT INTO checklists (supervisor_id, numero_turno, fecha, status) 
         VALUES (?, ?, ?, 'en_progreso')`,
        [supervisorId, 1, today]
      );
      
      checklist = await db.queryOne('SELECT * FROM checklists WHERE id = ?', [result.lastID]);
    }
    
    // Obtener todos los items del checklist
    const items = await db.query(`
      SELECT 
        s.id as seccion_id,
        s.titulo as seccion_titulo,
        ci.id as item_id,
        ci.parent_item_id,
        ci.descripcion,
        ci.tiene_subitems
      FROM secciones s
      JOIN checklist_items ci ON ci.seccion_id = s.id
      ORDER BY s.orden_num, COALESCE(ci.parent_item_id, ci.id), ci.orden_num
    `);
    
    // Obtener respuestas existentes
    const respuestas = await db.query(
      'SELECT item_id, verificado, observaciones FROM respuestas WHERE checklist_id = ?',
      [checklist.id]
    );
    
    // Mapear respuestas
    const respuestasMap = {};
    respuestas.forEach(r => {
      respuestasMap[r.item_id] = {
        verificado: r.verificado,
        observaciones: r.observaciones
      };
    });
    
    res.json({
      checklist_id: checklist.id,
      items: items,
      respuestas: respuestasMap,
      status: checklist.status,
      observaciones_generales: checklist.observaciones_generales || ''
    });
  } catch (error) {
    console.error('Error obteniendo checklist:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Guardar progreso (observaciones generales, sin finalizar)
app.post('/api/supervisor/save-progress', authenticateToken, checkRole(['SUPERVISOR']), async (req, res) => {
  const { checklist_id, observaciones_generales } = req.body;

  try {
    const result = await db.runAsync(
      `UPDATE checklists
       SET observaciones_generales = ?
       WHERE id = ? AND supervisor_id = ? AND (status = 'en_progreso' OR status = 'en_edicion')`,
      [observaciones_generales || null, checklist_id, req.user.id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Checklist no encontrado o no disponible para editar' });
    }

    res.json({ success: true, message: 'Progreso guardado correctamente' });
  } catch (error) {
    console.error('Error guardando progreso:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Guardar respuesta (borrador)
app.post('/api/supervisor/response', authenticateToken, checkRole(['SUPERVISOR']), async (req, res) => {
  const { checklist_id, item_id, verificado, observaciones } = req.body;
  
  if (!checklist_id || !item_id || verificado === undefined) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  // Verificar que el checklist esté en estado editable (en_progreso o en_edicion)
  try {
    const cl = await db.queryOne('SELECT status FROM checklists WHERE id = ? AND supervisor_id = ?', [checklist_id, req.user.id]);
    if (!cl) {
      return res.status(404).json({ error: 'Checklist no encontrado' });
    }
    if (cl.status !== 'en_progreso' && cl.status !== 'en_edicion') {
      return res.status(403).json({ error: 'El turno no está disponible para editar. Estado: ' + cl.status });
    }
  } catch (error) {
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
  
  try {
    await db.runAsync(
      `INSERT INTO respuestas (checklist_id, item_id, verificado, observaciones, actualizado_en)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(checklist_id, item_id) DO UPDATE SET
         verificado = excluded.verificado,
         observaciones = excluded.observaciones,
         actualizado_en = CURRENT_TIMESTAMP`,
      [checklist_id, item_id, verificado ? 1 : 0, observaciones || null]
    );
    
    res.json({ success: true, message: 'Respuesta guardada' });
  } catch (error) {
    console.error('Error guardando respuesta:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Finalizar checklist
app.post('/api/supervisor/finalize-checklist', authenticateToken, checkRole(['SUPERVISOR']), async (req, res) => {
  const { checklist_id, observaciones_generales } = req.body;
  
  try {
    const result = await db.runAsync(
      `UPDATE checklists 
       SET status = 'completado', 
           completado_en = datetime('now', '-5 hours'),
           observaciones_generales = ?
       WHERE id = ? AND supervisor_id = ?`,
      [observaciones_generales || null, checklist_id, req.user.id]
    );
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Checklist no encontrado' });
    }
    
    res.json({ success: true, message: 'Checklist finalizado' });
  } catch (error) {
    console.error('Error finalizando checklist:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Reabrir checklist para edición (cambiar status de 'completado' a 'en_edicion')
app.post('/api/supervisor/reopen-checklist', authenticateToken, checkRole(['SUPERVISOR']), async (req, res) => {
  const { checklist_id } = req.body;
  
  try {
    const result = await db.runAsync(
      `UPDATE checklists 
       SET status = 'en_edicion'
       WHERE id = ? AND supervisor_id = ? AND (status = 'completado' OR status = 'finalizado' OR status = 'en_progreso')`,
      [checklist_id, req.user.id]
    );
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Checklist no encontrado o no está finalizado' });
    }
    
    res.json({ success: true, message: 'Checklist reabierto para edición' });
  } catch (error) {
    console.error('Error reabriendo checklist:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Finalizar edición (cambiar status de 'en_edicion' a 'completado')
app.post('/api/supervisor/finalize-edit', authenticateToken, checkRole(['SUPERVISOR']), async (req, res) => {
  const { checklist_id, observaciones_generales } = req.body;
  
  try {
    const result = await db.runAsync(
      `UPDATE checklists 
       SET status = 'completado',
           completado_en = datetime('now', '-5 hours'),
           observaciones_generales = ?
       WHERE id = ? AND supervisor_id = ? AND status = 'en_edicion'`,
      [observaciones_generales || null, checklist_id, req.user.id]
    );
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Checklist no encontrado o no está en edición' });
    }
    
    res.json({ success: true, message: 'Edición finalizada' });
  } catch (error) {
    console.error('Error finalizando edición:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Historial de checklists del propio supervisor
app.get('/api/supervisor/history', authenticateToken, checkRole(['SUPERVISOR']), async (req, res) => {
  try {
    const checklists = await db.query(`
      SELECT
        c.id,
        c.fecha,
        c.numero_turno,
        c.status,
        c.observaciones_generales,
        c.iniciado_en,
        c.completado_en,
        COUNT(r.id) as items_respondidos,
        (SELECT COUNT(*) FROM checklist_items) as total_items
      FROM checklists c
      LEFT JOIN respuestas r ON r.checklist_id = c.id
      WHERE c.supervisor_id = ?
      GROUP BY c.id
      ORDER BY c.fecha DESC, c.iniciado_en DESC
    `, [req.user.id]);

    const result = checklists.map(row => ({
      ...row,
      progreso: row.total_items > 0
        ? Math.round((row.items_respondidos / row.total_items) * 100)
        : 0
    }));

    res.json(result);
  } catch (error) {
    console.error('Error obteniendo historial del supervisor:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ver detalle de un checklist propio (supervisor)
app.get('/api/supervisor/checklist/:id', authenticateToken, checkRole(['SUPERVISOR']), async (req, res) => {
  const checklistId = req.params.id;

  try {
    const checklist = await db.queryOne(
      'SELECT * FROM checklists WHERE id = ? AND supervisor_id = ?',
      [checklistId, req.user.id]
    );

    if (!checklist) {
      return res.status(404).json({ error: 'Checklist no encontrado' });
    }

    const respuestas = await db.query(`
      SELECT
        s.id as seccion_id,
        s.titulo as seccion_titulo,
        ci.id as item_id,
        ci.parent_item_id,
        ci.descripcion,
        ci.tiene_subitems,
        COALESCE(r.verificado, -1) as verificado,
        r.observaciones
      FROM secciones s
      CROSS JOIN checklist_items ci
      LEFT JOIN respuestas r ON r.checklist_id = ? AND r.item_id = ci.id
      WHERE ci.seccion_id = s.id
      ORDER BY s.orden_num, COALESCE(ci.parent_item_id, ci.id), ci.orden_num
    `, [checklistId]);

    const secciones = {};
    respuestas.forEach(resp => {
      if (!secciones[resp.seccion_id]) {
        secciones[resp.seccion_id] = { titulo: resp.seccion_titulo, items: [] };
      }
      secciones[resp.seccion_id].items.push(resp);
    });

    res.json({ checklist, secciones: Object.values(secciones) });
  } catch (error) {
    console.error('Error obteniendo detalle del supervisor:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// =============================================
// ENDPOINTS PARA JEFE DE PRODUCCIÓN
// =============================================

// Obtener todos los checklists
app.get('/api/jefe/checklists', authenticateToken, checkRole(['JEFE_PRODUCCION', 'ADMINISTRADOR']), async (req, res) => {
  try {
    const checklists = await db.query(`
      SELECT 
        c.id,
        u.nombre as supervisor_nombre,
        c.numero_turno,
        c.fecha,
        c.status,
        c.iniciado_en,
        c.completado_en,
        c.observaciones_generales,
        COUNT(r.id) as items_respondidos,
        (SELECT COUNT(*) FROM checklist_items) as total_items
      FROM checklists c
      JOIN usuarios u ON u.id = c.supervisor_id
      LEFT JOIN respuestas r ON r.checklist_id = c.id
      GROUP BY c.id
      ORDER BY c.fecha DESC, c.iniciado_en DESC
    `);
    
    const result = checklists.map(row => ({
      ...row,
      progreso: row.total_items > 0
        ? Math.round((row.items_respondidos / row.total_items) * 100)
        : 0
    }));
    
    res.json(result);
  } catch (error) {
    console.error('Error obteniendo checklists:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
})

// Obtener checklists activos (en tiempo real)
app.get('/api/jefe/active-checklists', authenticateToken, checkRole(['JEFE_PRODUCCION', 'ADMINISTRADOR']), async (req, res) => {
  try {
    const checklists = await db.query(`
      SELECT 
        c.id,
        u.nombre as supervisor_nombre,
        c.numero_turno,
        c.iniciado_en,
        COUNT(r.id) as items_respondidos,
        (SELECT COUNT(*) FROM checklist_items) as total_items,
        MAX(r.actualizado_en) as ultima_actividad
      FROM checklists c
      JOIN usuarios u ON u.id = c.supervisor_id
      LEFT JOIN respuestas r ON r.checklist_id = c.id
      WHERE c.status = 'en_progreso'
      GROUP BY c.id
      ORDER BY ultima_actividad DESC
    `);
    
    const result = checklists.map(row => ({
      ...row,
      progreso: row.total_items > 0
        ? Math.round((row.items_respondidos / row.total_items) * 100)
        : 0
    }));
    
    res.json(result);
  } catch (error) {
    console.error('Error obteniendo checklists activos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
})

// Ver detalle de un checklist específico
app.get('/api/jefe/checklists/:id', authenticateToken, checkRole(['JEFE_PRODUCCION', 'ADMINISTRADOR']), async (req, res) => {
  const checklistId = req.params.id;
  
  try {
    // Obtener información del checklist
    const checklist = await db.queryOne(`
      SELECT 
        c.*,
        u.nombre as supervisor_nombre
      FROM checklists c
      JOIN usuarios u ON u.id = c.supervisor_id
      WHERE c.id = ?
    `, [checklistId]);
    
    if (!checklist) {
      return res.status(404).json({ error: 'Checklist no encontrado' });
    }
    
    // Obtener todas las respuestas con estructura
    const respuestas = await db.query(`
      SELECT 
        s.id as seccion_id,
        s.titulo as seccion_titulo,
        ci.id as item_id,
        ci.parent_item_id,
        ci.descripcion,
        ci.tiene_subitems,
        COALESCE(r.verificado, -1) as verificado,
        r.observaciones,
        r.actualizado_en
      FROM secciones s
      CROSS JOIN checklist_items ci
      LEFT JOIN respuestas r ON r.checklist_id = ? AND r.item_id = ci.id
      WHERE ci.seccion_id = s.id
      ORDER BY s.orden_num, COALESCE(ci.parent_item_id, ci.id), ci.orden_num
    `, [checklistId]);
    
    // Agrupar por sección
    const secciones = {};
    respuestas.forEach(resp => {
      if (!secciones[resp.seccion_id]) {
        secciones[resp.seccion_id] = {
          titulo: resp.seccion_titulo,
          items: []
        };
      }
      secciones[resp.seccion_id].items.push(resp);
    });
    
    res.json({
      checklist,
      secciones: Object.values(secciones)
    });
  } catch (error) {
    console.error('Error obteniendo detalle del checklist:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Indicadores: estadísticas de Sí/No por ítem
app.get('/api/jefe/item-stats', authenticateToken, checkRole(['JEFE_PRODUCCION', 'ADMINISTRADOR']), async (req, res) => {
  try {
    const stats = await db.query(`
      SELECT
        ci.id        AS item_id,
        ci.descripcion,
        ci.parent_item_id,
        s.id         AS seccion_id,
        s.titulo     AS seccion_titulo,
        COUNT(CASE WHEN r.verificado = 1 THEN 1 END) AS total_si,
        COUNT(CASE WHEN r.verificado = 0 THEN 1 END) AS total_no
      FROM checklist_items ci
      JOIN secciones s ON s.id = ci.seccion_id
      LEFT JOIN respuestas r ON r.item_id = ci.id
      GROUP BY ci.id
      ORDER BY s.orden_num, COALESCE(ci.parent_item_id, ci.id), ci.orden_num
    `);

    const secciones = {};
    stats.forEach(row => {
      if (!secciones[row.seccion_id]) {
        secciones[row.seccion_id] = { titulo: row.seccion_titulo, items: [] };
      }
      const total = row.total_si + row.total_no;
      secciones[row.seccion_id].items.push({
        item_id: row.item_id,
        descripcion: row.descripcion,
        parent_item_id: row.parent_item_id,
        total_si: row.total_si,
        total_no: row.total_no,
        total,
        pct_si: total > 0 ? Math.round((row.total_si / total) * 100) : 0,
        pct_no: total > 0 ? Math.round((row.total_no / total) * 100) : 0,
      });
    });

    res.json({ secciones: Object.values(secciones) });
  } catch (error) {
    console.error('Error obteniendo estadísticas por ítem:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Indicadores semanales: resumen + desglose por ítem para una semana dada
// Query param: week=YYYY-Www  (ej. 2026-W23)
app.get('/api/jefe/weekly-stats', authenticateToken, checkRole(['JEFE_PRODUCCION', 'ADMINISTRADOR']), async (req, res) => {
  const { week } = req.query; // e.g. "2026-W23"

  // Calcular lunes y domingo de la semana ISO
  let fechaInicio, fechaFin;
  try {
    if (!week || !/^\d{4}-W\d{2}$/.test(week)) {
      return res.status(400).json({ error: 'Parámetro week inválido. Formato esperado: YYYY-Www' });
    }
    const [yearStr, weekStr] = week.split('-W');
    const year = parseInt(yearStr, 10);
    const weekNum = parseInt(weekStr, 10);

    // Calcular el lunes de la semana ISO
    // 4 de enero siempre está en la semana 1 del año
    const jan4 = new Date(year, 0, 4);
    const jan4Day = jan4.getDay() || 7; // 1=lun .. 7=dom
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - (jan4Day - 1) + (weekNum - 1) * 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const pad = (n) => String(n).padStart(2, '0');
    fechaInicio = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
    fechaFin = `${sunday.getFullYear()}-${pad(sunday.getMonth() + 1)}-${pad(sunday.getDate())}`;
  } catch (e) {
    return res.status(400).json({ error: 'Error procesando el parámetro week' });
  }

  try {
    // ── Resumen general de la semana ──
    const resumen = await db.queryOne(`
      SELECT
        COUNT(DISTINCT c.id)                                          AS total_turnos,
        COUNT(DISTINCT CASE WHEN c.status = 'completado' THEN c.id END) AS turnos_completados,
        COUNT(CASE WHEN r.verificado = 1 THEN 1 END)                  AS total_si,
        COUNT(CASE WHEN r.verificado = 0 THEN 1 END)                  AS total_no,
        (
          SELECT COUNT(*) FROM checklist_items
        ) * COUNT(DISTINCT c.id)
        - COUNT(CASE WHEN r.verificado IN (0,1) THEN 1 END)           AS total_pendientes
      FROM checklists c
      LEFT JOIN respuestas r ON r.checklist_id = c.id
      WHERE c.fecha BETWEEN ? AND ?
    `, [fechaInicio, fechaFin]);

    // ── Desglose por ítem ──
    const stats = await db.query(`
      SELECT
        ci.id           AS item_id,
        ci.descripcion,
        ci.parent_item_id,
        s.id            AS seccion_id,
        s.titulo        AS seccion_titulo,
        COUNT(CASE WHEN r.verificado = 1 THEN 1 END) AS total_si,
        COUNT(CASE WHEN r.verificado = 0 THEN 1 END) AS total_no
      FROM checklist_items ci
      JOIN secciones s ON s.id = ci.seccion_id
      LEFT JOIN respuestas r ON r.item_id = ci.id
        AND r.checklist_id IN (
          SELECT id FROM checklists WHERE fecha BETWEEN ? AND ?
        )
      GROUP BY ci.id
      ORDER BY s.orden_num, COALESCE(ci.parent_item_id, ci.id), ci.orden_num
    `, [fechaInicio, fechaFin]);

    const secciones = {};
    stats.forEach(row => {
      if (!secciones[row.seccion_id]) {
        secciones[row.seccion_id] = { titulo: row.seccion_titulo, items: [] };
      }
      const total = row.total_si + row.total_no;
      secciones[row.seccion_id].items.push({
        item_id: row.item_id,
        descripcion: row.descripcion,
        parent_item_id: row.parent_item_id,
        total_si: row.total_si,
        total_no: row.total_no,
        total,
        pct_si: total > 0 ? Math.round((row.total_si / total) * 100) : 0,
        pct_no: total > 0 ? Math.round((row.total_no / total) * 100) : 0,
      });
    });

    res.json({
      semana: week,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      resumen: {
        total_turnos: resumen.total_turnos || 0,
        turnos_completados: resumen.turnos_completados || 0,
        total_si: resumen.total_si || 0,
        total_no: resumen.total_no || 0,
        total_pendientes: Math.max(resumen.total_pendientes || 0, 0),
      },
      secciones: Object.values(secciones),
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas semanales:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// =============================================
// INICIAR SERVIDOR
// =============================================

// Inicializar base de datos y luego iniciar el servidor
inicializarBaseDatos().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📋 Endpoints disponibles:`);
    console.log(`   POST   /api/auth/login`);
    console.log(`   GET    /api/supervisor/active-checklist`);
    console.log(`   POST   /api/supervisor/response`);
    console.log(`   POST   /api/supervisor/finalize-checklist`);
    console.log(`   GET    /api/jefe/checklists`);
    console.log(`   GET    /api/jefe/active-checklists`);
    console.log(`   GET    /api/jefe/checklists/:id`);
  });
}).catch(error => {
  console.error('❌ Error al inicializar la base de datos:', error);
  process.exit(1);
});