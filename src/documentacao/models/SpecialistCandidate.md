# Tabela `specialist_candidates`

**Propósito:** funil de recrutamento de tarólogas **separado** de `specialists` operacionais. Reprovadas e arquivadas permanecem aqui — nunca poluem a vitrine.

**Conversão:** `POST /admin/specialist-candidates/:id/gerar-perfil` cria `users` + `specialists(PENDING)`; `POST …/ativar` aprova na vitrine.

| Coluna | Tipo | Observação |
|--------|------|------------|
| `estado` | enum | `nova`, `em_analise`, `aprovada`, `em_onboarding`, `reprovada`, `arquivada` |
| `triagem` | enum | `pendente`, `em_espera` (só quando `estado=nova`) |
| `f1`, `proc`, `convite`, `onb`, `f2`, `f2_original` | JSONB | Espelho do mock admin G20a |
| `onboarding_token` | string | Link F2 público |
| `specialist_id`, `user_id` | UUID nullable | Preenchidos após gerar perfil |

Ver também: `specialist_private_profiles`, feature `src/features/specialist-candidates/`.
