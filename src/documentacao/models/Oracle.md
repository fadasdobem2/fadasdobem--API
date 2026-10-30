# Tabela `oracles`

**Propósito:** catálogo editorial de decks/oráculos vinculáveis ao perfil público das tarólogas.

---

| Campo | Observação |
|-------|-----------|
| `slug` | **Sem UNIQUE simples.** Índice parcial garante unicidade apenas enquanto `deleted_at IS NULL`. |
