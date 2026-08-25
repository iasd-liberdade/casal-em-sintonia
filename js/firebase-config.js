/* =========================================================
   CONFIGURAÇÃO DO FIREBASE
   Substitua os valores abaixo pelos do seu projeto.
   Console Firebase > Configurações do projeto > Seus apps > Web
   ========================================================= */
export const firebaseConfig = {
  apiKey: "AIzaSyAHiRj9Zx6SJ7M0uI0bx5vfUibgAH0WzUw",
  authDomain: "casal-em-sintonia.firebaseapp.com",
  databaseURL: "https://casal-em-sintonia-default-rtdb.firebaseio.com",
  projectId: "casal-em-sintonia",
  storageBucket: "casal-em-sintonia.firebasestorage.app",
  messagingSenderId: "611678250131",
  appId: "1:611678250131:web:3005f4075a81a50aecd966"
};

/* =========================================================
   OPÇÕES DO APLICATIVO
   ========================================================= */
export const APP_CONFIG = {
  /**
   * false  -> o app fala direto com o Realtime Database.
   *           Funciona no plano gratuito (Spark). As regras de
   *           segurança em database.rules.json garantem que ninguém
   *           altere pontuação, respostas de terceiros ou o jogo.
   *
   * true   -> o app usa as Cloud Functions em functions/index.js.
   *           Exige plano Blaze. Toda a lógica sensível roda no servidor.
   *
   * Nos dois modos o jogo funciona igual para quem está jogando.
   */
  useCloudFunctions: false,

  /** Região das Cloud Functions (use a mesma do deploy). */
  functionsRegion: 'southamerica-east1',

  /** Tempo padrão de cada pergunta, em segundos. O admin pode mudar. */
  defaultTimeLimit: 20,

  /** Versão do formato de dados guardado no navegador. */
  storageVersion: 'v1'
};
