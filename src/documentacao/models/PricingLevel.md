# Tabela `pricing_levels`

**Propósito:** tabelas comerciais separando minuto **Texto+Voz** vs **Vídeo**. Todos os valores monetários usam `DECIMAL(14,4)`.

---

| Campo | Tipo | Regra |
|-------|------|-------|
| `code` | String | **Sem `unique` simples na coluna** — índice parcial `pricing_levels_code_deleted_at_null_uidx` impede colisão apenas entre linhas vivas. |
| `price_text_voice`, `price_video` | DECIMAL(14,4) | Preço por minuto com quatro casas para evitar drift em centavos fracionados. |
