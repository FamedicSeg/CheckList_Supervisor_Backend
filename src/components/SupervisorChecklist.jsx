import { useState, useEffect, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function SupervisorChecklist({ token, onLogout }) {
  const [checklistId, setChecklistId] = useState(null);
  const [checklistStatus, setChecklistStatus] = useState('en_progreso');
  const [secciones, setSecciones] = useState([]);
  const [respuestas, setRespuestas] = useState({});
  const [observacionesGenerales, setObservacionesGenerales] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [mensajeGuardado, setMensajeGuardado] = useState('');

  // ─── Load active checklist on mount ───────────────────────────────────────
  useEffect(() => {
    cargarChecklist();
  }, []);

  async function cargarChecklist() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/supervisor/active-checklist`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Error al cargar checklist');
      const data = await res.json();

      setChecklistId(data.checklist_id);
      setChecklistStatus(data.status);
      setObservacionesGenerales(data.observaciones_generales || '');
      setRespuestas(data.respuestas || {});

      // Group items by section
      const seccionesMap = {};
      (data.items || []).forEach(item => {
        const sid = item.seccion_id;
        if (!seccionesMap[sid]) {
          seccionesMap[sid] = { id: sid, titulo: item.seccion_titulo, items: [] };
        }
        seccionesMap[sid].items.push(item);
      });
      setSecciones(Object.values(seccionesMap));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ─── Save a single item response ──────────────────────────────────────────
  const guardarRespuesta = useCallback(
    async (itemId, verificado, observaciones) => {
      if (!checklistId) return;
      try {
        const res = await fetch(`${API_BASE}/api/supervisor/response`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            checklist_id: checklistId,
            item_id: itemId,
            verificado,
            observaciones: observaciones || null,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          console.error('Error guardando respuesta:', data.error);
        }
      } catch (err) {
        console.error('Error de red al guardar respuesta:', err);
      }
    },
    [checklistId, token]
  );

  // ─── Toggle verificado ────────────────────────────────────────────────────
  // FIX: capture the current observaciones value BEFORE calling setRespuestas,
  // then pass the new verificado value AND the captured observaciones directly
  // to guardarRespuesta. This avoids the stale-state race condition where
  // guardarRespuesta would be called with the old respuestas object because
  // React's state update is asynchronous.
  const toggleVerificacion = (itemId, targetValue) => {
    if (checklistStatus === 'completado') return;

    // Capture current observaciones from the existing state synchronously
    const currentObservaciones = respuestas[itemId]?.observaciones || '';

    // Update local UI state
    setRespuestas(prev => ({
      ...prev,
      [itemId]: {
        verificado: targetValue,
        observaciones: currentObservaciones,
      },
    }));

    // Call API immediately with the correct new values — do NOT read from
    // respuestas state here because the setState above hasn't flushed yet.
    guardarRespuesta(itemId, targetValue, currentObservaciones);
  };

  // ─── Update observaciones (local only; saved on blur) ─────────────────────
  const actualizarObservaciones = (itemId, value) => {
    if (checklistStatus === 'completado') return;
    setRespuestas(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        observaciones: value,
      },
    }));
  };

  // ─── Save observaciones on blur ───────────────────────────────────────────
  const guardarObservacionesItem = (itemId) => {
    if (checklistStatus === 'completado') return;
    const item = respuestas[itemId] || {};
    guardarRespuesta(itemId, item.verificado, item.observaciones || '');
  };

  // ─── Save general observations ────────────────────────────────────────────
  const guardarProgreso = async () => {
    if (!checklistId) return;
    setGuardando(true);
    try {
      const res = await fetch(`${API_BASE}/api/supervisor/save-progress`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          checklist_id: checklistId,
          observaciones_generales: observacionesGenerales,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Error al guardar');
      mostrarMensaje('Progreso guardado ✓');
    } catch (err) {
      mostrarMensaje(`Error: ${err.message}`, true);
    } finally {
      setGuardando(false);
    }
  };

  // ─── Finalize checklist ───────────────────────────────────────────────────
  const finalizarChecklist = async () => {
    if (!checklistId) return;
    if (!window.confirm('¿Deseas finalizar el turno? No podrás modificar las respuestas después.')) return;
    setGuardando(true);
    try {
      const res = await fetch(`${API_BASE}/api/supervisor/finalize-checklist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          checklist_id: checklistId,
          observaciones_generales: observacionesGenerales,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Error al finalizar');
      setChecklistStatus('completado');
      mostrarMensaje('Turno finalizado ✓');
    } catch (err) {
      mostrarMensaje(`Error: ${err.message}`, true);
    } finally {
      setGuardando(false);
    }
  };

  // ─── Toast helper ─────────────────────────────────────────────────────────
  const mostrarMensaje = (msg, esError = false) => {
    setMensajeGuardado({ texto: msg, esError });
    setTimeout(() => setMensajeGuardado(''), 3000);
  };

  // ─── Progress calculation ─────────────────────────────────────────────────
  const totalItems = secciones.reduce((acc, s) => acc + s.items.filter(i => !i.tiene_subitems).length, 0);
  const respondidos = Object.values(respuestas).filter(r => r.verificado !== undefined && r.verificado !== null && r.verificado !== -1).length;
  const progreso = totalItems > 0 ? Math.round((respondidos / totalItems) * 100) : 0;

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500 text-lg">Cargando checklist…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-red-600 font-medium">{error}</p>
        <button onClick={cargarChecklist} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-blue-700 text-white px-6 py-4 flex items-center justify-between shadow-md">
        <h1 className="text-xl font-bold">Checklist de Supervisión</h1>
        <div className="flex items-center gap-4">
          {checklistStatus === 'completado' && (
            <span className="bg-green-500 text-white text-xs font-semibold px-3 py-1 rounded-full">
              Turno finalizado
            </span>
          )}
          <button onClick={onLogout} className="text-sm text-blue-200 hover:text-white transition">
            Cerrar sesión
          </button>
        </div>
      </header>

      {/* Progress bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
          <span>Progreso del turno</span>
          <span className="font-semibold">{respondidos} / {totalItems} ítems ({progreso}%)</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progreso}%` }}
          />
        </div>
      </div>

      {/* Toast */}
      {mensajeGuardado && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${mensajeGuardado.esError ? 'bg-red-600' : 'bg-green-600'}`}>
          {mensajeGuardado.texto}
        </div>
      )}

      {/* Checklist sections */}
      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {secciones.map(seccion => (
          <section key={seccion.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-blue-50 border-b border-blue-100 px-5 py-3">
              <h2 className="font-semibold text-blue-800">{seccion.titulo}</h2>
            </div>
            <ul className="divide-y divide-gray-100">
              {seccion.items.map(item => {
                const respuesta = respuestas[item.item_id] || {};
                const esSubitem = !!item.parent_item_id;
                const esCabecera = item.tiene_subitems;

                return (
                  <li
                    key={item.item_id}
                    className={`px-5 py-4 ${esSubitem ? 'pl-10 bg-gray-50' : ''} ${esCabecera ? 'bg-blue-50/40' : ''}`}
                  >
                    <div className="flex items-start gap-4">
                      {/* Description */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${esCabecera ? 'font-semibold text-gray-800' : 'text-gray-700'}`}>
                          {esSubitem && <span className="text-gray-400 mr-1">↳</span>}
                          {item.descripcion}
                        </p>

                        {/* Observaciones textarea — only for leaf items */}
                        {!esCabecera && (
                          <textarea
                            className="mt-2 w-full text-xs border border-gray-200 rounded-md px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-100 disabled:text-gray-400"
                            rows={2}
                            placeholder="Observaciones (opcional)…"
                            value={respuesta.observaciones || ''}
                            disabled={checklistStatus === 'completado'}
                            onChange={e => actualizarObservaciones(item.item_id, e.target.value)}
                            onBlur={() => guardarObservacionesItem(item.item_id)}
                          />
                        )}
                      </div>

                      {/* Sí / No buttons — only for leaf items */}
                      {!esCabecera && (
                        <div className="flex gap-2 flex-shrink-0">
                          <button
                            onClick={() => toggleVerificacion(item.item_id, true)}
                            disabled={checklistStatus === 'completado'}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                              respuesta.verificado === true || respuesta.verificado === 1
                                ? 'bg-green-600 text-white shadow-sm'
                                : 'bg-gray-100 text-gray-600 hover:bg-green-100 hover:text-green-700'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            Sí
                          </button>
                          <button
                            onClick={() => toggleVerificacion(item.item_id, false)}
                            disabled={checklistStatus === 'completado'}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                              respuesta.verificado === false || respuesta.verificado === 0
                                ? 'bg-red-600 text-white shadow-sm'
                                : 'bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-700'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            No
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {/* General observations */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-800 mb-3">Observaciones generales del turno</h2>
          <textarea
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-gray-100 disabled:text-gray-400"
            rows={4}
            placeholder="Ingresa observaciones generales del turno…"
            value={observacionesGenerales}
            disabled={checklistStatus === 'completado'}
            onChange={e => setObservacionesGenerales(e.target.value)}
          />
        </section>

        {/* Action buttons */}
        {checklistStatus !== 'completado' && (
          <div className="flex gap-3 justify-end pb-8">
            <button
              onClick={guardarProgreso}
              disabled={guardando}
              className="px-5 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium rounded-lg transition disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : 'Guardar progreso'}
            </button>
            <button
              onClick={finalizarChecklist}
              disabled={guardando}
              className="px-5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white font-medium rounded-lg transition disabled:opacity-50"
            >
              Finalizar turno
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
