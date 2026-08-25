import { APP_CONFIG } from './firebase-config.js';

/* ---------- DOM ---------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function setText(sel, value, root = document) {
  const node = typeof sel === 'string' ? $(sel, root) : sel;
  if (node) node.textContent = value;
}

export function show(node, visible = true) {
  if (!node) return;
  node.classList.toggle('hidden', !visible);
}

export function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function initials(name = '') {
  const clean = String(name).trim();
  if (!clean) return '?';
  return clean.charAt(0).toUpperCase();
}

/* ---------- Formatação ---------- */
export function formatSeconds(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  return (ms / 1000).toFixed(3).replace('.', ',') + 's';
}

export function formatPoints(value) {
  return new Intl.NumberFormat('pt-BR').format(Math.round(value || 0));
}

export function medalFor(position) {
  return ['🥇', '🥈', '🥉'][position] || `${position + 1}.`;
}

/* ---------- Armazenamento local ---------- */
const STORAGE_KEY = `casal-em-sintonia:${APP_CONFIG.storageVersion}`;

export const storage = {
  read() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  },
  save(patch) {
    const next = { ...this.read(), ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* modo privado do navegador: seguimos sem persistir */
    }
    return next;
  },
  clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignorado */
    }
  }
};

/* ---------- Avisos na tela ---------- */
function toastWrap() {
  let wrap = $('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  return wrap;
}

export function toast(message, type = 'info', duration = 3600) {
  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.textContent = message;
  toastWrap().appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(10px)';
    setTimeout(() => node.remove(), 260);
  }, duration);
}

/* ---------- Erros com mensagem amigável ---------- */
export class AppError extends Error {
  constructor(code, message) {
    super(message || ERROR_MESSAGES[code] || 'Algo deu errado. Tente de novo.');
    this.code = code;
  }
}

export const ERROR_MESSAGES = {
  PARTNER_TAKEN: '⚠️ Esta pessoa acabou de ser escolhida por outra. Escolha outro nome.',
  ALREADY_PAIRED: 'Você já está em um casal.',
  GAME_STARTED: '⚠️ O jogo já começou. Aguarde a próxima partida.',
  ROUND_CLOSED: 'O tempo desta pergunta terminou.',
  ALREADY_ANSWERED: '✓ Sua resposta já foi registrada.',
  NO_COUPLE: 'Forme um casal antes de responder.',
  INVALID_SESSION: 'Sua sessão expirou. Entre novamente.',
  NAME_REQUIRED: 'Digite seu nome para entrar.',
  NOT_ADMIN: 'Esta conta não tem permissão de administrador.',
  OFFLINE: '📡 Sem conexão. Tentando reconectar...',
  PERMISSION_DENIED: 'Sem permissão para esta ação. Confira as regras do banco.'
};

export function errorMessage(error) {
  if (!error) return ERROR_MESSAGES.PERMISSION_DENIED;
  if (error.code && ERROR_MESSAGES[error.code]) return ERROR_MESSAGES[error.code];
  const raw = String(error.code || error.message || '');
  if (raw.includes('PERMISSION_DENIED') || raw.includes('permission-denied')) return ERROR_MESSAGES.PERMISSION_DENIED;
  if (raw.includes('network') || raw.includes('unavailable')) return ERROR_MESSAGES.OFFLINE;
  if (raw.includes('auth/invalid-credential') || raw.includes('auth/wrong-password') || raw.includes('auth/user-not-found')) {
    return 'E-mail ou senha incorretos.';
  }
  if (raw.includes('auth/invalid-email')) return 'E-mail inválido.';
  if (raw.includes('auth/too-many-requests')) return 'Muitas tentativas. Aguarde um instante.';
  return error.message || 'Algo deu errado. Tente de novo.';
}

/* ---------- Barra de "sem conexão" ---------- */
export function connectionBar(connected) {
  let bar = $('.offline-bar');
  if (connected) {
    bar?.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'offline-bar';
    bar.textContent = '📡 Parece que você está sem conexão. Tentando reconectar...';
    document.body.appendChild(bar);
  }
}

/* ---------- Confete (canvas próprio, sem biblioteca) ---------- */
export function confetti(durationMs = 4200) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let canvas = $('#confetti-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'confetti-canvas';
    document.body.appendChild(canvas);
  }
  const ctx = canvas.getContext('2d');
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener('resize', resize);

  const colors = ['#FF3D7F', '#8B5CF6', '#22D3EE', '#FFC857', '#34D399', '#FFFFFF'];
  const pieces = Array.from({ length: 160 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * -canvas.height,
    w: 6 + Math.random() * 8,
    h: 8 + Math.random() * 12,
    color: colors[Math.floor(Math.random() * colors.length)],
    speed: 2 + Math.random() * 4,
    drift: -1.4 + Math.random() * 2.8,
    spin: -0.2 + Math.random() * 0.4,
    angle: Math.random() * Math.PI
  }));

  const started = performance.now();

  function frame(now) {
    const elapsed = now - started;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach((p) => {
      p.y += p.speed;
      p.x += p.drift;
      p.angle += p.spin;
      if (p.y > canvas.height + 30) {
        p.y = -20;
        p.x = Math.random() * canvas.width;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = elapsed > durationMs - 900 ? Math.max(0, (durationMs - elapsed) / 900) : 1;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (elapsed < durationMs) {
      requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      window.removeEventListener('resize', resize);
      canvas.remove();
    }
  }
  requestAnimationFrame(frame);
}

/* ---------- Diversos ---------- */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function objectToList(obj, idKey = 'id') {
  return Object.entries(obj || {}).map(([key, value]) => ({ ...value, [idKey]: key }));
}

export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
