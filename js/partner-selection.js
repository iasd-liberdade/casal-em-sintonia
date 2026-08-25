import { escapeHtml, initials } from './utils.js';

/**
 * Lista, em tempo real, quem ainda está sem par.
 * A trava de verdade contra escolha dupla está no banco (transação);
 * aqui apenas evitamos cliques repetidos e mostramos a lista atualizada.
 */
export function createPartnerSelection({ container, onChoose }) {
  let busy = false;

  container.addEventListener('click', async (event) => {
    const button = event.target.closest('.partner-btn');
    if (!button || busy) return;

    busy = true;
    container.querySelectorAll('.partner-btn').forEach((node) => (node.disabled = true));
    const original = button.innerHTML;
    button.innerHTML = '<span class="partner-avatar">…</span><span>Formando casal…</span>';

    try {
      await onChoose(button.dataset.id);
    } catch (error) {
      button.innerHTML = original;
      container.querySelectorAll('.partner-btn').forEach((node) => (node.disabled = false));
      throw error;
    } finally {
      busy = false;
    }
  });

  return {
    update(participants, myId) {
      if (busy) return;

      const available = Object.entries(participants || {})
        .map(([id, participant]) => ({ id, ...participant }))
        .filter((participant) => participant.id !== myId && participant.status === 'AVAILABLE' && !participant.coupleId)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

      if (!available.length) {
        container.innerHTML = `
          <div class="empty">
            Ninguém disponível no momento.<br>
            Assim que seu par entrar, o nome dele aparece aqui.
          </div>`;
        return;
      }

      container.innerHTML = available
        .map(
          (participant) => `
            <button class="partner-btn" data-id="${participant.id}">
              <span class="partner-avatar">${escapeHtml(initials(participant.name))}</span>
              <span>${escapeHtml(participant.name)}</span>
            </button>`
        )
        .join('');
    }
  };
}
