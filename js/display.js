import {
  ensureAnonymousAuth,
  watchGame,
  watchQuestions,
  watchCouples,
  watchRoundProgress,
  watchRoundSummary,
  watchConnection,
  serverNow
} from './firebase-service.js';
import { GAME_STATUS, countFinishedCouples } from './game.js';
import { createDisplayRanking, rankCouples } from './ranking.js';
import { $, escapeHtml, formatPoints, formatSeconds, confetti, connectionBar, sleep, show } from './utils.js';

const state = {
  game: null,
  questions: {},
  couples: {},
  progress: {},
  summary: null,
  watchedRound: null,
  resultsScheduledFor: null,
  screen: null,
  rankPage: 0,
  lastLeaderId: null,
  finalPlayed: false
};

const roundSubs = [];
let resultsTimeout = null;
let rankRotation = null;

const displayRanking = createDisplayRanking($('#d-rank-grid'));

const states = {
  waiting: $('#d-waiting'),
  question: $('#d-question'),
  results: $('#d-results'),
  ranking: $('#d-ranking'),
  final: $('#d-final')
};

function showState(key) {
  if (state.screen === key) return;
  state.screen = key;
  Object.entries(states).forEach(([name, node]) => node.classList.toggle('active', name === key));

  clearTimeout(resultsTimeout);
  clearInterval(rankRotation);

  if (key === 'ranking') startRankRotation();
}

/* ---------------------------------------------------------
   Estado 1 — aguardando
   --------------------------------------------------------- */
function renderWaiting() {
  const couples = Object.values(state.couples);
  $('#d-couple-count').textContent = couples.length;
  $('#d-couple-chips').innerHTML = couples
    .map((couple) => `<span class="couple-chip">${escapeHtml(couple.coupleName)}</span>`)
    .join('');
}

/* ---------------------------------------------------------
   Estado 2 — pergunta
   --------------------------------------------------------- */
function renderQuestion() {
  const question = state.questions?.[state.game?.currentQuestionId];
  $('#d-qnum').textContent = `Pergunta ${String(state.game?.questionNumber || 1).padStart(2, '0')}`;
  $('#d-question-text').textContent = question?.text || '—';
  $('#d-option-a').textContent = question?.optionA || 'ELE';
  $('#d-option-b').textContent = question?.optionB || 'ELA';

  const total = Object.keys(state.couples).length;
  const finished = countFinishedCouples(state.progress);
  $('#d-progress-label').textContent = `${finished} de ${total} ${total === 1 ? 'casal finalizou' : 'casais finalizaram'}`;
  $('#d-progress-fill').style.width = total ? `${(finished / total) * 100}%` : '0%';
}

function clockLoop() {
  const game = state.game;
  const clock = $('#d-clock');

  if (game?.status === GAME_STATUS.QUESTION_ACTIVE && game.questionStartedAt) {
    const limitMs = (game.timeLimit || 20) * 1000;
    const remaining = Math.max(0, limitMs - (serverNow() - game.questionStartedAt));
    const seconds = Math.ceil(remaining / 1000);
    clock.textContent = seconds;
    clock.classList.toggle('warn', seconds <= 10 && seconds > 5);
    clock.classList.toggle('danger', seconds <= 5);
  } else if (game?.status === GAME_STATUS.QUESTION_LOCKED) {
    clock.textContent = '0';
    clock.classList.add('danger');
  }

  requestAnimationFrame(clockLoop);
}

/* ---------------------------------------------------------
   Estado 3 — resultado da rodada
   --------------------------------------------------------- */
function renderResults() {
  const summary = state.summary;
  const synced = summary?.syncedCouples ?? 0;

  $('#d-sync-count').textContent = `❤️ ${synced} ${synced === 1 ? 'casal em sintonia' : 'casais em sintonia'}`;

  const medals = ['🥇', '🥈', '🥉'];
  const podium = summary?.top || [];

  $('#d-podium').innerHTML = podium.length
    ? podium
        .map(
          (entry, index) => `
            <div class="podium-row p${index + 1}" style="animation-delay:${index * 0.5}s">
              <span class="podium-medal">${medals[index]}</span>
              <span>${escapeHtml(entry.coupleName)}<div class="podium-time">${formatSeconds(entry.responseTime)}</div></span>
              <span class="podium-points">+${entry.points}</span>
            </div>`
        )
        .join('')
    : '<div class="empty">Nenhum casal em sintonia nesta pergunta.</div>';

  // Depois do pódio, o ranking geral entra sozinho (agendado uma vez por rodada).
  if (state.resultsScheduledFor !== state.watchedRound) {
    state.resultsScheduledFor = state.watchedRound;
    clearTimeout(resultsTimeout);
    resultsTimeout = setTimeout(() => showState('ranking'), 7000 + podium.length * 500);
  }
}

/* ---------------------------------------------------------
   Estado 4 — ranking
   --------------------------------------------------------- */
function startRankRotation() {
  clearInterval(rankRotation);
  rankRotation = setInterval(() => {
    const perPage = 10;
    const pages = Math.max(1, Math.ceil(Object.keys(state.couples).length / perPage));
    state.rankPage = (state.rankPage + 1) % pages;
    renderRanking();
  }, 8000);
}

function renderRanking() {
  const perPage = 10;
  const ranking = displayRanking.render(state.couples, { page: state.rankPage, perPage });
  const pages = Math.max(1, Math.ceil(ranking.length / perPage));

  $('#d-rank-note').textContent = pages > 1 ? `Página ${state.rankPage + 1} de ${pages}` : '';

  const leader = ranking[0];
  const flash = $('#d-leader-flash');
  if (leader && state.lastLeaderId && leader.coupleId !== state.lastLeaderId) {
    flash.textContent = `🔥 Nova liderança! ${leader.coupleName}`;
    show(flash, true);
    setTimeout(() => show(flash, false), 5200);
  }
  if (leader) state.lastLeaderId = leader.coupleId;
}

/* ---------------------------------------------------------
   Estado 5 — final com suspense
   --------------------------------------------------------- */
async function playFinal() {
  if (state.finalPlayed) return;
  state.finalPlayed = true;

  const ranking = rankCouples(state.couples);
  const labels = [
    { label: 'Terceiro lugar', emoji: '🥉', index: 2 },
    { label: 'Segundo lugar', emoji: '🥈', index: 1 },
    { label: 'Campeões da noite', emoji: '👑', index: 0 }
  ];

  for (const item of labels) {
    const couple = ranking[item.index];
    if (!couple) continue;

    $('#d-final-emoji').textContent = item.emoji;
    $('#d-final-label').textContent = item.label;
    $('#d-final-name').textContent = '…';
    $('#d-final-points').textContent = '';
    await sleep(2200);

    $('#d-final-name').textContent = couple.coupleName;
    $('#d-final-points').textContent = `🏆 ${formatPoints(couple.score)} pontos`;

    if (item.index === 0) confetti(9000);
    await sleep(item.index === 0 ? 1000 : 4200);
  }
}

/* ---------------------------------------------------------
   Máquina de estados
   --------------------------------------------------------- */
function render() {
  const game = state.game;
  if (!game) return;

  $('#d-status').textContent =
    {
      WAITING: 'Entrada aberta',
      READY: 'Tudo pronto',
      QUESTION_ACTIVE: 'Pergunta no ar',
      QUESTION_LOCKED: 'Tempo encerrado',
      RESULTS: 'Resultado',
      FINAL: 'Fim de jogo'
    }[game.status] || game.status;

  switch (game.status) {
    case GAME_STATUS.QUESTION_ACTIVE:
    case GAME_STATUS.QUESTION_LOCKED:
      showState('question');
      renderQuestion();
      break;

    case GAME_STATUS.RESULTS:
      if (game.showRanking) {
        showState('ranking');
        renderRanking();
      } else {
        showState('results');
        renderResults();
      }
      break;

    case GAME_STATUS.FINAL:
      showState('final');
      playFinal();
      break;

    default:
      state.finalPlayed = false;
      if (game.showRanking) {
        showState('ranking');
        renderRanking();
      } else {
        showState('waiting');
        renderWaiting();
      }
  }
}

/* ---------------------------------------------------------
   Assinaturas de rodada
   --------------------------------------------------------- */
function subscribeRound(roundId) {
  while (roundSubs.length) roundSubs.pop()();
  state.progress = {};
  state.summary = null;
  if (!roundId) return;

  roundSubs.push(
    watchRoundProgress(roundId, (progress) => {
      state.progress = progress;
      if (state.screen === 'question') renderQuestion();
    }),
    watchRoundSummary(roundId, (summary) => {
      state.summary = summary;
      if (state.screen === 'results') renderResults();
    })
  );
}

/* ---------------------------------------------------------
   Início
   --------------------------------------------------------- */
async function boot() {
  await ensureAnonymousAuth();
  watchConnection(connectionBar);

  watchGame((game) => {
    state.game = game;
    const round = game.status === GAME_STATUS.RESULTS ? game.lastRoundId || game.currentRoundId : game.currentRoundId;
    if (round !== state.watchedRound) {
      state.watchedRound = round;
      subscribeRound(round);
    }
    render();
  });

  watchQuestions((questions) => {
    state.questions = questions;
    if (state.screen === 'question') renderQuestion();
  });

  watchCouples((couples) => {
    state.couples = couples;
    if (state.screen === 'waiting') renderWaiting();
    if (state.screen === 'question') renderQuestion();
    if (state.screen === 'ranking') renderRanking();
  });

  requestAnimationFrame(clockLoop);
}

boot();
