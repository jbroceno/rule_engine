function calcAge(birthDateStr) {
  if (!birthDateStr) return null;
  const birth = new Date(birthDateStr);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function calcMonths(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const today = new Date();
  return (today.getFullYear() - d.getFullYear()) * 12 + (today.getMonth() - d.getMonth());
}

// Maps Workflow request body → motor engine input object.
// Contract: spec RF-012 (camelCase fields + SCREAMING_SNAKE_CASE inside arrIntervinientes).
export function adaptWorkflowToMotor(body) {
  const titulares = Array.isArray(body.arrIntervinientes) ? body.arrIntervinientes : [];

  // Sort by ORDEN_NM so T1 is always the first interviniente
  const sorted = [...titulares].sort((a, b) => (a.ORDEN_NM ?? 0) - (b.ORDEN_NM ?? 0));
  const t1 = sorted[0] ?? {};
  const t2 = sorted[1] ?? null;

  const normalizeIncome = (t) =>
    t && t.INGRESOS_INTERV_NM != null && t.NUMERO_PAGAS_NM
      ? (t.INGRESOS_INTERV_NM * t.NUMERO_PAGAS_NM) / 14
      : (t?.INGRESOS_INTERV_NM ?? 0);

  // Total income normalized to 14 pagas
  const ingresoTotal14 = sorted.reduce((sum, t) => sum + normalizeIncome(t), 0);

  // Max age across all titulares (the engine uses a single edadMax)
  const edadMax = sorted.reduce((max, t) => {
    const age = calcAge(t.NACIMIENTO_DT);
    return age !== null ? Math.max(max ?? -Infinity, age) : max;
  }, null);

  // domiciliaNomina → both T1 and T2 receive the same value
  const domiciliaNomina = Boolean(body.domiciliaNomina);

  const plazo = body.plazoNm ?? null;

  return {
    // Identity / context
    tipoAlta: body.tipoAltaCd ?? null,
    finalidad: body.finalidadCd != null ? parseInt(String(body.finalidadCd), 10) : null,
    viviendaNueva: Boolean(body.viviendaNuevaFl),
    comunidadAutonoma: body.comunidadAutonomaCd ?? null,
    primeraViviendaHabitual: body.primeraViviendaHabitualFl ? 1 : 0,
    esViviendaHabitual: Boolean(body.primeraViviendaHabitualFl),

    // Titulares
    numTitulares: sorted.length,
    edadMax,
    antiguedadT1: calcMonths(t1.ANTIGUEDAD_CLIENTE_DT) ?? 0,
    antiguedadT2: t2 ? (calcMonths(t2.ANTIGUEDAD_CLIENTE_DT) ?? 0) : 0,
    ingresoTotal14,
    domiciliaNominaT1: domiciliaNomina,
    domiciliaNominaT2: domiciliaNomina,

    // Financial
    importeHipoteca: body.importeHipotecaNm ?? null,
    importeVivienda: body.importeViviendaNm ?? null,
    plazo,
  };
}

// Maps a unified motor result object → Workflow response envelope.
// motorResult: { eligibleOffers, uiLimits, winner }
export function adaptMotorToWorkflow(motorResult) {
  const ofertaGanadora = motorResult.winner
    ? { offerCode: motorResult.winner.offerCode, offer_rank: motorResult.winner.offer_rank }
    : null;

  return {
    RESULTADO: {
      LIMITES: motorResult.uiLimits ?? null,
      OFERTAS_ELEGIBLES: (motorResult.eligibleOffers ?? []).map((o) => ({
        offerCode: o.offerCode,
        offer_rank: o.offer_rank,
      })),
      OFERTA_GANADORA: ofertaGanadora,
    },
  };
}
