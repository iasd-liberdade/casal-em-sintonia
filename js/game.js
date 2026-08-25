import { serverNow } from './firebase-service.js';

export const GAME_STATUS = {
  WAITING: 'WAITING',
  READY: 'READY',
  QUESTION_ACTIVE: 'QUESTION_ACTIVE',
  QUESTION_LOCKED: 'QUESTION_LOCKED',
  RESULTS: 'RESULTS',
  FINAL: 'FINAL'
};

export const STATUS_LABEL = {
  WAITING: 'Aguardando participantes',
  READY: 'Pronto para começar',
  QUESTION_ACTIVE: 'Pergunta no ar',
  QUESTION_LOCKED: 'Tempo encerrado',
  RESULTS: 'Mostrando resultado',
  FINAL: 'Jogo encerrado'
};

/**
 * Cronômetro visual baseado no horário do servidor.
 * O cliente só exibe o tempo — a pontuação usa os timestamps oficiais.
 */
export function createTimer({ onTick, onExpire }) {
  let frame = null;
  let expired = false;
  let startedAt = null;
  let limitMs = 0;

  function loop() {
    if (startedAt == null) return;
    const elapsed = Math.max(0, serverNow() - startedAt);
    const remaining = Math.max(0, limitMs - elapsed);
    onTick?.({ elapsed, remaining, limitMs, ratio: limitMs ? remaining / limitMs : 0 });

    if (remaining <= 0 && !expired) {
      expired = true;
      onExpire?.();
    }
    frame = requestAnimationFrame(loop);
  }

  return {
    start(questionStartedAt, timeLimitSeconds) {
      this.stop();
      startedAt = Number(questionStartedAt);
      limitMs = Number(timeLimitSeconds || 20) * 1000;
      expired = false;
      loop();
    },
    stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = null;
      startedAt = null;
    },
    isRunning() {
      return frame !== null;
    }
  };
}

/** Conta quantos casais já tiveram as DUAS respostas registradas. */
export function countFinishedCouples(progress) {
  return Object.values(progress || {}).filter((members) => Object.keys(members || {}).length >= 2).length;
}

/** Texto curto para o estado do casal na rodada atual. */
export function coupleProgressState(progress, coupleId, participantId) {
  const members = progress?.[coupleId] || {};
  const ids = Object.keys(members);
  return {
    mineDone: ids.includes(participantId),
    partnerDone: ids.some((id) => id !== participantId),
    bothDone: ids.length >= 2
  };
}
