# Tabela `specialist_oracles`

**Propósito:** N:M especialista ⇄ catálogo de oráculos. Permite atributos de vitrine contextualizados (“10 anos usando X”).

---

| Campo | Tipo | Nulo |
|-------|------|------|
| `id` | UUID | Não |
| `specialist_id` | UUID | Não |
| `oracle_id` | UUID | Não |
| `years_using` | SMALLINT | Sim |

Unicidade composta garante apenas uma linha por par.
