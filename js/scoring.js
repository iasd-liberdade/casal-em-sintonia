/* =========================================================
   Apuração da rodada e ranking.
   Funções puras — nenhuma dependência de Firebase ou DOM.
   A mesma lógica existe em functions/index.js (modo Cloud Functions).
   ========================================================= */

export const ROUND_STATUS = {
  INCOMPLETE: 'INCOMPLETE',     // um ou nenhum dos dois respondeu
  OUT_OF_SYNC: 'OUT_OF_SYNC',   // responderam diferente
  IN_SYNC: 'IN_SYNC'            // responderam igual: pontua
};

/**
 * Apura uma rodada.
 * @param {object} round   { startedAt, responses: { participantId: { answer, answeredAt } } }
 * @param {object} couples { coupleId: { coupleName, participant1, participant2, score, wins, totalResponseTime } }
 * @returns {{ results: object, coupleTotals: object, summary: object }}
 */
export function computeRoundResults(round, couples) {
  const responses = round?.responses || {};
  const startedAt = Number(round?.startedAt || 0);

  const results = {};
  const inSync = [];

  Object.entries(couples || {}).forEach(([coupleId, couple]) => {
    const p1 = couple?.participant1 || {};
    const p2 = couple?.participant2 || {};
    const r1 = responses[p1.id];
    const r2 = responses[p2.id];

    const base = {
      coupleId,
      coupleName: couple?.coupleName || '',
      answer1: r1?.answer || null,
      answer2: r2?.answer || null,
      synchronized: false,
      responseTime: null,
      points: 0,
      position: null,
      status: ROUND_STATUS.INCOMPLETE
    };

    // Regra: só é avaliado quando os DOIS responderam.
    if (!r1 || !r2) {
      results[coupleId] = base;
      return;
    }

    // Regra central: a resposta do casal é correta quando as duas são iguais.
    if (r1.answer !== r2.answer) {
      results[coupleId] = { ...base, status: ROUND_STATUS.OUT_OF_SYNC };
      return;
    }

    // Tempo oficial: momento da SEGUNDA resposta menos o início da pergunta.
    const coupleFinishedAt = Math.max(Number(r1.answeredAt), Number(r2.answeredAt));
    const responseTime = Math.max(0, coupleFinishedAt - startedAt);

    const entry = {
      ...base,
      synchronized: true,
      responseTime,
      finishedAt: coupleFinishedAt,
      status: ROUND_STATUS.IN_SYNC
    };
    results[coupleId] = entry;
    inSync.push(entry);
  });

  // Classificação apenas entre os casais em sintonia, do mais rápido ao mais lento.
  inSync.sort((a, b) => {
    if (a.responseTime !== b.responseTime) return a.responseTime - b.responseTime;
    if (a.finishedAt !== b.finishedAt) return a.finishedAt - b.finishedAt;
    return a.coupleId.localeCompare(b.coupleId);
  });

  inSync.forEach((entry, index) => {
    entry.position = index;
    entry.points = Math.max(100 - index, 1); // 1º = 100, 2º = 99, ... nunca abaixo de 1
    results[entry.coupleId] = entry;
  });

  // Totais acumulados de cada casal.
  const coupleTotals = {};
  Object.entries(couples || {}).forEach(([coupleId, couple]) => {
    const r = results[coupleId];
    coupleTotals[coupleId] = {
      score: Number(couple?.score || 0) + (r?.points || 0),
      wins: Number(couple?.wins || 0) + (r?.position === 0 ? 1 : 0),
      totalResponseTime: Number(couple?.totalResponseTime || 0) + (r?.responseTime || 0)
    };
  });

  const summary = {
    totalCouples: Object.keys(couples || {}).length,
    syncedCouples: inSync.length,
    answeredCouples: Object.values(results).filter((r) => r.status !== ROUND_STATUS.INCOMPLETE).length,
    top: inSync.slice(0, 3).map((r) => ({
      coupleId: r.coupleId,
      coupleName: r.coupleName,
      points: r.points,
      responseTime: r.responseTime
    }))
  };

  return { results, coupleTotals, summary };
}

/**
 * Ordena o ranking geral.
 * Critérios: pontos, vitórias na rodada, tempo acumulado, nome.
 */
export function rankCouples(couples) {
  return Object.entries(couples || {})
    .map(([coupleId, couple]) => ({
      coupleId,
      coupleName: couple?.coupleName || '',
      score: Number(couple?.score || 0),
      wins: Number(couple?.wins || 0),
      totalResponseTime: Number(couple?.totalResponseTime || 0)
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (a.totalResponseTime !== b.totalResponseTime) return a.totalResponseTime - b.totalResponseTime;
      return a.coupleName.localeCompare(b.coupleName, 'pt-BR');
    });
}
