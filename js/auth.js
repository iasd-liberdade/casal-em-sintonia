import { adminSignIn, onAuth, isAdmin, signOutUser } from './firebase-service.js';
import { $, toast, errorMessage } from './utils.js';

/**
 * Protege admin.html. Resolve com o usuário quando ele é administrador;
 * caso contrário manda para a tela de login.
 */
export function requireAdmin() {
  return new Promise((resolve) => {
    const unsub = onAuth(async (user) => {
      if (!user || user.isAnonymous) {
        window.location.replace('login.html');
        return;
      }
      const admin = await isAdmin(user.uid);
      if (!admin) {
        await signOutUser();
        window.location.replace('login.html');
        return;
      }
      unsub();
      resolve(user);
    });
  });
}

export { signOutUser };

/* ---------------------------------------------------------
   Lógica da página de login
   --------------------------------------------------------- */
const loginCard = $('#login-form');

if (loginCard) {
  const button = $('#btn-login');

  const submit = async () => {
    const email = $('#email').value.trim();
    const password = $('#password').value;

    if (!email || !password) {
      toast('Preencha e-mail e senha.', 'error');
      return;
    }

    button.disabled = true;
    button.textContent = 'Entrando…';

    try {
      await adminSignIn(email, password);
      window.location.replace('admin.html');
    } catch (error) {
      toast(errorMessage(error), 'error');
      button.disabled = false;
      button.textContent = 'Entrar no painel';
    }
  };

  button.addEventListener('click', submit);
  loginCard.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });
}
