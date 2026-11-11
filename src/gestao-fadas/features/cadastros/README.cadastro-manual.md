# Cadastro manual de clientes

Contrato adicionado sobre a base `4ab5b32821ddc90627b2f45034fe196c20aaefe8`.

`POST /api/catalog/clients` usa a sessão da equipe, a capacidade `canCreateClients`, JSON e a origem permitida (`FADAS_ORIGIN`, ou a própria origem no ambiente local). Não usa credencial Lilly, conversa, contato ou usuário de serviço.

## Pedido e resposta

Corpo: `{operationKey, changes, duplicateReviewToken?, initialNote?:{text, formatting?}}`.

- `changes` reutiliza as validações do PATCH: `name` (identificação), `fullName`, `treatAs`, `birthDate` (`dd/mm/aaaa`), `email`, `email2`, `noEmail`, `cpf`, `workPhone`, `phones`, `consultationPhoneIndex`, `whatsappPhoneIndex`, `address` e `paymentProfile`.
- Nome completo e pelo menos um telefone válido são obrigatórios. A identificação omitida recebe a sugestão já usada pelo formulário. Campos opcionais desconhecidos devem ser omitidos, nunca preenchidos por dados fictícios.
- O cadastro começa Pré-pago. Não cria saldo, pagamento, agenda ou consulta. `whatsapp`, quando enviado, precisa coincidir com o telefone escolhido.
- Telefones e índices usam a validação existente; preserve as escolhas explícitas do formulário. Os limites do editor continuam: nome completo 255, identificação/tratar por 50, e-mail 50, outro e-mail 100 e até 20 telefones.
- Observação inicial usa o domínio existente de notas (texto até 4000, formatação validada), autor e relógio do servidor. É gravada na mesma transação. Exige a fatia Ficha habilitada; não é enviada ao legado.

Sucesso 200: `{readAt, clientId, extension, initialNote?}`. `clientId` é texto decimal de 1000000000 a 2147483647, `extension.revision=1`. A extensão é recortada pelo perfil da sessão, como no PATCH. Repetir a mesma operação devolve a mesma resposta, inclusive nota e ID; mudar os dados com a mesma chave retorna 409 `OPERATION_KEY_CONFLICT`.

Possível duplicidade retorna 409 `{error:{code:'CLIENT_DUPLICATE_REVIEW',message},duplicateReview:{token,blockedByCpf,candidates:[{clientId,name,reasons}]}}`. Motivos: `cpf`, `whatsapp`, `email`, `name` ou `nameBirth`. Mesmo CPF impede criar outro ID. Nos outros casos, a equipe pode confirmar cadastro distinto reenviando `duplicateReviewToken`; os candidatos são conferidos novamente dentro da transação. Mudanças nos dados/candidatos/autor invalidam a confirmação. Falha na leitura das fontes impede gravar; nunca equivale a ausência de duplicidade.

## Persistência e leitura

`gf_clientes_novos` emite o ID pela sequência existente; `gf_clientes_ext` guarda a ficha, situação cadastral e revisão. A origem física e o DTO usam `manual`. Não são criadas ações, vínculos ou conversas Lilly. A auditoria registra a conta real da sessão. As chaves idempotentes e todos os efeitos compartilham a transação. A trava de criação é a mesma da Lilly.

Cliente nova aparece na lista/busca, abre em `/api/operations/clients/:id` e continua editável no PATCH existente. Telefones adicionais participam da busca e as escolhas gravadas prevalecem. Saldo legado permanece desconhecido. As notas são lidas em `GET /api/client-notes?clientId=...`; IDs novos não consultam notas do legado.

## Aplicação por Patrick

1. Aplicar este conjunto sobre a base indicada e instalar as dependências pelo lockfile existente.
2. Executar o runner normal de migrações no PostgreSQL novo. A migração `20261217000000-gestao-fadas-cadastro-manual.js` acrescenta origem `manual` ao CHECK, amplia o nome completo para 255 e alinha o nascimento mínimo 1000 ao editor existente. Não altera MySQL. Depende das migrações já versionadas, inclusive v708 e notas/ficha.
3. Confirmar `GF_NOVOS_DADOS=postgres`, `GF_FATIA_CADASTROS=true`, `GF_FATIA_CLIENTES=true`, `GESTAO_FADAS_ESCRITA_ENABLED=true` e `GF_CLIENTES_NOVOS_LEITURA` diferente de `false`. Para observações: `GF_FATIA_FICHA=true`. Usar sessão nativa e `FADAS_ORIGIN` de homologação conforme a implantação existente.
4. Manter as credenciais do legado somente leitura e `GF_LEGADO_ESCRITA_ENABLED=false` na homologação especificada. Criação e edição de ID novo não utilizam o espelho, mesmo que suas flags estejam ligadas.
5. Subir a API antes de habilitar a interface atualizada. Validar com cliente fictícia: criar, buscar, abrir ficha, reler nota e editar o mesmo ID.

Não exige ligar flags ou configurar token/conta da Lilly. A criação manual é parte de Cadastros, não tem um novo interruptor separado.

## Verificação local

`npm run verificar:gf-cadastro-manual -- --offline`: HTTP com SQL bloqueado, sessão, perfil, origem, método, JSON e validações.

`npm run verificar:gf-cadastro-manual`: PostgreSQL descartável local `fdb_*`, migrações, HTTP, idempotência/concorrência, duplicidade, notas/rollback e criar-listar-abrir-editar. Usa o helper de banco descartável existente (`PG_BIN_DIR`, `USER` locais); não aponta a homologação ou produção.

Alternativa sem servidor instalado: `PG_EMBEDDED_BIN_DIR=/caminho/dos/binarios npm run verificar:gf-cadastro-manual`. O runner inicia `initdb`/`postgres` locais temporários, executa o roteiro e remove banco e cluster. Não requer instalar esse pacote no produto.
