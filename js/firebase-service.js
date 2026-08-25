/* =========================================================
   Camada única de acesso ao Firebase.
   Nenhuma outra parte do app fala direto com o banco.
   Funciona em dois modos (ver APP_CONFIG.useCloudFunctions).
   ========================================================= */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  getDatabase,
  ref,
  child,
  get,
  set,
  update,
  remove,
  push,
  onValue,
  runTransaction,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

import { firebaseConfig, APP_CONFIG } from './firebase-config.js';
import { computeRoundResults } from './scoring.js';
import { AppError } from './utils.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

const fns = APP_CONFIG.useCloudFunctions ? getFunctions(app, APP_CONFIG.functionsRegion) : null;

async function callFn(name, payload = {}) {
  try {
    const result = await httpsCallable(fns, name)(payload);
    return result.data;
  } catch (error) {
    const code = error?.details?.appCode;
    if (code) throw new AppError(code);
    throw error;
  }
}

/* ---------------------------------------------------------
   Autenticação
   --------------------------------------------------------- */
let authReady = null;

/** Garante uma sessão anônima estável (o uid vira o participantId). */
export function ensureAnonymousAuth() {
  if (!authReady) {
    authReady = new Promise((resolve, reject) => {
      onAuthStateChanged(
        auth,
        async (user) => {
          if (user) return resolve(user);
          try {
            const credential = await signInAnonymously(auth);
            resolve(credential.user);
          } catch (error) {
            reject(error);
          }
        },
        reject
      );
    });
  }
  return authReady;
}

export function onAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function adminSignIn(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const admin = await isAdmin(credential.user.uid);
  if (!admin) {
    await signOut(auth);
    throw new AppError('NOT_ADMIN');
  }
  return credential.user;
}

export async function isAdmin(uid) {
  if (!uid) return false;
  const snap = await get(ref(db, `admins/${uid}`));
  return snap.val() === true;
}

export function signOutUser() {
  authReady = null;
  return signOut(auth);
}

/* ---------------------------------------------------------
   Relógio do servidor
   --------------------------------------------------------- */
let serverOffset = 0;
onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
  serverOffset = snap.val() || 0;
});

/** Horário sincronizado com o servidor (usado só para exibir o cronômetro). */
export function serverNow() {
  return Date.now() + serverOffset;
}

export function watchConnection(callback) {
  return onValue(ref(db, '.info/connected'), (snap) => callback(snap.val() === true));
}

/* ---------------------------------------------------------
   Leituras em tempo real
   --------------------------------------------------------- */
const DEFAULT_GAME = {
  status: 'WAITING',
  currentQuestionId: null,
  currentRoundId: null,
  questionStartedAt: null,
  questionNumber: 0,
  timeLimit: APP_CONFIG.defaultTimeLimit,
  allowLateJoin: false,
  showRanking: false
};

export function watchGame(callback) {
  return onValue(ref(db, 'game'), (snap) => callback({ ...DEFAULT_GAME, ...(snap.val() || {}) }));
}

export function watchQuestions(callback) {
  return onValue(ref(db, 'questions'), (snap) => callback(snap.val() || {}));
}

export function watchCouples(callback) {
  return onValue(ref(db, 'couples'), (snap) => callback(snap.val() || {}));
}

export function watchParticipants(callback) {
  return onValue(ref(db, 'participants'), (snap) => callback(snap.val() || {}));
}

export function watchParticipant(participantId, callback) {
  return onValue(ref(db, `participants/${participantId}`), (snap) => callback(snap.val()));
}

export function watchCouple(coupleId, callback) {
  return onValue(ref(db, `couples/${coupleId}`), (snap) => callback(snap.val()));
}

export function watchMyAnswer(roundId, participantId, callback) {
  return onValue(ref(db, `rounds/${roundId}/responses/${participantId}`), (snap) => callback(snap.val()));
}

export function watchRoundProgress(roundId, callback) {
  return onValue(ref(db, `rounds/${roundId}/progress`), (snap) => callback(snap.val() || {}));
}

export function watchRoundResults(roundId, callback) {
  return onValue(ref(db, `rounds/${roundId}/results`), (snap) => callback(snap.val() || {}));
}

export function watchRoundSummary(roundId, callback) {
  return onValue(ref(db, `rounds/${roundId}/summary`), (snap) => callback(snap.val()));
}

export function watchRoundResponses(roundId, callback) {
  // Somente administradores conseguem ler este nó (ver database.rules.json).
  return onValue(ref(db, `rounds/${roundId}/responses`), (snap) => callback(snap.val() || {}));
}

export async function getGameOnce() {
  const snap = await get(ref(db, 'game'));
  return { ...DEFAULT_GAME, ...(snap.val() || {}) };
}

/* ---------------------------------------------------------
   Ações do participante
   --------------------------------------------------------- */
export async function joinGame(name) {
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) throw new AppError('NAME_REQUIRED');

  const user = await ensureAnonymousAuth();

  if (APP_CONFIG.useCloudFunctions) {
    const data = await callFn('joinGame', { name: clean });
    return { participantId: data.participantId, name: data.name };
  }

  const participantRef = ref(db, `participants/${user.uid}`);
  const existing = await get(participantRef);

  if (!existing.exists()) {
    const game = await getGameOnce();
    if (game.status !== 'WAITING' && !game.allowLateJoin) throw new AppError('GAME_STARTED');
    await set(participantRef, {
      name: clean,
      status: 'AVAILABLE',
      createdAt: serverTimestamp()
    });
  }

  return { participantId: user.uid, name: existing.exists() ? existing.val().name : clean };
}

export async function choosePartner(partnerId) {
  const user = await ensureAnonymousAuth();
  if (partnerId === user.uid) throw new AppError('PARTNER_TAKEN');

  if (APP_CONFIG.useCloudFunctions) {
    const data = await callFn('choosePartner', { partnerId });
    return data.coupleId;
  }

  const meSnap = await get(ref(db, `participants/${user.uid}`));
  const me = meSnap.val();
  if (!me) throw new AppError('INVALID_SESSION');
  if (me.coupleId) throw new AppError('ALREADY_PAIRED');

  const coupleId = push(ref(db, 'couples')).key;

  // 1) Reserva o parceiro de forma atômica: só passa se ele ainda estiver livre.
  const partnerClaim = await runTransaction(ref(db, `participants/${partnerId}`), (current) => {
    if (!current) return; // abortado
    if (current.status !== 'AVAILABLE' || current.coupleId) return; // abortado
    return { ...current, status: 'PAIRED', coupleId };
  });
  if (!partnerClaim.committed) throw new AppError('PARTNER_TAKEN');

  // 2) Reserva a si mesmo. Se falhar, devolve o parceiro para a lista.
  const selfClaim = await runTransaction(ref(db, `participants/${user.uid}`), (current) => {
    if (!current) return;
    if (current.status !== 'AVAILABLE' || current.coupleId) return;
    return { ...current, status: 'PAIRED', coupleId };
  });
  if (!selfClaim.committed) {
    await runTransaction(ref(db, `participants/${partnerId}`), (current) => {
      if (!current || current.coupleId !== coupleId) return current;
      const restored = { ...current, status: 'AVAILABLE' };
      delete restored.coupleId;
      return restored;
    });
    throw new AppError('ALREADY_PAIRED');
  }

  const partner = partnerClaim.snapshot.val();

  // 3) Cria o casal. O nome segue a ordem: quem escolheu & quem foi escolhido.
  await set(ref(db, `couples/${coupleId}`), {
    coupleName: `${me.name} & ${partner.name}`,
    participant1: { id: user.uid, name: me.name },
    participant2: { id: partnerId, name: partner.name },
    memberIds: { [user.uid]: true, [partnerId]: true },
    score: 0,
    wins: 0,
    totalResponseTime: 0,
    createdAt: serverTimestamp()
  });

  return coupleId;
}

export async function submitAnswer(answer) {
  const user = await ensureAnonymousAuth();
  if (answer !== 'A' && answer !== 'B') throw new AppError('ROUND_CLOSED');

  if (APP_CONFIG.useCloudFunctions) {
    await callFn('submitAnswer', { answer });
    return;
  }

  const game = await getGameOnce();
  if (game.status !== 'QUESTION_ACTIVE' || !game.currentRoundId) throw new AppError('ROUND_CLOSED');

  const meSnap = await get(ref(db, `participants/${user.uid}`));
  const me = meSnap.val();
  if (!me) throw new AppError('INVALID_SESSION');
  if (!me.coupleId) throw new AppError('NO_COUPLE');

  const responseRef = ref(db, `rounds/${game.currentRoundId}/responses/${user.uid}`);
  const already = await get(responseRef);
  if (already.exists()) throw new AppError('ALREADY_ANSWERED');

  // answeredAt é resolvido pelo servidor — o celular não define o tempo.
  await set(responseRef, {
    answer,
    coupleId: me.coupleId,
    questionId: game.currentQuestionId,
    answeredAt: serverTimestamp()
  });

  // Marcador público de progresso (não revela a resposta escolhida).
  // A resposta acima já está registrada; se este marcador falhar por causa do
  // tempo, a pontuação não é afetada.
  try {
    await set(ref(db, `rounds/${game.currentRoundId}/progress/${me.coupleId}/${user.uid}`), true);
  } catch {
    /* apenas o indicador visual de progresso deixa de aparecer */
  }
}

/* ---------------------------------------------------------
   Ações administrativas
   --------------------------------------------------------- */
function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([key, item]) => {
      if (item !== undefined) out[key] = stripUndefined(item);
    });
    return out;
  }
  return value;
}

async function adminCall(action, payload = {}) {
  return callFn('adminAction', { action, payload });
}

export function orderedQuestions(questions, onlyActive = true) {
  return Object.entries(questions || {})
    .map(([id, q]) => ({ id, ...q }))
    .filter((q) => (onlyActive ? q.active !== false : true))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

export const adminApi = {
  async ensureGame() {
    const snap = await get(ref(db, 'game'));
    if (!snap.exists()) {
      await set(ref(db, 'game'), { ...DEFAULT_GAME, updatedAt: serverTimestamp() });
    }
  },

  async startGame() {
    if (APP_CONFIG.useCloudFunctions) return adminCall('startGame');
    const questions = orderedQuestions((await get(ref(db, 'questions'))).val());
    if (!questions.length) throw new AppError('NO_QUESTIONS', 'Cadastre ao menos uma pergunta ativa.');
    await update(ref(db, 'game'), {
      status: 'READY',
      currentQuestionId: questions[0].id,
      currentRoundId: null,
      questionStartedAt: null,
      questionNumber: 0,
      showRanking: false,
      updatedAt: serverTimestamp()
    });
  },

  async startQuestion() {
    if (APP_CONFIG.useCloudFunctions) return adminCall('startQuestion');

    const game = await getGameOnce();
    const questions = orderedQuestions((await get(ref(db, 'questions'))).val());
    if (!questions.length) throw new AppError('NO_QUESTIONS', 'Cadastre ao menos uma pergunta ativa.');

    const questionId = game.currentQuestionId && questions.some((q) => q.id === game.currentQuestionId)
      ? game.currentQuestionId
      : questions[0].id;

    const questionNumber = questions.findIndex((q) => q.id === questionId) + 1;
    const timeLimit = Number(game.timeLimit || APP_CONFIG.defaultTimeLimit);

    const roundRef = push(ref(db, 'rounds'));
    await set(roundRef, {
      questionId,
      questionNumber,
      timeLimit,
      status: 'ACTIVE',
      startedAt: serverTimestamp()
    });

    // Lê o timestamp já resolvido pelo servidor e usa o MESMO valor no jogo.
    const startedAt = (await get(child(roundRef, 'startedAt'))).val();

    await update(ref(db, 'game'), {
      status: 'QUESTION_ACTIVE',
      currentQuestionId: questionId,
      currentRoundId: roundRef.key,
      questionStartedAt: startedAt,
      questionNumber,
      timeLimit,
      showRanking: false,
      updatedAt: serverTimestamp()
    });

    return roundRef.key;
  },

  async lockQuestion() {
    if (APP_CONFIG.useCloudFunctions) return adminCall('lockQuestion');
    const game = await getGameOnce();
    if (game.status !== 'QUESTION_ACTIVE') return;
    await update(ref(db, 'game'), { status: 'QUESTION_LOCKED', updatedAt: serverTimestamp() });
    if (game.currentRoundId) {
      await update(ref(db, `rounds/${game.currentRoundId}`), { status: 'LOCKED' });
    }
  },

  async endQuestion() {
    if (APP_CONFIG.useCloudFunctions) return adminCall('endQuestion');

    const game = await getGameOnce();
    const roundId = game.currentRoundId;
    if (!roundId) throw new AppError('ROUND_CLOSED', 'Nenhuma pergunta em andamento.');

    // 1) Trava novas respostas antes de apurar.
    await update(ref(db, 'game'), { status: 'QUESTION_LOCKED', updatedAt: serverTimestamp() });
    await update(ref(db, `rounds/${roundId}`), { status: 'LOCKED', endedAt: serverTimestamp() });

    // 2) Apura com os dados já gravados.
    const [roundSnap, couplesSnap] = await Promise.all([
      get(ref(db, `rounds/${roundId}`)),
      get(ref(db, 'couples'))
    ]);
    const { results, coupleTotals, summary } = computeRoundResults(roundSnap.val() || {}, couplesSnap.val() || {});

    // 3) Grava resultados, pontuação e estado em uma única atualização.
    const updates = {};
    Object.entries(results).forEach(([coupleId, result]) => {
      updates[`rounds/${roundId}/results/${coupleId}`] = stripUndefined(result);
    });
    Object.entries(coupleTotals).forEach(([coupleId, totals]) => {
      updates[`couples/${coupleId}/score`] = totals.score;
      updates[`couples/${coupleId}/wins`] = totals.wins;
      updates[`couples/${coupleId}/totalResponseTime`] = totals.totalResponseTime;
    });
    updates[`rounds/${roundId}/summary`] = stripUndefined(summary);
    updates[`rounds/${roundId}/status`] = 'CLOSED';
    updates['game/status'] = 'RESULTS';
    updates['game/lastRoundId'] = roundId;
    updates['game/showRanking'] = false;
    updates['game/updatedAt'] = serverTimestamp();

    await update(ref(db), updates);
    return summary;
  },

  async nextQuestion() {
    if (APP_CONFIG.useCloudFunctions) return adminCall('nextQuestion');
    const game = await getGameOnce();
    const questions = orderedQuestions((await get(ref(db, 'questions'))).val());
    const index = questions.findIndex((q) => q.id === game.currentQuestionId);
    const next = questions[index + 1];
    if (!next) {
      await update(ref(db, 'game'), { status: 'FINAL', showRanking: true, updatedAt: serverTimestamp() });
      return null;
    }
    await update(ref(db, 'game'), {
      status: 'READY',
      currentQuestionId: next.id,
      currentRoundId: null,
      questionStartedAt: null,
      showRanking: false,
      updatedAt: serverTimestamp()
    });
    return next.id;
  },

  async showRanking(value = true) {
    if (APP_CONFIG.useCloudFunctions) return adminCall('showRanking', { value });
    await update(ref(db, 'game'), { showRanking: value, updatedAt: serverTimestamp() });
  },

  async finishGame() {
    if (APP_CONFIG.useCloudFunctions) return adminCall('finishGame');
    await update(ref(db, 'game'), { status: 'FINAL', showRanking: true, updatedAt: serverTimestamp() });
  },

  async resetGame({ keepCouples = true } = {}) {
    if (APP_CONFIG.useCloudFunctions) return adminCall('resetGame', { keepCouples });

    await remove(ref(db, 'rounds'));

    if (keepCouples) {
      const couples = (await get(ref(db, 'couples'))).val() || {};
      const updates = {};
      Object.keys(couples).forEach((coupleId) => {
        updates[`couples/${coupleId}/score`] = 0;
        updates[`couples/${coupleId}/wins`] = 0;
        updates[`couples/${coupleId}/totalResponseTime`] = 0;
      });
      if (Object.keys(updates).length) await update(ref(db), updates);
    } else {
      // Apaga casal por casal e pessoa por pessoa: cada caminho é autorizado
      // individualmente pelas regras, sem depender de escrita no nó inteiro.
      const [couplesSnap, participantsSnap] = await Promise.all([
        get(ref(db, 'couples')),
        get(ref(db, 'participants'))
      ]);
      const updates = {};
      Object.keys(couplesSnap.val() || {}).forEach((coupleId) => {
        updates[`couples/${coupleId}`] = null;
      });
      Object.keys(participantsSnap.val() || {}).forEach((participantId) => {
        updates[`participants/${participantId}`] = null;
      });
      if (Object.keys(updates).length) await update(ref(db), updates);
    }

    const game = await getGameOnce();
    await set(ref(db, 'game'), {
      ...DEFAULT_GAME,
      timeLimit: game.timeLimit || APP_CONFIG.defaultTimeLimit,
      updatedAt: serverTimestamp()
    });
    // O banco de perguntas nunca é apagado aqui.
  },

  async updateSettings(patch) {
    if (APP_CONFIG.useCloudFunctions) return adminCall('updateSettings', patch);
    await update(ref(db, 'game'), { ...patch, updatedAt: serverTimestamp() });
  },

  async saveQuestion(question) {
    if (APP_CONFIG.useCloudFunctions) return adminCall('saveQuestion', question);
    const { id, ...data } = question;
    if (id) {
      await update(ref(db, `questions/${id}`), data);
      return id;
    }
    const questions = (await get(ref(db, 'questions'))).val() || {};
    const maxOrder = Object.values(questions).reduce((max, q) => Math.max(max, q.order || 0), 0);
    const newRef = push(ref(db, 'questions'));
    await set(newRef, { ...data, order: data.order || maxOrder + 1, active: data.active !== false });
    return newRef.key;
  },

  async deleteQuestion(id) {
    if (APP_CONFIG.useCloudFunctions) return adminCall('deleteQuestion', { id });
    await remove(ref(db, `questions/${id}`));
  },

  async duplicateQuestion(id) {
    if (APP_CONFIG.useCloudFunctions) return adminCall('duplicateQuestion', { id });
    const snap = await get(ref(db, `questions/${id}`));
    if (!snap.exists()) return null;
    const source = snap.val();
    const questions = (await get(ref(db, 'questions'))).val() || {};
    const maxOrder = Object.values(questions).reduce((max, q) => Math.max(max, q.order || 0), 0);
    const newRef = push(ref(db, 'questions'));
    await set(newRef, { ...source, text: `${source.text} (cópia)`, order: maxOrder + 1 });
    return newRef.key;
  },

  async toggleQuestion(id, active) {
    if (APP_CONFIG.useCloudFunctions) return adminCall('toggleQuestion', { id, active });
    await update(ref(db, `questions/${id}`), { active });
  },

  async moveQuestion(id, direction) {
    if (APP_CONFIG.useCloudFunctions) return adminCall('moveQuestion', { id, direction });
    const questions = orderedQuestions((await get(ref(db, 'questions'))).val(), false);
    const index = questions.findIndex((q) => q.id === id);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || swapWith < 0 || swapWith >= questions.length) return;
    const a = questions[index];
    const b = questions[swapWith];
    await update(ref(db), {
      [`questions/${a.id}/order`]: b.order || swapWith + 1,
      [`questions/${b.id}/order`]: a.order || index + 1
    });
  },

  async seedQuestions(list) {
    if (APP_CONFIG.useCloudFunctions) return adminCall('seedQuestions', { list });
    const updates = {};
    list.forEach((question, index) => {
      const newRef = push(ref(db, 'questions'));
      updates[`questions/${newRef.key}`] = {
        text: question.text,
        optionA: question.optionA,
        optionB: question.optionB,
        order: index + 1,
        active: true
      };
    });
    await update(ref(db), updates);
  },

  async removeParticipant(participantId) {
    if (APP_CONFIG.useCloudFunctions) return adminCall('removeParticipant', { participantId });
    await remove(ref(db, `participants/${participantId}`));
  },

  async removeCouple(coupleId) {
    if (APP_CONFIG.useCloudFunctions) return adminCall('removeCouple', { coupleId });
    const couple = (await get(ref(db, `couples/${coupleId}`))).val();
    if (!couple) return;
    const updates = { [`couples/${coupleId}`]: null };
    [couple.participant1?.id, couple.participant2?.id].filter(Boolean).forEach((pid) => {
      updates[`participants/${pid}`] = null;
    });
    await update(ref(db), updates);
  }
};
