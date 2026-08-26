import {
  ensureAnonymousAuth,
  watchGame,
  watchQuestions,
  watchCouples,
  watchRoundProgress,
  watchRoundSummary,
  watchConnection,
  orderedQuestions,
  serverNow
} from './firebase-service.js';
import { GAME_STATUS, countFinishedCouples } from './game.js';
import { createDisplayRanking, rankCouples } from './ranking.js';
import { $, escapeHtml, formatPoints, formatSeconds, confetti, connectionBar, sleep, show, objectToList } from './utils.js';

const state = {
  game: null,
  questions: {},
  couples: {},
  progress: {},
  summary: null,
  watchedRound: null,
  resultsScheduledFor: null,
  rankingHold: false,
  waitingMode: null,
  knownCouples: new Set(),
  leavingNames: false,
  qrDrawn: false,
  screen: null,
  rankPage: 0,
  lastLeaderId: null,
  finalPlayed: false
};

const roundSubs = [];
let resultsTimeout = null;
let rankRotation = null;
let rankHoldTimeout = null;

const displayRanking = createDisplayRanking($('#d-rank-grid'));

const states = {
  waiting: $('#d-waiting'),
  question: $('#d-question'),
  results: $('#d-results'),
  ranking: $('#d-ranking'),
  endgame: $('#d-endgame'),
  final: $('#d-final'),
  finalBoard: $('#d-final-board')
};

function showState(key) {
  if (state.screen === key) return;
  state.screen = key;
  Object.entries(states).forEach(([name, node]) => node.classList.toggle('active', name === key));

  if (key !== 'waiting') show($('#d-topbar'), true);

  clearTimeout(resultsTimeout);
  clearInterval(rankRotation);

  if (key === 'ranking') {
    enterRanking();
    startRankRotation();
  }
}

/**
 * Ao entrar no ranking, o placar antigo fica visível por 1 segundo e só
 * então recebe os novos pontos — é assim que dá para ver quem subiu e quem caiu.
 */
function enterRanking() {
  clearTimeout(rankHoldTimeout);

  const grid = $('#d-rank-grid');
  if (!grid.children.length) {
    state.rankingHold = false;
    renderRanking(true);
    return;
  }

  state.rankingHold = true;
  rankHoldTimeout = setTimeout(() => {
    state.rankingHold = false;
    renderRanking(true);
  }, 1000);
}

/* ---------------------------------------------------------
   Estado 1 — aguardando
   --------------------------------------------------------- */
/**
 * A tela de espera tem quatro momentos:
 * idle   — o organizador ainda não abriu a entrada
 * join   — QR Code no telão e os casais chegando
 * roster — jogo iniciado: os nomes em festa
 * next   — entre uma pergunta e outra
 */
function waitingMode() {
  const game = state.game;
  if (!game || game.status === GAME_STATUS.IDLE) return 'idle';
  if (game.questionNumber || game.lastRoundId) return 'next';
  if (game.status === GAME_STATUS.READY) return 'roster';
  return 'join';
}

function renderWaiting() {
  const mode = waitingMode();
  const trocou = mode !== state.waitingMode;
  state.waitingMode = mode;
  $('#d-waiting').dataset.mode = mode;
  show($('#d-topbar'), mode !== 'next');

  if (mode === 'next') {
    const proxima = Number(state.game?.questionNumber || 0) + 1;
    $('#d-next-number').textContent = `Pergunta ${String(proxima).padStart(2, '0')} a caminho`;
    return;
  }

  if (mode === 'idle') {
    limparChips();
    return;
  }

  if (mode === 'join') desenharQrCode();

  // Ao iniciar o jogo os nomes entram de novo, um a um, em festa.
  if (trocou && mode === 'roster') limparChips();

  const couples = objectToList(state.couples, 'coupleId');
  $('#d-couple-count').textContent = couples.length;
  renderChips(couples, mode === 'roster' && trocou);
}

function limparChips() {
  $('#d-couple-chips').innerHTML = '';
  state.knownCouples.clear();
}

/** Acrescenta só os casais novos, para não repetir a animação dos antigos. */
function renderChips(couples, escalonar = false) {
  const box = $('#d-couple-chips');
  const atuais = new Set();

  couples.forEach((couple, index) => {
    atuais.add(couple.coupleId);
    if (state.knownCouples.has(couple.coupleId)) return;

    const chip = document.createElement('span');
    chip.className = 'couple-chip is-new';
    chip.dataset.id = couple.coupleId;
    if (escalonar) chip.style.animationDelay = `${Math.min(index * 0.16, 3.2)}s`;
    chip.innerHTML = `<span class="chip-heart">❤</span>${escapeHtml(couple.coupleName)}`;
    box.appendChild(chip);
    state.knownCouples.add(couple.coupleId);
  });

  Array.from(box.children).forEach((chip) => {
    if (!atuais.has(chip.dataset.id)) {
      state.knownCouples.delete(chip.dataset.id);
      chip.remove();
    }
  });
}

function desenharQrCode() {
  if (state.qrDrawn) return;

  const url = new URL('index.html', window.location.href).href;
  $('#d-qr-url').textContent = url.replace(/^https?:\/\//, '');

  if (typeof QRCode === 'undefined') return; // sem a biblioteca, fica só o endereço

  state.qrDrawn = true;
  const box = $('#d-qr');
  box.innerHTML = '';
  new QRCode(box, {
    text: url,
    width: 320,
    height: 320,
    colorDark: '#1E0640',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });
}

/** Os nomes saem de cena antes de a pergunta aparecer. */
function entrarNaPergunta() {
  if (state.leavingNames) return;

  const saindoDoRoster = state.screen === 'waiting' && ['join', 'roster'].includes(state.waitingMode);

  if (saindoDoRoster && $('#d-couple-chips').children.length) {
    state.leavingNames = true;
    $('#d-waiting').classList.add('names-out');
    setTimeout(() => {
      $('#d-waiting').classList.remove('names-out');
      state.leavingNames = false;
      limparChips();
      showState('question');
      renderQuestion();
    }, 800);
    return;
  }

  showState('question');
  renderQuestion();
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

/** A rodada que acabou era a última pergunta ativa da lista? */
function ehUltimaPergunta() {
  const lista = orderedQuestions(state.questions);
  const atual = state.game?.currentQuestionId;
  return Boolean(lista.length && atual && lista[lista.length - 1].id === atual);
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
    renderRanking(true);
  }, 8000);
}

function renderRanking(force = false) {
  if (state.rankingHold && !force) return;

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
    await sleep(item.index === 0 ? 9600 : 4200);
  }

  // Confetes terminaram: entra o pódio com o ranking completo.
  showState('finalBoard');
  renderFinalBoard();
}

function renderFinalBoard() {
  const ranking = rankCouples(state.couples);
  const podio = ranking.slice(0, 3);
  const demais = ranking.slice(3);
  const medalhas = ['🥇', '🥈', '🥉'];

  // A ordem visual do pódio é 2º, 1º, 3º.
  const stage = $('#d-podium-stage');
  stage.innerHTML = [1, 0, 2]
    .filter((index) => podio[index])
    .map((index) => {
      const couple = podio[index];
      return `
        <div class="pod pod-${index + 1}">
          <div class="pod-medal">${medalhas[index]}</div>
          <div class="pod-name">${escapeHtml(couple.coupleName)}</div>
          <div class="pod-points">${formatPoints(couple.score)} pts</div>
          <div class="pod-block">${index + 1}º</div>
        </div>`;
    })
    .join('');

  const rest = $('#d-final-rest');
  rest.classList.toggle('two-col', demais.length > 6);
  rest.innerHTML = demais
    .map(
      (couple, index) => `
        <div class="rest-row">
          <span class="pos">${index + 4}º</span>
          <span class="name">${escapeHtml(couple.coupleName)}</span>
          <span class="pts">${formatPoints(couple.score)} pts</span>
        </div>`
    )
    .join('');
}

/* ---------------------------------------------------------
   Máquina de estados
   --------------------------------------------------------- */
function render() {
  const game = state.game;
  if (!game) return;

  $('#d-status').textContent =
    {
      IDLE: 'Aguardando o organizador',
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
      entrarNaPergunta();
      break;

    case GAME_STATUS.RESULTS:
      if (game.showRanking) {
        showState('ranking');
        renderRanking();
      } else if (ehUltimaPergunta()) {
        // Na última pergunta o pódio da rodada fica guardado: nada de
        // entregar o resultado antes da revelação final.
        showState('endgame');
      } else {
        showState('results');
        renderResults();
      }
      break;

    case GAME_STATUS.FINAL:
      // Depois da revelação a tela fica no pódio; não voltar para o suspense.
      if (state.screen === 'finalBoard') break;
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
    if (state.screen === 'waiting' && !state.leavingNames) renderWaiting();
    if (state.screen === 'question') renderQuestion();
    if (state.screen === 'ranking') renderRanking();
  });

  requestAnimationFrame(clockLoop);
}

boot();
