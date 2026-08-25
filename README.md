# ❤️ Casal em Sintonia — o desafio dos casais

Jogo ao vivo no estilo Kahoot, mas com uma regra própria: **cada equipe é um casal**.
As duas pessoas respondem separadamente, cada uma no próprio celular, e o casal só
pontua quando **as duas escolhem a mesma alternativa**. Quem responde igual mais
rápido ganha mais pontos.

- `index.html` — celular dos participantes
- `display.html` — telão do projetor
- `admin.html` — painel de quem organiza (protegido por login)
- `login.html` — entrada do painel

Tudo funciona em tempo real com Firebase Realtime Database.

---

## Como o jogo funciona

1. Cada pessoa abre o site, digita o nome e entra.
2. Uma delas toca no nome do par na lista. O casal é formado na hora
   (ex.: `Karen & Brenno`).
3. Homens de um lado da igreja, mulheres do outro — ninguém vê a tela do par.
4. Quem organiza inicia a pergunta pelo painel. Ela aparece no telão e nos celulares.
5. Cada pessoa toca em uma alternativa. **Um toque registra e trava** — não existe
   botão de enviar nem como mudar a resposta.
6. Ao encerrar a rodada:
   - responderam igual → **em sintonia**, pontuam;
   - responderam diferente → 0 ponto;
   - só um respondeu (ou nenhum) → 0 ponto.
7. Entre os casais em sintonia, vale o tempo: **1º = 100 pontos, 2º = 99, 3º = 98…**
   (nunca menos de 1 ponto).

### O tempo do casal

O tempo oficial é medido **até a segunda resposta**, não a primeira:

```
tempo = (momento da 2ª resposta do casal) − (momento em que a pergunta começou)
```

Os dois momentos vêm do relógio do servidor do Firebase. O relógio do celular
nunca é usado para pontuar — só para desenhar o cronômetro na tela.

---

## Configuração passo a passo

### 1. Criar o projeto no Firebase

1. Acesse <https://console.firebase.google.com> e clique em **Adicionar projeto**.
2. Dê um nome (ex.: `casal-em-sintonia`) e conclua o assistente.

### 2. Ativar a autenticação

No menu lateral: **Criar → Authentication → Vamos começar**.

Ative dois métodos em **Sign-in method**:

- **Anônimo** — é assim que cada celular ganha uma identidade própria. Sem isso o
  jogo não funciona.
- **E-mail/senha** — é o login de quem organiza.

Depois, na aba **Users**, clique em **Adicionar usuário** e crie o seu login de
administrador (ex.: `organizador@igreja.com` + uma senha). **Copie o UID** que
aparece na lista — você vai usar no passo 5.

### 3. Criar o Realtime Database

1. Menu lateral: **Criar → Realtime Database → Criar banco de dados**.
2. Escolha a região (ex.: `us-central1` ou `southamerica-east1`).
3. Comece em **modo de teste** — as regras definitivas entram no passo 6.
4. Copie a URL que aparece no topo, algo como
   `https://casal-em-sintonia-default-rtdb.firebaseio.com`.

### 4. Preencher as credenciais no projeto

No console: **Configurações do projeto (engrenagem) → Seus apps → Web (`</>`)**.
Registre um app e copie o objeto `firebaseConfig`.

Abra `js/firebase-config.js` e substitua:

```javascript
export const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "SEU_PROJETO.firebaseapp.com",
  databaseURL: "https://SEU_PROJETO-default-rtdb.firebaseio.com",
  projectId: "SEU_PROJETO",
  storageBucket: "SEU_PROJETO.appspot.com",
  messagingSenderId: "SEU_ID",
  appId: "SEU_APP_ID"
};
```

> Essas chaves são públicas por natureza — quem protege os dados são as regras do
> banco, no passo 6.

### 5. Cadastrar o administrador no banco

No **Realtime Database → Dados**, crie manualmente:

```
admins
  └── <UID_QUE_VOCÊ_COPIOU>: true
```

Passo a passo: clique no `+` ao lado da raiz, nome do campo `admins`, depois `+`
de novo, nome `<seu UID>`, valor `true` (sem aspas, tipo booleano).

Só quem estiver aqui consegue abrir o painel, iniciar perguntas e alterar pontuação.

### 6. Publicar as regras de segurança

Copie o conteúdo de `database.rules.json` na aba **Realtime Database → Regras** e
clique em **Publicar**. Ou, pelo terminal:

```bash
npm install -g firebase-tools
firebase login
firebase use --add            # escolha seu projeto
firebase deploy --only database
```

As regras garantem que:

- ninguém edita o nome ou o casal de outra pessoa;
- ninguém responde duas vezes nem muda a resposta já registrada;
- ninguém vê a resposta dos outros durante a rodada;
- `answeredAt` é sempre o horário do servidor (`newData.child('answeredAt').val() === now`);
- pontuação, resultado e estado do jogo só mudam pelo administrador.

### 7. Cloud Functions (opcional)

O jogo já é seguro sem elas. Se quiser toda a lógica rodando no servidor
(exige o plano **Blaze**, que tem cota gratuita generosa):

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

Depois, em `js/firebase-config.js`, mude:

```javascript
useCloudFunctions: true,
functionsRegion: 'southamerica-east1'   // a mesma região do deploy
```

### 8. Rodar no computador

Módulos ES6 não funcionam abrindo o arquivo direto (`file://`). Suba um servidor
local — qualquer um destes serve:

```bash
python3 -m http.server 5173
# ou
npx serve .
# ou
firebase serve --only hosting
```

Depois acesse `http://localhost:5173`.

### 9. Publicar

**Firebase Hosting** (recomendado, já configurado no `firebase.json`):

```bash
firebase deploy --only hosting
```

**GitHub Pages** também funciona: o frontend é 100% estático. Suba a pasta para um
repositório, ative Pages em *Settings → Pages* e pronto — o Firebase continua
cuidando de Authentication, Realtime Database e Functions.
Se publicar em Pages, adicione o domínio `SEU-USUARIO.github.io` em
**Authentication → Settings → Domínios autorizados**.

---

## Antes do encontro

1. Abra `admin.html`, faça login e clique em **Carregar 20 perguntas**.
2. Ajuste, adicione ou desative perguntas à vontade (padrão: `👨 ELE` / `👩 ELA`).
3. Defina o tempo por pergunta (padrão: 20 segundos).
4. Abra `display.html` no computador do projetor.
5. Passe o link do `index.html` para os casais (um QR Code ajuda muito).
6. Todos entram e formam os casais → clique em **Iniciar jogo**.

## Durante o jogo

| Botão | O que faz |
| --- | --- |
| ▶ Iniciar jogo | Prepara a primeira pergunta e trava novas entradas |
| ▶ Iniciar pergunta | Manda a pergunta para todos e começa o cronômetro |
| ⏹ Encerrar pergunta | Trava as respostas, apura e mostra o resultado |
| ➡ Próxima pergunta | Seleciona a próxima da lista |
| 🏆 Mostrar ranking | Pula direto para o ranking geral no telão |
| 🎬 Encerrar jogo | Revela 3º, 2º e 1º lugar com suspense e confete |
| 🔄 Reiniciar partida | Zera pontos e respostas (as perguntas ficam salvas) |

Com **Encerrar sozinho no fim do tempo** ligado, a rodada é apurada
automaticamente quando o cronômetro zera.

---

## Estrutura dos dados

```
/game          status, currentQuestionId, currentRoundId, questionStartedAt,
               questionNumber, timeLimit, allowLateJoin, showRanking
/admins        <uid>: true
/participants  <uid>: { name, status, coupleId, createdAt }
/couples       <coupleId>: { coupleName, participant1, participant2, memberIds,
                             score, wins, totalResponseTime, createdAt }
/questions     <questionId>: { text, optionA, optionB, order, active }
/rounds        <roundId>: { questionId, questionNumber, startedAt, endedAt, status,
                            responses: { <uid>: { answer, answeredAt, coupleId } },
                            progress:  { <coupleId>: { <uid>: true } },
                            results:   { <coupleId>: { answer1, answer2, synchronized,
                                                       responseTime, points, position } },
                            summary }
```

`responses` guarda a alternativa escolhida e só o administrador consegue ler.
`progress` é público, mas mostra apenas **quem já respondeu** — nunca o quê.
É daí que sai o "8 de 15 casais finalizaram" no telão.

Estados do jogo: `WAITING → READY → QUESTION_ACTIVE → QUESTION_LOCKED → RESULTS → FINAL`.

---

## Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| "Sem permissão para esta ação" | Regras não publicadas, ou seu UID não está em `/admins` |
| Participante não consegue entrar | Login **Anônimo** desativado no Authentication |
| Painel volta para o login | A conta usada não está em `/admins` |
| Tela em branco ao abrir o arquivo | Abriu por `file://` — use um servidor local (passo 8) |
| "O jogo já começou" | Normal com o jogo em andamento; libere em *Aceitar quem chegou depois* |
| Cronômetros diferentes entre celulares | Verifique a conexão: o horário vem do servidor, não do aparelho |

---

## Checklist de teste (faça antes do encontro)

Abra o `index.html` em duas abas anônimas diferentes e confira:

- [ ] Dois participantes formam um casal e o nome fica `Quem escolheu & Escolhido`
- [ ] O escolhido some da lista de disponíveis
- [ ] Atualizar a página não cria um participante novo
- [ ] A resposta é registrada com um toque, sem botão de enviar
- [ ] Depois de responder, as duas alternativas ficam travadas
- [ ] Ninguém vê a resposta do par antes do resultado
- [ ] Respostas iguais pontuam; diferentes ou incompletas dão 0
- [ ] O casal correto mais rápido recebe 100, o seguinte 99, o seguinte 98
- [ ] O ranking do telão atualiza sozinho
- [ ] Reiniciar a partida zera os pontos e mantém as perguntas
