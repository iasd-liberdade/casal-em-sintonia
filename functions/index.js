/**
 * Casal em Sintonia — Cloud Functions (opcional, exige plano Blaze).
 * Ative com APP_CONFIG.useCloudFunctions = true em js/firebase-config.js.
 *
 * Com as functions ativas, o navegador nunca escreve pontuação, resultado
 * ou timestamp: tudo é decidido aqui.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 10 });

const db = admin.database();
const TIMESTAMP = admin.database.ServerValue.TIMESTAMP;

/* ---------------------------------------------------------
   Ajudantes
   --------------------------------------------------------- */
function fail(appCode, message) {
  return new HttpsError('failed-precondition', message, { appCode });
}

function requireAuth(request) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Entre no jogo novamente.', { appCode: 'INVALID_SESSION' });
  return request.auth.uid;
}

async function requireAdmin(request) {
  const uid = requireAuth(request);
  const snap = await db.ref(`admins/${uid}`).get();
  if (snap.val() !== true) throw new HttpsError('permission-denied', 'Sem permissão.', { appCode: 'NOT_ADMIN' });
  return uid;
}

async function readGame() {
  const snap = await db.ref('game').get();
  return snap.val() || { status: 'WAITING', timeLimit: 20 };
}

function orderedQuestions(questions, onlyActive = true) {
  return Object.entries(questions || {})
    .map(([id, question]) => ({ id, ...question }))
    .filter((question) => (onlyActive ? question.active !== false : true))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

/* ---------------------------------------------------------
   Apuração (mesma lógica de js/scoring.js)
   --------------------------------------------------------- */
function computeRoundResults(round, couples) {
  const responses = round?.responses || {};
  const startedAt = Number(round?.startedAt || 0);
  const results = {};
  const inSync = [];

  Object.entries(couples || {}).forEach(([coupleId, couple]) => {
    const r1 = responses[couple?.participant1?.id];
    const r2 = responses[couple?.participant2?.id];

    const base = {
      coupleId,
      coupleName: couple?.coupleName || '',
      answer1: r1?.answer || null,
      answer2: r2?.answer || null,
      synchronized: false,
      responseTime: null,
      points: 0,
      position: null,
      status: 'INCOMPLETE'
    };

    if (!r1 || !r2) {
      results[coupleId] = base;
      return;
    }
    if (r1.answer !== r2.answer) {
      results[coupleId] = { ...base, status: 'OUT_OF_SYNC' };
      return;
    }

    const finishedAt = Math.max(Number(r1.answeredAt), Number(r2.answeredAt));
    const entry = {
      ...base,
      synchronized: true,
      responseTime: Math.max(0, finishedAt - startedAt),
      finishedAt,
      status: 'IN_SYNC'
    };
    results[coupleId] = entry;
    inSync.push(entry);
  });

  inSync.sort((a, b) => {
    if (a.responseTime !== b.responseTime) return a.responseTime - b.responseTime;
    if (a.finishedAt !== b.finishedAt) return a.finishedAt - b.finishedAt;
    return a.coupleId.localeCompare(b.coupleId);
  });

  inSync.forEach((entry, index) => {
    entry.position = index;
    entry.points = Math.max(100 - index, 1);
    results[entry.coupleId] = entry;
  });

  const coupleTotals = {};
  Object.entries(couples || {}).forEach(([coupleId, couple]) => {
    const result = results[coupleId];
    coupleTotals[coupleId] = {
      score: Number(couple?.score || 0) + (result?.points || 0),
      wins: Number(couple?.wins || 0) + (result?.position === 0 ? 1 : 0),
      totalResponseTime: Number(couple?.totalResponseTime || 0) + (result?.responseTime || 0)
    };
  });

  return {
    results,
    coupleTotals,
    summary: {
      totalCouples: Object.keys(couples || {}).length,
      syncedCouples: inSync.length,
      answeredCouples: Object.values(results).filter((r) => r.status !== 'INCOMPLETE').length,
      top: inSync.slice(0, 3).map((r) => ({
        coupleId: r.coupleId,
        coupleName: r.coupleName,
        points: r.points,
        responseTime: r.responseTime
      }))
    }
  };
}

/* ---------------------------------------------------------
   Participantes
   --------------------------------------------------------- */
exports.joinGame = onCall(async (request) => {
  const uid = requireAuth(request);
  const name = String(request.data?.name || '').trim().slice(0, 40);
  if (!name) throw fail('NAME_REQUIRED', 'Digite seu nome.');

  const participantRef = db.ref(`participants/${uid}`);
  const existing = await participantRef.get();

  if (existing.exists()) {
    return { participantId: uid, name: existing.val().name };
  }

  const game = await readGame();
  if (game.status !== 'WAITING' && game.allowLateJoin !== true) {
    throw fail('GAME_STARTED', 'O jogo já começou.');
  }

  await participantRef.set({ name, status: 'AVAILABLE', createdAt: TIMESTAMP });
  return { participantId: uid, name };
});

exports.choosePartner = onCall(async (request) => {
  const uid = requireAuth(request);
  const partnerId = String(request.data?.partnerId || '');
  if (!partnerId || partnerId === uid) throw fail('PARTNER_TAKEN', 'Escolha inválida.');

  const meSnap = await db.ref(`participants/${uid}`).get();
  const me = meSnap.val();
  if (!me) throw fail('INVALID_SESSION', 'Entre novamente.');
  if (me.coupleId) throw fail('ALREADY_PAIRED', 'Você já está em um casal.');

  const coupleId = db.ref('couples').push().key;

  // Reserva atômica do parceiro.
  const partnerTx = await db.ref(`participants/${partnerId}`).transaction((current) => {
    if (!current) return;
    if (current.status !== 'AVAILABLE' || current.coupleId) return;
    return { ...current, status: 'PAIRED', coupleId };
  });
  if (!partnerTx.committed) throw fail('PARTNER_TAKEN', 'Esta pessoa acabou de ser escolhida.');

  // Reserva atômica de quem escolheu.
  const selfTx = await db.ref(`participants/${uid}`).transaction((current) => {
    if (!current) return;
    if (current.status !== 'AVAILABLE' || current.coupleId) return;
    return { ...current, status: 'PAIRED', coupleId };
  });

  if (!selfTx.committed) {
    await db.ref(`participants/${partnerId}`).transaction((current) => {
      if (!current || current.coupleId !== coupleId) return current;
      const restored = { ...current, status: 'AVAILABLE' };
      delete restored.coupleId;
      return restored;
    });
    throw fail('ALREADY_PAIRED', 'Você já está em um casal.');
  }

  const partner = partnerTx.snapshot.val();

  await db.ref(`couples/${coupleId}`).set({
    coupleName: `${me.name} & ${partner.name}`,
    participant1: { id: uid, name: me.name },
    participant2: { id: partnerId, name: partner.name },
    memberIds: { [uid]: true, [partnerId]: true },
    score: 0,
    wins: 0,
    totalResponseTime: 0,
    createdAt: TIMESTAMP
  });

  return { coupleId };
});

exports.submitAnswer = onCall(async (request) => {
  const uid = requireAuth(request);
  const answer = request.data?.answer;
  if (answer !== 'A' && answer !== 'B') throw fail('ROUND_CLOSED', 'Resposta inválida.');

  const game = await readGame();
  if (game.status !== 'QUESTION_ACTIVE' || !game.currentRoundId) throw fail('ROUND_CLOSED', 'A rodada está fechada.');

  const me = (await db.ref(`participants/${uid}`).get()).val();
  if (!me) throw fail('INVALID_SESSION', 'Entre novamente.');
  if (!me.coupleId) throw fail('NO_COUPLE', 'Forme um casal antes de responder.');

  // Tempo limite conferido no servidor.
  const limitMs = Number(game.timeLimit || 20) * 1000;
  const startedAt = Number(game.questionStartedAt || 0);
  const offsetSnap = await db.ref('.info/serverTimeOffset').get();
  const serverNow = Date.now() + (offsetSnap.val() || 0);
  if (startedAt && serverNow - startedAt > limitMs + 500) throw fail('ROUND_CLOSED', 'O tempo terminou.');

  const responseRef = db.ref(`rounds/${game.currentRoundId}/responses/${uid}`);
  const tx = await responseRef.transaction((current) => {
    if (current) return; // já respondeu: aborta
    return { answer, coupleId: me.coupleId, questionId: game.currentQuestionId, answeredAt: TIMESTAMP };
  });
  if (!tx.committed) throw fail('ALREADY_ANSWERED', 'Sua resposta já foi registrada.');

  await db.ref(`rounds/${game.currentRoundId}/progress/${me.coupleId}/${uid}`).set(true);
  return { ok: true };
});

/* ---------------------------------------------------------
   Ações administrativas
   --------------------------------------------------------- */
const actions = {
  async startGame() {
    const questions = orderedQuestions((await db.ref('questions').get()).val());
    if (!questions.length) throw fail('NO_QUESTIONS', 'Cadastre ao menos uma pergunta ativa.');
    await db.ref('game').update({
      status: 'READY',
      currentQuestionId: questions[0].id,
      currentRoundId: null,
      questionStartedAt: null,
      questionNumber: 0,
      showRanking: false,
      updatedAt: TIMESTAMP
    });
  },

  async startQuestion() {
    const game = await readGame();
    const questions = orderedQuestions((await db.ref('questions').get()).val());
    if (!questions.length) throw fail('NO_QUESTIONS', 'Cadastre ao menos uma pergunta ativa.');

    const questionId = questions.some((q) => q.id === game.currentQuestionId) ? game.currentQuestionId : questions[0].id;
    const questionNumber = questions.findIndex((q) => q.id === questionId) + 1;
    const timeLimit = Number(game.timeLimit || 20);

    const roundRef = db.ref('rounds').push();
    await roundRef.set({ questionId, questionNumber, timeLimit, status: 'ACTIVE', startedAt: TIMESTAMP });
    const startedAt = (await roundRef.child('startedAt').get()).val();

    await db.ref('game').update({
      status: 'QUESTION_ACTIVE',
      currentQuestionId: questionId,
      currentRoundId: roundRef.key,
      questionStartedAt: startedAt,
      questionNumber,
      timeLimit,
      showRanking: false,
      updatedAt: TIMESTAMP
    });

    return { roundId: roundRef.key };
  },

  async lockQuestion() {
    const game = await readGame();
    if (game.status !== 'QUESTION_ACTIVE') return {};
    await db.ref('game').update({ status: 'QUESTION_LOCKED', updatedAt: TIMESTAMP });
    if (game.currentRoundId) await db.ref(`rounds/${game.currentRoundId}`).update({ status: 'LOCKED' });
    return {};
  },

  async endQuestion() {
    const game = await readGame();
    const roundId = game.currentRoundId;
    if (!roundId) throw fail('ROUND_CLOSED', 'Nenhuma pergunta em andamento.');

    await db.ref('game').update({ status: 'QUESTION_LOCKED', updatedAt: TIMESTAMP });
    await db.ref(`rounds/${roundId}`).update({ status: 'LOCKED', endedAt: TIMESTAMP });

    const [roundSnap, couplesSnap] = await Promise.all([db.ref(`rounds/${roundId}`).get(), db.ref('couples').get()]);
    const { results, coupleTotals, summary } = computeRoundResults(roundSnap.val() || {}, couplesSnap.val() || {});

    const updates = {};
    Object.entries(results).forEach(([coupleId, result]) => {
      updates[`rounds/${roundId}/results/${coupleId}`] = result;
    });
    Object.entries(coupleTotals).forEach(([coupleId, totals]) => {
      updates[`couples/${coupleId}/score`] = totals.score;
      updates[`couples/${coupleId}/wins`] = totals.wins;
      updates[`couples/${coupleId}/totalResponseTime`] = totals.totalResponseTime;
    });
    updates[`rounds/${roundId}/summary`] = summary;
    updates[`rounds/${roundId}/status`] = 'CLOSED';
    updates['game/status'] = 'RESULTS';
    updates['game/lastRoundId'] = roundId;
    updates['game/showRanking'] = false;
    updates['game/updatedAt'] = TIMESTAMP;

    await db.ref().update(updates);
    return summary;
  },

  async nextQuestion() {
    const game = await readGame();
    const questions = orderedQuestions((await db.ref('questions').get()).val());
    const index = questions.findIndex((q) => q.id === game.currentQuestionId);
    const next = questions[index + 1];

    if (!next) {
      await db.ref('game').update({ status: 'FINAL', showRanking: true, updatedAt: TIMESTAMP });
      return { questionId: null };
    }

    await db.ref('game').update({
      status: 'READY',
      currentQuestionId: next.id,
      currentRoundId: null,
      questionStartedAt: null,
      showRanking: false,
      updatedAt: TIMESTAMP
    });
    return { questionId: next.id };
  },

  async showRanking({ value = true }) {
    await db.ref('game').update({ showRanking: value, updatedAt: TIMESTAMP });
    return {};
  },

  async finishGame() {
    await db.ref('game').update({ status: 'FINAL', showRanking: true, updatedAt: TIMESTAMP });
    return {};
  },

  async resetGame({ keepCouples = true }) {
    await db.ref('rounds').remove();

    if (keepCouples) {
      const couples = (await db.ref('couples').get()).val() || {};
      const updates = {};
      Object.keys(couples).forEach((coupleId) => {
        updates[`couples/${coupleId}/score`] = 0;
        updates[`couples/${coupleId}/wins`] = 0;
        updates[`couples/${coupleId}/totalResponseTime`] = 0;
      });
      if (Object.keys(updates).length) await db.ref().update(updates);
    } else {
      await db.ref('couples').remove();
      await db.ref('participants').remove();
    }

    const game = await readGame();
    await db.ref('game').set({
      status: 'WAITING',
      currentQuestionId: null,
      currentRoundId: null,
      lastRoundId: null,
      questionStartedAt: null,
      questionNumber: 0,
      timeLimit: game.timeLimit || 20,
      allowLateJoin: false,
      showRanking: false,
      updatedAt: TIMESTAMP
    });
    // O banco de perguntas nunca é apagado aqui.
    return {};
  },

  async updateSettings(payload) {
    const allowed = ['timeLimit', 'allowLateJoin', 'currentQuestionId', 'status', 'currentRoundId'];
    const patch = {};
    Object.entries(payload || {}).forEach(([key, value]) => {
      if (allowed.includes(key)) patch[key] = value;
    });
    if (Object.keys(patch).length) await db.ref('game').update({ ...patch, updatedAt: TIMESTAMP });
    return {};
  },

  async saveQuestion(payload) {
    const { id, text, optionA, optionB, active = true, order } = payload || {};
    if (!text || !optionA || !optionB) throw fail('INVALID_QUESTION', 'Preencha a pergunta e as duas opções.');

    if (id) {
      await db.ref(`questions/${id}`).update({ text, optionA, optionB, active, ...(order ? { order } : {}) });
      return { id };
    }

    const questions = (await db.ref('questions').get()).val() || {};
    const maxOrder = Object.values(questions).reduce((max, q) => Math.max(max, q.order || 0), 0);
    const newRef = db.ref('questions').push();
    await newRef.set({ text, optionA, optionB, active, order: order || maxOrder + 1 });
    return { id: newRef.key };
  },

  async deleteQuestion({ id }) {
    await db.ref(`questions/${id}`).remove();
    return {};
  },

  async duplicateQuestion({ id }) {
    const source = (await db.ref(`questions/${id}`).get()).val();
    if (!source) return {};
    const questions = (await db.ref('questions').get()).val() || {};
    const maxOrder = Object.values(questions).reduce((max, q) => Math.max(max, q.order || 0), 0);
    const newRef = db.ref('questions').push();
    await newRef.set({ ...source, text: `${source.text} (cópia)`, order: maxOrder + 1 });
    return { id: newRef.key };
  },

  async toggleQuestion({ id, active }) {
    await db.ref(`questions/${id}`).update({ active });
    return {};
  },

  async moveQuestion({ id, direction }) {
    const questions = orderedQuestions((await db.ref('questions').get()).val(), false);
    const index = questions.findIndex((q) => q.id === id);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || swapWith < 0 || swapWith >= questions.length) return {};
    const a = questions[index];
    const b = questions[swapWith];
    await db.ref().update({
      [`questions/${a.id}/order`]: b.order || swapWith + 1,
      [`questions/${b.id}/order`]: a.order || index + 1
    });
    return {};
  },

  async seedQuestions({ list }) {
    const updates = {};
    (list || []).forEach((question, index) => {
      const newRef = db.ref('questions').push();
      updates[`questions/${newRef.key}`] = {
        text: question.text,
        optionA: question.optionA,
        optionB: question.optionB,
        order: index + 1,
        active: true
      };
    });
    if (Object.keys(updates).length) await db.ref().update(updates);
    return {};
  },

  async removeParticipant({ participantId }) {
    await db.ref(`participants/${participantId}`).remove();
    return {};
  },

  async removeCouple({ coupleId }) {
    const couple = (await db.ref(`couples/${coupleId}`).get()).val();
    if (!couple) return {};
    const updates = { [`couples/${coupleId}`]: null };
    [couple.participant1?.id, couple.participant2?.id].filter(Boolean).forEach((pid) => {
      updates[`participants/${pid}`] = null;
    });
    await db.ref().update(updates);
    return {};
  }
};

exports.adminAction = onCall(async (request) => {
  await requireAdmin(request);
  const action = actions[request.data?.action];
  if (!action) throw new HttpsError('invalid-argument', 'Ação desconhecida.');
  return (await action(request.data?.payload || {})) || {};
});
