import {
  ensureAnonymousAuth,
  joinGame,
  choosePartner,
  submitAnswer,
  watchGame,
  watchQuestions,
  watchParticipants,
  watchParticipant,
  watchCouple,
  watchCouples,
  watchMyAnswer,
  watchRoundProgress,
  watchRoundResults,
  watchConnection
} from './firebase-service.js';
import { createPartnerSelection } from './partner-selection.js';
import { createAnswerPanel } from './answer.js';
import { createTimer, GAME_STATUS, coupleProgressState } from './game.js';
import { renderRankingList, rankCouples } from './ranking.js';
import { ROUND_STATUS } from './scoring.js';
import { $, storage, toast, errorMessage, escapeHtml, formatPoints, connectionBar, confetti, show } from './utils.js';

/* ---------------------------------------------------------
   Estado local
   --------------------------------------------------------- */
const state = {
  participantId: null,
  participant: null,
  coupleId: null,
  couple: null,
  game: null,
  questions: {},
  couples: {},
  myAnswer: null,
  localAnswer: null,
  progress: {},
  results: {},
  roundId: null,
  watchedRound: null,
  gameLoaded: false,
  participantLoaded: false,
  celebratedRoundId: null,
  celebratedFinal: false
};

const roundSubscriptions = [];
let coupleUnsub = null;

/* ---------------------------------------------------------
   Telas
   --------------------------------------------------------- */
const screens = {
  loading: $('#screen-loading'),
  name: $('#screen-name'),
  partner: $('#screen-partner'),
  lobby: $('#screen-lobby'),
  blocked: $('#screen-blocked'),
  question: $('#screen-question'),
  result: $('#screen-result'),
  final: $('#screen-final')
};

let currentScreen = 'loading';

function showScreen(key) {
  if (currentScreen === key) return;
  currentScreen = key;
  Object.entries(screens).forEach(([name, node]) => node.classList.toggle('active', name === key));
}

/* ---------------------------------------------------------
   Componentes
   --------------------------------------------------------- */
const partnerSelection = createPartnerSelection({
  container: $('#partner-list'),
  onChoose: async (partnerId) => {
    try {
      const coupleId = await choosePartner(partnerId);
      storage.save({ coupleId });
      toast('Casal formado! ❤️', 'ok');
    } catch (error) {
      toast(errorMessage(error), 'error');
      throw error;
    }
  }
});

const answerPanel = createAnswerPanel({
  optionsEl: $('#options'),
  onAnswer: async (key) => {
    // Guarda a escolha na hora: a tela não volta a destravar enquanto o
    // registro do servidor não chega.
    state.localAnswer = key;
    try {
      await submitAnswer(key);
    } catch (error) {
      if (error?.code !== 'ALREADY_ANSWERED') state.localAnswer = null;
      toast(errorMessage(error), 'error');
      throw error;
    }
  }
});

const timer = createTimer({
  onTick: ({ remaining, ratio }) => {
    const fill = $('#timer-fill');
    fill.style.width = `${Math.max(0, ratio * 100)}%`;
    fill.classList.toggle('warn', ratio <= 0.5 && ratio > 0.2);
    fill.classList.toggle('danger', ratio <= 0.2);
    $('#timer-value').textContent = `${Math.ceil(remaining / 1000)}s`;
  },
  onExpire: () => {
    answerPanel.lock();
    $('#timer-label').textContent = 'Tempo encerrado';
  }
});

/* ---------------------------------------------------------
   Entrada
   --------------------------------------------------------- */
async function handleJoin() {
  const input = $('#input-name');
  const button = $('#btn-join');
  const name = input.value.trim();

  if (!name) {
    toast('Digite seu nome para entrar.', 'error');
    input.focus();
    return;
  }

  button.disabled = true;
  button.textContent = 'Entrando…';

  try {
    const result = await joinGame(name);
    storage.save({ participantId: result.participantId, participantName: result.name });
    toast('❤️ Você entrou!', 'ok');
  } catch (error) {
    toast(errorMessage(error), 'error');
    if (error?.code === 'GAME_STARTED') showScreen('blocked');
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar';
  }
}

$('#btn-join').addEventListener('click', handleJoin);
$('#input-name').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') handleJoin();
});

/* ---------------------------------------------------------
   Assinaturas por rodada
   --------------------------------------------------------- */
function clearRoundSubscriptions() {
  while (roundSubscriptions.length) roundSubscriptions.pop()();
  state.myAnswer = null;
  state.localAnswer = null;
  state.progress = {};
  state.results = {};
}

function subscribeRound(roundId) {
  clearRoundSubscriptions();
  if (!roundId) return;

  roundSubscriptions.push(
    watchMyAnswer(roundId, state.participantId, (answer) => {
      state.myAnswer = answer;
      render();
    }),
    watchRoundProgress(roundId, (progress) => {
      state.progress = progress;
      render();
    }),
    watchRoundResults(roundId, (results) => {
      state.results = results;
      render();
    })
  );
}

function subscribeCouple(coupleId) {
  coupleUnsub?.();
  coupleUnsub = null;
  if (!coupleId) return;
  coupleUnsub = watchCouple(coupleId, (couple) => {
    state.couple = couple;
    render();
  });
}

/* ---------------------------------------------------------
   Renderização
   --------------------------------------------------------- */
function currentQuestion() {
  return state.questions?.[state.game?.currentQuestionId] || null;
}

function renderCoupleStrip() {
  const strip = $('#couple-strip');
  if (!state.couple) {
    show(strip, false);
    return;
  }
  show(strip, true);
  $('#cs-name').textContent = state.couple.coupleName;
  $('#cs-score').textContent = formatPoints(state.couple.score || 0);
}

function renderQuestionScreen() {
  const question = currentQuestion();
  const game = state.game;

  $('#q-index').textContent = `Pergunta ${game.questionNumber || 1}`;
  $('#q-text').textContent = question?.text || 'Preparando…';
  answerPanel.setQuestion(question);

  const answerKey = state.myAnswer?.answer || state.localAnswer;
  const answered = Boolean(answerKey);
  show($('#answered-note'), answered);

  if (answered) {
    answerPanel.restore(answerKey);
    $('#chosen-label').textContent = answerKey === 'A' ? question?.optionA || 'ELE' : question?.optionB || 'ELA';

    const progress = coupleProgressState(state.progress, state.coupleId, state.participantId);
    const status = $('#partner-status');
    status.classList.toggle('done', progress.partnerDone);
    status.innerHTML = progress.partnerDone
      ? '✓ Seu par também respondeu. Aguarde o resultado.'
      : 'Aguardando seu par responder<span class="dots"></span>';
  }

  if (game.status === GAME_STATUS.QUESTION_ACTIVE) {
    if (!timer.isRunning() && game.questionStartedAt) {
      timer.start(game.questionStartedAt, game.timeLimit);
      $('#timer-label').textContent = answered ? 'Resposta registrada' : 'Responda rápido!';
    }
    if (!answered) answerPanel.reset();
  } else {
    timer.stop();
    answerPanel.lock();
    $('#timer-fill').style.width = '0%';
    $('#timer-value').textContent = '0s';
    $('#timer-label').textContent = 'Tempo encerrado';
  }
}

function renderResultScreen() {
  const result = state.results?.[state.coupleId];
  const hero = $('#result-hero');
  hero.classList.remove('sync', 'out', 'none');

  if (!result || result.status === ROUND_STATUS.INCOMPLETE) {
    hero.classList.add('none');
    $('#result-emoji').textContent = '⏳';
    $('#result-title').textContent = 'Sem pontuação';
    $('#result-sub').textContent = 'Um de vocês não respondeu a tempo.';
    $('#result-points').textContent = '+0';
    $('#result-position').textContent = '';
  } else if (result.status === ROUND_STATUS.OUT_OF_SYNC) {
    hero.classList.add('out');
    $('#result-emoji').textContent = '💥';
    $('#result-title').textContent = 'Fora de sintonia!';
    $('#result-sub').textContent = 'Dessa vez vocês pensaram diferente 😂';
    $('#result-points').textContent = '+0';
    $('#result-position').textContent = '';
  } else {
    hero.classList.add('sync');
    $('#result-emoji').textContent = '❤️';
    $('#result-title').textContent = 'Em sintonia!';
    $('#result-sub').textContent = 'Vocês pensaram igual!';
    $('#result-points').textContent = `+${result.points}`;
    $('#result-position').textContent = `Sua posição na rodada: ${result.position + 1}º`;

    if (result.position === 0 && state.celebratedRoundId !== state.game.lastRoundId) {
      state.celebratedRoundId = state.game.lastRoundId;
      confetti(2600);
    }
  }

  $('#result-total').textContent = formatPoints(state.couple?.score || 0);
  $('#pulse-line').classList.toggle('in-sync', result?.status === ROUND_STATUS.IN_SYNC);
}

function renderFinalScreen() {
  const ranking = rankCouples(state.couples);
  const position = ranking.findIndex((couple) => couple.coupleId === state.coupleId);
  const mine = ranking[position];

  if (position === 0) {
    $('#final-emoji').textContent = '🎉';
    $('#final-title').textContent = 'Parabéns!';
    $('#final-sub').textContent = 'Vocês são o casal mais sincronizado da noite!';
    if (!state.celebratedFinal) {
      state.celebratedFinal = true;
      confetti(6000);
    }
  } else {
    $('#final-emoji').textContent = '🏆';
    $('#final-title').textContent = 'Fim de jogo!';
    $('#final-sub').textContent = 'Obrigado por jogar juntos.';
  }

  $('#final-points').textContent = `${formatPoints(mine?.score || 0)} pts`;
  $('#final-position').textContent = position >= 0 ? `Posição final: ${position + 1}º de ${ranking.length}` : '';

  renderRankingList($('#final-ranking'), state.couples, { highlightCoupleId: state.coupleId, limit: 10 });
}

function render() {
  if (!state.gameLoaded || !state.participantLoaded) return;

  renderCoupleStrip();

  // Ainda não entrou.
  if (!state.participant) {
    const blocked = state.game.status !== GAME_STATUS.WAITING && !state.game.allowLateJoin;
    showScreen(blocked ? 'blocked' : 'name');
    return;
  }

  $('#my-name-echo').textContent = state.participant.name;

  // Entrou, mas ainda sem par.
  if (!state.coupleId) {
    showScreen('partner');
    return;
  }

  switch (state.game.status) {
    case GAME_STATUS.QUESTION_ACTIVE:
    case GAME_STATUS.QUESTION_LOCKED:
      showScreen('question');
      renderQuestionScreen();
      break;
    case GAME_STATUS.RESULTS:
      timer.stop();
      showScreen('result');
      renderResultScreen();
      break;
    case GAME_STATUS.FINAL:
      timer.stop();
      showScreen('final');
      renderFinalScreen();
      break;
    default: {
      timer.stop();
      showScreen('lobby');

      // Se alguma pergunta já foi jogada, o casal está entre rodadas —
      // não faz sentido dizer que o jogo "vai começar".
      const jaComecou = Boolean(state.game.questionNumber || state.game.lastRoundId);

      if (jaComecou) {
        $('#lobby-emoji').textContent = '⏳';
        $('#lobby-title').textContent = 'Aguardando a próxima pergunta';
        $('#lobby-text').innerHTML = 'Fique de olho no telão. A próxima pergunta aparece aqui em instantes.';
        $('#lobby-badge').textContent = 'Rodada encerrada';
      } else {
        $('#lobby-emoji').textContent = '❤️';
        $('#lobby-title').textContent = 'Casal formado!';
        $('#lobby-text').innerHTML =
          state.game.status === GAME_STATUS.READY
            ? 'O jogo vai começar. Fique de olho na tela do celular.'
            : `Aguarde o início do jogo. Vocês são <strong>${escapeHtml(state.couple?.coupleName || '')}</strong>.`;
        $('#lobby-badge').textContent = 'Você está conectado';
      }
    }
  }
}

/* ---------------------------------------------------------
   Início
   --------------------------------------------------------- */
async function boot() {
  try {
    const user = await ensureAnonymousAuth();
    state.participantId = user.uid;
    storage.save({ participantId: user.uid });

    watchConnection(connectionBar);

    watchGame((game) => {
      const roundChanged = game.currentRoundId !== state.roundId;
      const resultRound = game.status === GAME_STATUS.RESULTS ? game.lastRoundId : game.currentRoundId;
      state.game = game;
      state.gameLoaded = true;

      if (roundChanged) {
        state.roundId = game.currentRoundId;
        state.localAnswer = null;
        timer.stop();
        answerPanel.reset();
      }

      const roundToWatch = resultRound || game.currentRoundId;
      if (roundToWatch && roundToWatch !== state.watchedRound) {
        state.watchedRound = roundToWatch;
        subscribeRound(roundToWatch);
      }
      if (!roundToWatch && state.watchedRound) {
        state.watchedRound = null;
        clearRoundSubscriptions();
      }

      render();
    });

    watchQuestions((questions) => {
      state.questions = questions;
      render();
    });

    watchCouples((couples) => {
      state.couples = couples;
      render();
    });

    watchParticipant(state.participantId, (participant) => {
      state.participant = participant;
      state.participantLoaded = true;
      const coupleId = participant?.coupleId || null;

      if (coupleId !== state.coupleId) {
        state.coupleId = coupleId;
        state.couple = null;
        storage.save({ coupleId, participantName: participant?.name || null });
        subscribeCouple(coupleId);
      }
      render();
    });

    watchParticipants((participants) => {
      partnerSelection.update(participants, state.participantId);
    });

    // Se a sessão anterior guardou o nome, já preenche o campo.
    const saved = storage.read();
    if (saved.participantName) $('#input-name').value = saved.participantName;
  } catch (error) {
    console.error(error);
    toast(errorMessage(error), 'error');
    showScreen('name');
  }
}

boot();
