import { escapeHtml } from './utils.js';

/**
 * Controla as duas alternativas.
 * Um toque registra a resposta; depois disso as duas ficam travadas.
 * Não existe botão de enviar, confirmar ou avançar.
 */
export function createAnswerPanel({ optionsEl, onAnswer }) {
  const buttons = {
    A: optionsEl.querySelector('[data-option="A"]'),
    B: optionsEl.querySelector('[data-option="B"]')
  };

  let locked = false;
  let sending = false;

  Object.entries(buttons).forEach(([key, button]) => {
    button.addEventListener('click', async () => {
      if (locked || sending) return;
      sending = true;

      // Marca imediatamente: a interface responde ao toque sem esperar a rede.
      setChosen(key);
      setLocked(true);

      try {
        await onAnswer(key);
      } catch (error) {
        // Se o servidor recusou, devolvemos as alternativas — exceto quando
        // a recusa foi justamente porque já havia resposta registrada.
        if (error?.code !== 'ALREADY_ANSWERED') {
          clearChosen();
          setLocked(false);
        }
        throw error;
      } finally {
        sending = false;
      }
    });
  });

  function setChosen(key) {
    Object.entries(buttons).forEach(([option, button]) => {
      button.classList.toggle('chosen', option === key);
    });
  }

  function clearChosen() {
    Object.values(buttons).forEach((button) => button.classList.remove('chosen'));
  }

  function setLocked(value) {
    locked = value;
    optionsEl.classList.toggle('locked', value);
    Object.values(buttons).forEach((button) => (button.disabled = value));
  }

  return {
    setQuestion(question) {
      buttons.A.querySelector('.option-label').textContent = question?.optionA || 'ELE';
      buttons.B.querySelector('.option-label').textContent = question?.optionB || 'ELA';
    },
    /** Restaura o estado quando a página é atualizada no meio da rodada. */
    restore(answerKey) {
      if (!answerKey) return;
      setChosen(answerKey);
      setLocked(true);
    },
    reset() {
      clearChosen();
      setLocked(false);
    },
    lock() {
      setLocked(true);
    },
    chosenLabel(question, answerKey) {
      if (!answerKey) return '';
      return escapeHtml(answerKey === 'A' ? question?.optionA || 'ELE' : question?.optionB || 'ELA');
    }
  };
}
