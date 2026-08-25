import { rankCouples } from './scoring.js';
import { escapeHtml, formatPoints, medalFor } from './utils.js';

export { rankCouples };

/** Lista compacta usada no painel administrativo e no celular. */
export function renderRankingList(container, couples, { highlightCoupleId = null, limit = 0 } = {}) {
  const ranking = rankCouples(couples);
  const list = limit ? ranking.slice(0, limit) : ranking;

  if (!list.length) {
    container.innerHTML = '<div class="empty">Nenhum casal formado ainda.</div>';
    return ranking;
  }

  container.innerHTML = list
    .map((couple, index) => {
      const classes = [
        'rank-item',
        index === 0 ? 'is-top1' : '',
        index === 1 ? 'is-top2' : '',
        index === 2 ? 'is-top3' : '',
        couple.coupleId === highlightCoupleId ? 'is-me' : ''
      ]
        .filter(Boolean)
        .join(' ');

      return `
        <li class="${classes}">
          <span class="rank-pos">${medalFor(index)}</span>
          <span class="rank-name">${escapeHtml(couple.coupleName)}</span>
          <span class="rank-score">${formatPoints(couple.score)} <small>pts</small></span>
        </li>`;
    })
    .join('');

  return ranking;
}

/**
 * Ranking do telão, com animação de subida e descida.
 * Mantém as posições anteriores para comparar entre atualizações.
 */
export function createDisplayRanking(container) {
  let previous = new Map();

  return {
    render(couples, { page = 0, perPage = 10 } = {}) {
      const ranking = rankCouples(couples);
      const start = page * perPage;
      const slice = ranking.slice(start, start + perPage);

      container.classList.toggle('two-col', ranking.length > 10);

      container.innerHTML = slice
        .map((couple, index) => {
          const position = start + index;
          const before = previous.get(couple.coupleId);
          let movement = '';
          if (before != null && before > position) movement = 'rise';
          if (before != null && before < position) movement = 'fall';

          const podium = position === 0 ? 'top1' : position === 1 ? 'top2' : position === 2 ? 'top3' : '';

          return `
            <div class="d-rank-row ${podium} ${movement}">
              <span class="pos">${medalFor(position)}</span>
              <span class="name">${escapeHtml(couple.coupleName)}</span>
              <span class="pts">${formatPoints(couple.score)} pts</span>
            </div>`;
        })
        .join('');

      previous = new Map(ranking.map((couple, index) => [couple.coupleId, index]));
      return ranking;
    },
    leader(couples) {
      return rankCouples(couples)[0] || null;
    },
    reset() {
      previous = new Map();
    }
  };
}
