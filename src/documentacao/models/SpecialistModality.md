# Tabela `specialist_modalities`

**Propósito:** catálogo de modalidades disponíveis por especialista (Texto/Voz/Vídeo). Pivot leve garante relatórios e matching com filas.

---

| Campo | Tipo | Nulo |
|-------|------|------|
| `id` | UUID | Não |
| `specialist_id` | UUID | Não |
| `modality` | Enum TEXTO \| VOZ \| VIDEO | Não |

Índice único `[specialist_id, modality]` evita linhas repetidas.
