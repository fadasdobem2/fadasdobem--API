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

`GET /api/payments/accounts?ids=...` reconhece a identidade de `gf_clientes_novos` quando a leitura nova está habilitada. Pedidos mistos separam IDs novos e legados; nenhum ID da faixa nova é procurado no MySQL. A conta reutiliza o cálculo existente do PostgreSQL: abertura pela planilha de migração, ou zero na ausência dela, sem criar planilha nem congelar saldo durante a leitura. Pagamentos e benefícios usam o verificador existente do cadastro; recebimentos persistem, atualizam o saldo e mantêm auditoria e idempotência. O histórico financeiro do ASP é vazio por origem para IDs novos e não é consultado. Assim, uma queda do legado não bloqueia a conta de uma cliente nova já cadastrada; a conta de cliente antiga continua exigindo o histórico legado disponível.

Recebimentos de clientes novas ficam somente no PostgreSQL, inclusive quando as flags de espelho estão ligadas. A API registra `nao_espelhada` com o motivo. A confirmação também não escreve no legado. Se um recebimento antigo já espelhado for corrigido para uma cliente nova, o vínculo antigo é marcado `desatualizada`, sem editar o ASP.

## Tarólogos da ficha: percentual de retorno

`GET /api/catalog/tarologists/return-metrics` atende a ordenação **Mais retorno** da ficha real. A rota integra a lista de Cadastros já montada pelo gate da API A em `/api`; não depende de uma rota nova no processo Next/Node histórico. Usa a sessão e a permissão `canViewTarologists` existentes, com recusa de taróloga e sessão ausente. Requer `GF_FATIA_CADASTROS=true` e `GF_NOVOS_DADOS=postgres`; pode ser lida com a escrita desligada.

O servidor lê o histórico do legado e do PostgreSQL, remove espelhos pelo vínculo explícito e aplica o mesmo fallback por cliente, profissional e minuto do front. Reutiliza `sessoesDe`/`linhasPorProfissional`: continuações e complementos pertencem à sessão de origem; uma cliente retorna quando já havia encerrado outra sessão com a mesma profissional até o início da seguinte, inclusive no mesmo dia. Estados que não contam como atendimento continuam excluídos. Não há mudança de regra financeira.

A resposta contém apenas `readAt`, `generatedAt`, `complete: true`, `metric: "returning_clients_percentage"`, `periodStart`, `periodEnd` e `rows` com `tarologistId`, `clients`, `returningClients`, `returnPercentage`. Não envia IDs de clientes ou históricos ao navegador. Profissional sem sessão fica ausente, em vez de receber zero inventado. O período cobre todas as sessões disponíveis até o dia operacional atual. O cache completo dura até 60 segundos; uma falha de fonte no recarregamento ou mais de um milhão de registros em qualquer fonte recusa o agregado com 503, sem percentual parcial. Não há gravação no legado.

## Aplicação por Patrick

1. Aplicar este conjunto sobre a base indicada e instalar as dependências pelo lockfile existente.
2. Executar o runner normal de migrações no PostgreSQL novo. A migração `20261217000000-gestao-fadas-cadastro-manual.js` acrescenta origem `manual` ao CHECK, amplia o nome completo para 255 e alinha o nascimento mínimo 1000 ao editor existente. Não altera MySQL. Depende das migrações já versionadas, inclusive v708 e notas/ficha.
3. Confirmar `GF_NOVOS_DADOS=postgres`, `GF_FATIA_CADASTROS=true`, `GF_FATIA_CLIENTES=true`, `GESTAO_FADAS_ESCRITA_ENABLED=true` e `GF_CLIENTES_NOVOS_LEITURA` diferente de `false`. Para observações: `GF_FATIA_FICHA=true`; para conta e recebimentos: `GF_FATIA_PAGAMENTOS=true`, mantendo as regras financeiras habilitadas. Usar sessão nativa e `FADAS_ORIGIN` de homologação conforme a implantação existente.
4. Manter as credenciais do legado somente leitura e `GF_LEGADO_ESCRITA_ENABLED=false` na homologação especificada. Criação e edição de ID novo não utilizam o espelho, mesmo que suas flags estejam ligadas.
5. Subir a API antes de habilitar a interface atualizada. Validar com cliente fictícia: criar, buscar, abrir ficha, reler nota e editar o mesmo ID.

Não exige ligar flags ou configurar token/conta da Lilly. A criação manual é parte de Cadastros, não tem um novo interruptor separado.

## Verificação local

`npm run verificar:gf-cadastro-manual -- --offline`: HTTP com SQL bloqueado, sessão, perfil, origem, método, JSON e validações.

`npm run verificar:gf-cadastro-manual`: PostgreSQL descartável local `fdb_*`, migrações, HTTP, idempotência/concorrência, duplicidade, notas/rollback e criar-listar-abrir-editar. Inclui conta da cliente nova, consulta mista, flags, permissões, legado indisponível, pagamento com regras estritas, confirmação, saldo relido, repetição sem duplicação e ausência de espelho. Usa o helper de banco descartável existente (`PG_BIN_DIR`, `USER` locais); não aponta a homologação ou produção.

O roteiro também verifica o agregado de retorno com linhas do PostgreSQL real e legado fictício, falha de cada fonte, perfis, flags e ausência de escrita. O ouro de 75 cenários é gerado por `node scripts/gerar-ouro-gf-retorno-clientes.js --front=/pasta/do/painel`, executando `mergeConsultations`, `buildSessionMetricIndex` e `ownSessionMetrics` do front; o arquivo registra os hashes das fontes. Cobertura: retorno no mesmo dia, sobreposição, continuações, complemento, origem anulada, ciclo, espelho, horários históricos e consulta em curso. Os casos e as comparações com o ouro rodam normalmente sem uma cópia do front.

Opcionalmente, `GF_RETORNO_FRONT=/pasta/do/painel` acrescenta ao roteiro descartável a prova do wrapper real `call()` e do parser do front: caminho same-origin `/api/catalog/tarologists/return-metrics` atravessa o gate HTTP até o agregado, com respostas 200, 403 e 401. Só o transporte aponta para o servidor local e a identidade vem do provedor fictício do harness; isso não é validação de credenciais de homologação ou produção.

Com `GF_FINANCEIRO_FRONT=/pasta/do/painel` (ou o mesmo `GF_RETORNO_FRONT`), o roteiro também cria duas clientes e financia a origem exclusivamente por HTTP. Executa `transferClientBalance`, `prepareRealTransferChange`, `sendPaymentChange` e `confirmRealTransferPersistence` reais do front contra o gate/PostgreSQL: R$ 88,80 de crédito regular são repartidos em R$ 44,40 e 15 minutos para cada conta. Confere o saldo pela API, a conservação do recebimento original, autorização preservada, versão e auditoria; repete o mesmo corpo e `operationKey` e prova ausência de duplicação. SQL é usado somente para ler contagens de eventos/auditoria. O fluxo entre as duas clientes novas não consulta nem escreve no legado.

Alternativa sem servidor instalado: `PG_EMBEDDED_BIN_DIR=/caminho/dos/binarios npm run verificar:gf-cadastro-manual`. O runner inicia `initdb`/`postgres` locais temporários, executa o roteiro e remove banco e cluster. Não requer instalar esse pacote no produto.
