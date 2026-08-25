import { escapeHtml } from './utils.js';

/** Perguntas carregadas com um clique no painel administrativo. */
export const DEFAULT_QUESTIONS = [
  'Quem dorme mais?',
  'Quem demora mais para se arrumar?',
  'Quem é mais ciumento?',
  'Quem esquece mais as coisas?',
  'Quem gasta mais dinheiro?',
  'Quem é mais romântico?',
  'Quem fala mais?',
  'Quem demora mais para responder mensagens?',
  'Quem pede desculpas primeiro?',
  'Quem é mais organizado?',
  'Quem é mais provável de se atrasar?',
  'Quem escolhe o filme para assistir?',
  'Quem sente mais fome?',
  'Quem é mais aventureiro?',
  'Quem é mais provável de sobreviver em uma ilha deserta?',
  'Quem é mais teimoso?',
  'Quem é mais engraçado?',
  'Quem se preocupa mais?',
  'Quem é mais paciente?',
  'Quem toma mais decisões no relacionamento?'
].map((text) => ({ text, optionA: '👨 ELE', optionB: '👩 ELA' }));

/**
 * Desenha a lista de perguntas do painel administrativo.
 * As ações são delegadas pelo admin.js através de data-action.
 */
export function renderQuestionList(container, questions, { currentQuestionId, playedQuestionIds = [] } = {}) {
  if (!questions.length) {
    container.innerHTML = `
      <div class="empty">
        Nenhuma pergunta cadastrada ainda.<br>
        Use <strong>Carregar 20 perguntas</strong> ou crie a primeira.
      </div>`;
    return;
  }

  container.innerHTML = questions
    .map((question, index) => {
      const classes = [
        'q-item',
        question.id === currentQuestionId ? 'is-current' : '',
        question.active === false ? 'is-off' : '',
        playedQuestionIds.includes(question.id) ? 'is-done' : ''
      ]
        .filter(Boolean)
        .join(' ');

      return `
        <div class="${classes}" data-id="${question.id}">
          <div class="q-order">${index + 1}</div>
          <div>
            <div class="q-text">${escapeHtml(question.text)}</div>
            <div class="q-opts">${escapeHtml(question.optionA)} &nbsp;·&nbsp; ${escapeHtml(question.optionB)}${
        playedQuestionIds.includes(question.id) ? ' &nbsp;·&nbsp; já jogada' : ''
      }</div>
          </div>
          <div class="q-actions">
            <button class="icon-btn" data-action="up" title="Subir">↑</button>
            <button class="icon-btn" data-action="down" title="Descer">↓</button>
            <button class="icon-btn" data-action="edit" title="Editar">✎</button>
            <button class="icon-btn" data-action="duplicate" title="Duplicar">⧉</button>
            <button class="icon-btn" data-action="toggle" title="${question.active === false ? 'Ativar' : 'Desativar'}">${
        question.active === false ? '○' : '●'
      }</button>
            <button class="icon-btn" data-action="arm" title="Deixar pronta para iniciar">▶</button>
            <button class="icon-btn danger" data-action="delete" title="Excluir">✕</button>
          </div>
        </div>`;
    })
    .join('');
}

/** Formulário de criação/edição em modal. */
export function questionModal({ question = null, onSave, onCancel }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal stack" role="dialog" aria-modal="true">
      <h3>${question ? 'Editar pergunta' : 'Nova pergunta'}</h3>
      <div class="field">
        <label class="label" for="q-text">Pergunta</label>
        <input class="input" id="q-text" maxlength="120" placeholder="Quem dorme mais?" value="${escapeHtml(
          question?.text || ''
        )}">
      </div>
      <div class="row" style="gap:12px">
        <div class="field grow">
          <label class="label" for="q-a">Opção A</label>
          <input class="input" id="q-a" maxlength="40" value="${escapeHtml(question?.optionA || '👨 ELE')}">
        </div>
        <div class="field grow">
          <label class="label" for="q-b">Opção B</label>
          <input class="input" id="q-b" maxlength="40" value="${escapeHtml(question?.optionB || '👩 ELA')}">
        </div>
      </div>
      <label class="switch">
        <input type="checkbox" id="q-active" ${question?.active === false ? '' : 'checked'}>
        Pergunta ativa
      </label>
      <div class="row" style="justify-content:flex-end;gap:10px">
        <button class="btn btn-ghost" data-close>Cancelar</button>
        <button class="btn btn-primary" data-save>Salvar pergunta</button>
      </div>
    </div>`;

  const close = () => {
    backdrop.remove();
    onCancel?.();
  };

  backdrop.querySelector('[data-close]').addEventListener('click', close);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });

  backdrop.querySelector('[data-save]').addEventListener('click', () => {
    const text = backdrop.querySelector('#q-text').value.trim();
    const optionA = backdrop.querySelector('#q-a').value.trim();
    const optionB = backdrop.querySelector('#q-b').value.trim();
    const active = backdrop.querySelector('#q-active').checked;
    if (!text || !optionA || !optionB) return;
    backdrop.remove();
    onSave({ id: question?.id, text, optionA, optionB, active, order: question?.order });
  });

  document.body.appendChild(backdrop);
  backdrop.querySelector('#q-text').focus();
}
