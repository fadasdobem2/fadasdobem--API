# `src/models/legado`

Models do **banco legado** (ASP32, MySQL/MariaDB) e das tabelas novas `gf_*`, em conexão **separada** do PostgreSQL.
Explicação completa em `src/gestao-fadas/README.md`.

- `tabelas/`: 19 tabelas legadas, **somente leitura** (geradas; não editar).
- `novas/`: 13 tabelas `gf_*` ligadas ao legado por ID (geradas; hoje somente leitura).
- `associations.js`: ligações lógicas entre legado e novo.
- `connection.js` / `somente-leitura.js`: conexão sob demanda e travas contra escrita.
- Nenhuma tabela legada é alterada. Dado novo = tabela nova.
- Regenerar: `npm run gerar:legado`. Verificar (offline): `npm run verificar:legado`.
