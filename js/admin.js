import { requireAdmin, signOutUser } from './auth.js';
import {
  adminApi,
  orderedQuestions,
  watchGame,
  watchQuestions,
  watchCouples,
  watchParticipants,
  watchRoundProgress,
  watchRoundResults,
  watchConnection,
  serverNow
} from './firebase-service.js';
import { DEFAULT_QUESTIONS, renderQuestionList, questionModal } from './questions.js';
import { GAME_STATUS, STATUS_LABEL, countFinishedCouples } from './game.js';
import { renderRankingList } from './ranking.js';
import { ROUND_STATUS } from './scoring.js';
import { $, escapeHtml, toast, errorMessage, formatSeconds, connectionBar, objectToList } from './utils.js';

const state = {
  game: null,
  questions: {},
  couples: {},
  participants: {},
  progress: {},
  results: {},
  watchedRound: null,
  autoEnd: true,
  autoEndFiredFor: null,
  playedQuestionIds: []
};

const roundSubs = [];

/* ---------------------------------------------------------
   Confirmações
   --------------------------------------------------------- */
function confirmDialog({ title, text, confirmLabel = 'Confirmar', danger = false, extra = null }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal stack" role="dialog" aria-modal="true">
        <h3>${escapeHtml(title)}</h3>
        <p class="hero-copy">${text}</p>
        ${extra ? `<div class="stack" id="extra-slot">${extra}</div>` : ''}
        <div class="row" style="justify-content:flex-end;gap:10px">
          <button class="btn btn-ghost" data-cancel>Cancelar</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;

    const finish = (value) => {
      const keep = backdrop.querySelector('#keep-couples')?.checked;
      backdrop.remove();
      resolve(value ? { confirmed: true, keepCouples: keep !== false } : { confirmed: false });
    };

    backdrop.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
    backdrop.querySelector('[data-ok]').addEventListener('click', () => finish(true));
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) finish(false);
    });

    document.body.appendChild(backdrop);
  });
}

async function run(action, label) {
  try {
    await action();
  } catch (error) {
    console.error(label, error);
    toast(errorMessage(error), 'error');
  }
}

/* ---------------------------------------------------------
   Renderização
   --------------------------------------------------------- */
function renderStatus() {
  const status = state.game?.status || GAME_STATUS.WAITING;
  $('#status-pill').dataset.state = status;
  $('#status-text').textContent = STATUS_LABEL[status] || status;

  const questions = orderedQuestions(state.questions);
  const current = questions.find((q) => q.id === state.game?.currentQuestionId) || null;

  $('#current-question').textContent = current
    ? `${questions.indexOf(current) + 1}. ${current.text}`
    : semJogoAinda(status)
    ? 'Crie um jogo para abrir a entrada dos casais'
    : 'Nenhuma (clique em Iniciar jogo)';
  $('#current-options').textContent = current ? `${current.optionA} · ${current.optionB}` : '—';

  const active = status === GAME_STATUS.QUESTION_ACTIVE;
  const semJogo = status === GAME_STATUS.IDLE;
  $('#btn-start-question').disabled = active || semJogo || !questions.length;
  $('#btn-end-question').disabled = !state.game?.currentRoundId || status === GAME_STATUS.RESULTS;
  $('#btn-next-question').disabled = active || semJogo;
  $('#btn-start-game').disabled = active || semJogo;
  $('#btn-create-game').disabled = active;
}

function semJogoAinda(status) {
  return status === GAME_STATUS.IDLE;
}

function renderStats() {
  const couples = Object.keys(state.couples).length;
  const waiting = objectToList(state.participants).filter((p) => !p.coupleId).length;

  $('#stat-couples').textContent = couples;
  $('#stat-waiting').textContent = waiting;
  $('#stat-finished').textContent = countFinishedCouples(state.progress);
  $('#ranking-count').textContent = `${couples} ${couples === 1 ? 'casal' : 'casais'}`;
}

function renderCouplesLive() {
  const container = $('#couples-live');
  const couples = objectToList(state.couples, 'coupleId');

  if (!couples.length) {
    container.innerHTML = '<div class="empty">Nenhum casal formado ainda.</div>';
    return;
  }

  const showResults = state.game?.status === GAME_STATUS.RESULTS && Object.keys(state.results).length;

  container.innerHTML = couples
    .map((couple) => {
      if (showResults) {
        const result = state.results[couple.coupleId];
        const flag =
          result?.status === ROUND_STATUS.IN_SYNC
            ? `<span class="answer-flag flag-full">${result.position + 1}º · +${result.points}</span>`
            : result?.status === ROUND_STATUS.OUT_OF_SYNC
            ? '<span class="answer-flag flag-half">fora de sintonia</span>'
            : '<span class="answer-flag flag-wait">sem resposta</span>';
        return `
          <div class="couple-row with-action">
            <span>${escapeHtml(couple.coupleName)}</span>
            <span class="q-opts">${result?.responseTime != null ? formatSeconds(result.responseTime) : '—'}</span>
            ${flag}
            <button class="icon-btn danger" data-remove-couple="${couple.coupleId}" title="Excluir casal">✕</button>
          </div>`;
      }

      const answered = Object.keys(state.progress[couple.coupleId] || {}).length;
      const flag =
        answered >= 2
          ? '<span class="answer-flag flag-full">os dois</span>'
          : answered === 1
          ? '<span class="answer-flag flag-half">só um</span>'
          : '<span class="answer-flag flag-wait">aguardando</span>';

      return `
        <div class="couple-row with-action">
          <span>${escapeHtml(couple.coupleName)}</span>
          <span class="q-opts">${couple.score || 0} pts</span>
          ${flag}
          <button class="icon-btn danger" data-remove-couple="${couple.coupleId}" title="Excluir casal">✕</button>
        </div>`;
    })
    .join('');
}

function renderWaitingList() {
  const container = $('#waiting-list');
  const waiting = objectToList(state.participants).filter((p) => !p.coupleId);

  if (!waiting.length) {
    container.innerHTML = '<div class="empty">Todo mundo já tem par.</div>';
    return;
  }

  container.innerHTML = waiting
    .map(
      (participant) => `
        <div class="couple-row">
          <span>${escapeHtml(participant.name)}</span>
          <span class="q-opts">sem par</span>
          <button class="icon-btn danger" data-remove="${participant.id}" title="Remover">✕</button>
        </div>`
    )
    .join('');
}

function renderQuestions() {
  renderQuestionList($('#question-list'), orderedQuestions(state.questions, false), {
    currentQuestionId: state.game?.currentQuestionId,
    playedQuestionIds: state.playedQuestionIds
  });
}

function renderAll() {
  renderStatus();
  renderStats();
  renderCouplesLive();
  renderWaitingList();
  renderQuestions();
  renderRankingList($('#admin-ranking'), state.couples, { limit: 12 });
}

/* ---------------------------------------------------------
   Cronômetro do painel (com encerramento automático)
   --------------------------------------------------------- */
function tickClock() {
  const game = state.game;
  const clock = $('#round-clock');

  if (!game || game.status !== GAME_STATUS.QUESTION_ACTIVE || !game.questionStartedAt) {
    clock.textContent = game?.status === GAME_STATUS.QUESTION_LOCKED ? 'tempo encerrado' : '—';
    requestAnimationFrame(tickClock);
    return;
  }

  const limitMs = (game.timeLimit || 20) * 1000;
  const remaining = Math.max(0, limitMs - (serverNow() - game.questionStartedAt));
  clock.textContent = `${(remaining / 1000).toFixed(1)}s`;

  if (remaining <= 0 && state.autoEnd && state.autoEndFiredFor !== game.currentRoundId) {
    state.autoEndFiredFor = game.currentRoundId;
    run(() => adminApi.endQuestion(), 'auto-end');
  }

  requestAnimationFrame(tickClock);
}

/* ---------------------------------------------------------
   Assinaturas de rodada
   --------------------------------------------------------- */
function subscribeRound(roundId) {
  while (roundSubs.length) roundSubs.pop()();
  state.progress = {};
  state.results = {};

  if (!roundId) {
    $('#round-label').textContent = 'sem rodada ativa';
    renderAll();
    return;
  }

  $('#round-label').textContent = `rodada ${state.game?.questionNumber || ''}`.trim();

  roundSubs.push(
    watchRoundProgress(roundId, (progress) => {
      state.progress = progress;
      renderStats();
      renderCouplesLive();
    }),
    watchRoundResults(roundId, (results) => {
      state.results = results;
      renderCouplesLive();
    })
  );
}

/* ---------------------------------------------------------
   Ações
   --------------------------------------------------------- */
function bindActions() {
  $('#btn-logout').addEventListener('click', async () => {
    await signOutUser();
    window.location.replace('login.html');
  });

  $('#btn-create-game').addEventListener('click', async () => {
    const { confirmed } = await confirmDialog({
      title: 'Criar um jogo novo?',
      text: 'A entrada é aberta e o QR Code aparece no telão. Participantes, casais e pontuação da partida anterior são apagados — as perguntas continuam salvas.',
      confirmLabel: 'Criar jogo'
    });
    if (!confirmed) return;
    run(async () => {
      await adminApi.createGame();
      toast('Jogo criado. O QR Code já está no telão.', 'ok');
    }, 'createGame');
  });

  $('#btn-start-game').addEventListener('click', () =>
    run(async () => {
      await adminApi.startGame();
      toast('Jogo pronto para começar.', 'ok');
    }, 'startGame')
  );

  $('#btn-start-question').addEventListener('click', () =>
    run(async () => {
      state.autoEndFiredFor = null;
      await adminApi.startQuestion();
    }, 'startQuestion')
  );

  $('#btn-end-question').addEventListener('click', () =>
    run(async () => {
      const summary = await adminApi.endQuestion();
      if (summary) toast(`${summary.syncedCouples} casais em sintonia.`, 'ok');
    }, 'endQuestion')
  );

  $('#btn-next-question').addEventListener('click', () =>
    run(async () => {
      const next = await adminApi.nextQuestion();
      toast(next ? 'Próxima pergunta selecionada.' : 'Era a última pergunta. Jogo encerrado.', 'ok');
    }, 'nextQuestion')
  );

  $('#btn-show-ranking').addEventListener('click', () => run(() => adminApi.showRanking(true), 'showRanking'));

  $('#btn-final').addEventListener('click', async () => {
    const { confirmed } = await confirmDialog({
      title: 'Encerrar o jogo?',
      text: 'O telão vai revelar o pódio e os campeões da noite.',
      confirmLabel: 'Encerrar e revelar'
    });
    if (confirmed) run(() => adminApi.finishGame(), 'finishGame');
  });

  $('#btn-reset').addEventListener('click', async () => {
    const { confirmed, keepCouples } = await confirmDialog({
      title: 'Tem certeza?',
      text: 'Isso zera a pontuação, apaga as respostas e volta o jogo para o início. O banco de perguntas continua salvo.',
      confirmLabel: 'Reiniciar',
      danger: true,
      extra: `
        <label class="switch">
          <input type="checkbox" id="keep-couples" checked>
          Manter os casais para uma nova partida
        </label>`
    });
    if (!confirmed) return;
    run(async () => {
      await adminApi.resetGame({ keepCouples });
      toast(keepCouples ? 'Partida reiniciada com os mesmos casais.' : 'Partida reiniciada do zero.', 'ok');
    }, 'resetGame');
  });

  $('#btn-seed').addEventListener('click', async () => {
    const { confirmed } = await confirmDialog({
      title: 'Carregar 20 perguntas?',
      text: 'As perguntas padrão serão adicionadas ao final da lista. Nada é apagado.',
      confirmLabel: 'Carregar'
    });
    if (confirmed) run(() => adminApi.seedQuestions(DEFAULT_QUESTIONS), 'seedQuestions');
  });

  $('#btn-new-question').addEventListener('click', () => {
    questionModal({
      onSave: (question) => run(() => adminApi.saveQuestion(question), 'saveQuestion')
    });
  });

  $('#question-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = button.closest('.q-item').dataset.id;
    const question = { id, ...(state.questions[id] || {}) };

    switch (button.dataset.action) {
      case 'up':
        return run(() => adminApi.moveQuestion(id, 'up'), 'moveQuestion');
      case 'down':
        return run(() => adminApi.moveQuestion(id, 'down'), 'moveQuestion');
      case 'edit':
        return questionModal({
          question,
          onSave: (updated) => run(() => adminApi.saveQuestion(updated), 'saveQuestion')
        });
      case 'duplicate':
        return run(() => adminApi.duplicateQuestion(id), 'duplicateQuestion');
      case 'toggle':
        return run(() => adminApi.toggleQuestion(id, question.active === false), 'toggleQuestion');
      case 'arm':
        return run(
          () => adminApi.updateSettings({ currentQuestionId: id, status: GAME_STATUS.READY, currentRoundId: null }),
          'armQuestion'
        );
      case 'delete': {
        const { confirmed } = await confirmDialog({
          title: 'Excluir pergunta?',
          text: escapeHtml(question.text || ''),
          confirmLabel: 'Excluir',
          danger: true
        });
        if (confirmed) run(() => adminApi.deleteQuestion(id), 'deleteQuestion');
        return;
      }
      default:
    }
  });

  $('#couples-live').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove-couple]');
    if (!button) return;

    const coupleId = button.dataset.removeCouple;
    const couple = state.couples[coupleId];

    const { confirmed } = await confirmDialog({
      title: 'Excluir este casal?',
      text: `<strong>${escapeHtml(couple?.coupleName || '')}</strong> sai do jogo e perde os ${
        couple?.score || 0
      } pontos. As duas pessoas voltam a poder entrar digitando o nome de novo.`,
      confirmLabel: 'Excluir casal',
      danger: true
    });

    if (confirmed) {
      run(async () => {
        await adminApi.removeCouple(coupleId);
        toast('Casal excluído.', 'ok');
      }, 'removeCouple');
    }
  });

  $('#waiting-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove]');
    if (!button) return;
    const { confirmed } = await confirmDialog({
      title: 'Remover participante?',
      text: 'Ele poderá entrar novamente digitando o nome.',
      confirmLabel: 'Remover',
      danger: true
    });
    if (confirmed) run(() => adminApi.removeParticipant(button.dataset.remove), 'removeParticipant');
  });

  $('#btn-save-time').addEventListener('click', () => {
    const value = Number($('#input-time-limit').value);
    if (!value || value < 5 || value > 120) {
      toast('Escolha um tempo entre 5 e 120 segundos.', 'error');
      return;
    }
    run(async () => {
      await adminApi.updateSettings({ timeLimit: value });
      toast('Tempo salvo.', 'ok');
    }, 'timeLimit');
  });

  $('#chk-autoend').addEventListener('change', (event) => {
    state.autoEnd = event.target.checked;
  });

  $('#chk-latejoin').addEventListener('change', (event) =>
    run(() => adminApi.updateSettings({ allowLateJoin: event.target.checked }), 'allowLateJoin')
  );
}

/* ---------------------------------------------------------
   Início
   --------------------------------------------------------- */
async function boot() {
  await requireAdmin();

  $('#admin-loading').remove();
  $('#admin-root').hidden = false;

  await adminApi.ensureGame();
  bindActions();
  watchConnection(connectionBar);

  watchGame((game) => {
    const previous = state.game;
    state.game = game;

    if (game.currentRoundId !== state.watchedRound) {
      state.watchedRound = game.currentRoundId;
      subscribeRound(game.currentRoundId);
    }

    if (!previous || previous.timeLimit !== game.timeLimit) {
      $('#input-time-limit').value = game.timeLimit;
    }
    $('#chk-latejoin').checked = Boolean(game.allowLateJoin);

    if (game.currentQuestionId && game.status === GAME_STATUS.RESULTS) {
      if (!state.playedQuestionIds.includes(game.currentQuestionId)) {
        state.playedQuestionIds = [...state.playedQuestionIds, game.currentQuestionId];
      }
    }

    renderAll();
  });

  watchQuestions((questions) => {
    state.questions = questions;
    renderQuestions();
    renderStatus();
  });

  watchCouples((couples) => {
    state.couples = couples;
    renderStats();
    renderCouplesLive();
    renderRankingList($('#admin-ranking'), couples, { limit: 12 });
  });

  watchParticipants((participants) => {
    state.participants = participants;
    renderStats();
    renderWaitingList();
  });

  requestAnimationFrame(tickClock);
}

boot();
