# Documentação dos *middlewares* (`src/middlewares/`)

Encadeamento Express transversal: **CORS + `cookie-parser`**, **CSRF** em mutações sob `/api`, autenticação JWT via **cookie** access, papéis **CLIENTE** / **TARÓLOGA**, limites de taxa de Auth, assinatura Mercado Pago, 404 e tratamento global de erros.

| Documento | Conteúdo |
|-----------|----------|
| [Registo_Middlewares.md](./Registo_Middlewares.md) | Ficheiro a ficheiro: responsabilidade, ordem típica, env |

**Ordem real em `app.js`:** `helmet` → `cors` (`credentials: true`, origins `CORS_ORIGINS`) → `express.json` → **`cookieParser()`** → `morgan` → estáticos → **`/api` + `doubleCsrfProtection` + `routes`**.

Montagem de rotas versionadas: `src/routes/index.js` e `src/features/*/*.routes.js`.
