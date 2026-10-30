# Regras de negócio — referência única (Nice / Fadas do Bem)

Documento normativo para **produto + engenharia**. Complementa o código em `src/features/*` e `src/config/business.config.js`. Quando o código e este ficheiro divergirem, **o código prevalece** até actualizar aqui.

---

## 1. Dois trilhos de conversão (não misturar)

### Trilho A — Site (cliente web)

1. Cliente navega na vitrine, pode montar **carrinho** (contexto de checkout com especialista/pacote).
2. **Login ou registo** via `POST /api/v1/auth/login` e `POST /api/v1/auth/register` (senha + e-mail + aceite de termos por versão).
3. **Regra de ouro (R1):** nesta fase o backend **não** deve criar **reserva bloqueada** da taróloga só porque o utilizador criou sessão autenticada ou passou pelo login com ítem no carrinho. Duas pessoas na mesma página de login com a mesma taróloga “no carrinho” **ambas** seguem; o fecho competitivo ocorre **após confirmação de pagamento** (webhook Mercado Pago / fluxo económico já implementado no serviço de pagamentos).
4. Checkout transparente (`POST /api/v1/payments/pix` ou `/card`) e webhook MP materializam reserva económica / mutex onde o modelo de negócio exige.

### Trilho B — WhatsApp (Lead FSM + Evolution)

1. Cliente conversa no WhatsApp; fluxo pode incluir **PIX no próprio canal** e webhook MP.
2. **Não** passa obrigatoriamente por e-mail/senha no primeiro momento — desenho de produto: **magic link** (link curto, expira, entrega sessão web). Ver secção 4 (estado de implementação).
3. Conversão de lead: `convertLeadToClient` em `auth.service.js` quando o produto exige conta `User` + `Client` ligada ao Chatwoot (detalhes em [README](./README.md) secção Leads).

---

## 2. Cadastro progressivo (cliente site)

- **Registo inicial** (`POST /api/v1/auth/register`): corpo mínimo no serviço — `email`, `password`, `accepted_terms_version` (string não vazia). **Não** exige nome legal, data de nascimento nem CPF nesta rota.
- Complemento de perfil: `GET/PATCH /api/v1/auth/me` com JWT válido (hoje entregue via **cookie** httpOnly, não via header Bearer no browser).
- Campos adicionais (nome, `data_nascimento`, etc.) seguem regras do `auth.service` / modelo `Client` nas rotas autenticadas.

---

## 3. Termos de uso

- No registo: `accepted_terms_version` obrigatório; persistem `accepted_terms_at` e `accepted_terms_version` no `User`.
- **Re-aceite** quando a versão legal mudar: regra de produto parcial — ver [BACKLOG_FASE_2.md](./BACKLOG_FASE_2.md) ISSUE-Auth-07.

---

## 4. Magic link (WhatsApp → sala sem senha)

**Especificação de produto (T8/T9):** após pagamento no WhatsApp, o sistema emite um **token de curta duração**; o link `https://…/c/<token>` abre a sessão já autenticada na sala.

**Estado na API hoje:**

- O modelo `sessions` inclui colunas `magic_link_token` e `magic_link_expires_at` (ver [models/Session.md](./models/Session.md)).
- **Não** existe ainda rota HTTP dedicada de consumo do magic link nem página `app/.../c/[token]` no front documentada aqui — o fluxo end-to-end **não** está fechado só com a documentação antiga; implementação futura deve acrescentar rota em `auth` ou `sessions` + doc neste ficheiro.

---

## 5. `next_step` / `intent` / carrinho (site)

Algumas especificações de produto pedem que a resposta de login/registo inclua `next_step` (`cadastro_completar` | `pagamento` | `home_cliente`) conforme `has_cart` / `intent`.

**Estado no código hoje:** o `auth.service` **não** lê nem devolve estes campos — o front, se precisar, deve inferir do estado do carrinho em memória ou uma rota dedicada ainda a definir. Quando implementado, actualizar [features/Auth.md](./features/Auth.md) e este documento.

---

## 6. Reserva de especialista e mutex

- **Redis mutex** (`specialist_mutex:{id}`) e reserva económica aparecem em fluxos de **pagamento confirmado** e **entrada em fila** (`POST /queues`) conforme README raiz — não confundir com “reserva só por registo”.
- Parâmetros (`CLIENT_RESERVATION_MINUTES`, etc.): `business.config.js` + `.env.example`.

---

## 7. Telecom em tempo real

- **Canal web RTC:** Agora.io (`GET /api/v1/sessions/:id/token`, webhook NCS `POST /api/v1/sessions/agora-webhook`).
- **Intelbras WideVoice:** módulo `features/telecom` **desativado** para produção de fluxo principal; ver `src/features/telecom/DESATIVADO.md`. Não documentar como caminho activo para novas integrações.

---

## 8. Segurança transversal (API actual)

- **Cookies httpOnly** para access e refresh JWT; **SameSite strict**; prefixo `__Secure-` em paths definidos em `auth.cookies.helper.js`.
- **CSRF** double-submit em `POST/PUT/PATCH/DELETE` sob `/api/*`, com excepções apenas para webhooks assinados (Chatwoot, Mercado Pago, Agora NCS).
- **CORS** com `credentials: true` e lista fechada de origins (`CORS_ORIGINS`).

---

*Manter este documento quando fechar magic link ou `next_step` no código.*
