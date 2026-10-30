'use strict';

// Fonte: g33c / mockData front

// Auto-extracted from g33a_Permissoes_Desktop.html

const PERMISSION_AREAS =[
  {id:'chat', nome:'Chat', ico:'ph-chats-circle', cor:'v-teal', perms:[
    {id:'chat.trabalhar', nome:'Trabalhar no chat', desc:'ver, responder, transferir taróloga e encerrar conversa'},
    {id:'chat.rapidas_time', nome:'Editar respostas rápidas do time', desc:'os textos prontos que a equipe toda usa'},
    {id:'chat.rapidas_aprovar', nome:'Aprovar respostas rápidas', desc:'liberar texto novo pro time'},
    {id:'chat.ver_grupo', nome:'Ver as conversas do meu grupo', desc:'o fluxo de atendimento do setor (atendente e supervisora com cliente) — para coordenar e assumir. NÃO inclui conversa privada de ninguém nem taróloga com cliente'},
  ]},
  {id:'consultas', nome:'Consultas', ico:'ph-headset', cor:'v-blue', perms:[
    {id:'consultas.ver', nome:'Ver consultas e histórico', desc:'sessões de agora e as passadas'},
    {id:'consultas.fila', nome:'Organizar a fila', desc:'encaixe, prioridade, ordem'},
    {id:'consultas.trocar', nome:'Trocar taróloga da consulta', desc:'remanejar uma sessão'},
    {id:'consultas.encerrar', nome:'Encerrar consulta à força', desc:'cortar a sessão ao vivo — ex.: viu que a cliente estornou'},
    {id:'consultas.ajustar_tempo', nome:'Ajustar o tempo cobrado', desc:'corrigir os minutos quando o contador falha (a chamada caiu, travou)'},
    {id:'consultas.cancelar_cobranca', nome:'Cancelar a cobrança', desc:'não cobrar aquela consulta'},
    {id:'consultas.bonus', nome:'Dar bônus', desc:'crédito de minutos ou desconto de compensação'},
  ]},
  {id:'clientes', nome:'Clientes', ico:'ph-user-circle', cor:'v-pink', perms:[
    {id:'clientes.buscar', nome:'Buscar cliente', desc:'achar por nome, telefone, email ou CPF — uma de cada vez'},
    {id:'clientes.ver', nome:'Ver ficha da cliente', desc:'contato, saldo, recados e as 5 últimas consultas'},
    {id:'clientes.listar', nome:'Ver a base inteira', desc:'rolar todas as clientes — varredura, risco de vazamento em massa'},
    {id:'clientes.editar', nome:'Editar cadastro da cliente', desc:'corrigir dados, aplicar etiquetas (vip, alerta)'},
    {id:'clientes.cpf_completo', nome:'Ver CPF e endereço completos', desc:'sem isto, o CPF aparece mascarado (123.***.**-09)'},
    {id:'clientes.historico_completo', nome:'Ver histórico completo', desc:'além das 5 últimas — pede a senha de novo e fica registrado (quem, quando)'},
    {id:'clientes.bloquear', nome:'Bloquear cliente', desc:'impedir o acesso dela'},
    {id:'clientes.juntar', nome:'Juntar contas repetidas', desc:'unir dois cadastros'},
  ]},
  {id:'tarologas', nome:'Tarólogas', ico:'ph-moon-stars', cor:'v-red', perms:[
    {id:'tarologas.ver', nome:'Ver tarólogas', desc:'perfis, quem está online, escala'},
    {id:'tarologas.editar', nome:'Editar e aprovar perfil', desc:'dados, escala e liberar mudança pro site'},
    {id:'tarologas.ativar', nome:'Ativar ou tirar do site', desc:'publicar e remover'},
    {id:'tarologas.aprovar_cand', nome:'Aprovar candidata', desc:'aceitar e liberar acesso'},
    {id:'tarologas.comissao', nome:'Ver e editar comissão', desc:'o percentual da taróloga'},
  ]},
  {id:'agenda', nome:'Agenda e Avisos', ico:'ph-calendar-dots', cor:'v-orange', perms:[
    {id:'agenda.editar', nome:'Cuidar da agenda e avisos', desc:'ver, marcar, remarcar, responder avisos'},
  ]},
  {id:'dinheiro', nome:'Dinheiro', ico:'ph-hand-coins', cor:'v-green', perms:[
    {id:'dinheiro.recebimentos', nome:'Ver recebimentos', desc:'o que as clientes pagaram — quem, quanto, quando'},
    {id:'dinheiro.estornar', nome:'Estornar pagamento', desc:'devolver à cliente, até o teto'},
    {id:'dinheiro.aprovar_estorno', nome:'Aprovar estorno acima do teto', desc:'liberar devolução alta'},
    {id:'dinheiro.conciliar', nome:'Conciliar com o banco', desc:'bater recebimentos com o extrato (Mercado Pago)'},
    {id:'dinheiro.nf', nome:'Emitir nota fiscal', desc:'gerar a nota'},
    {id:'dinheiro.pagamentos', nome:'Ver e lançar pagamentos', desc:'contas e fornecedores que a empresa paga'},
    {id:'dinheiro.pagar_tarologas', nome:'Pagar tarólogas', desc:'fazer o repasse das comissões'},
    {id:'dinheiro.folha', nome:'Folha de pagamento', desc:'salários da equipe interna — sensível'},
    {id:'dinheiro.saldo_total', nome:'Ver o saldo total da empresa', desc:'quanto a empresa tem no total — sensível'},
    {id:'dinheiro.faturamento', nome:'Ver o faturamento', desc:'quanto entrou no dia e no mês — sensível'},
    {id:'dinheiro.precos', nome:'Editar preços e pacotes', desc:'mexe na receita'},
  ]},
  {id:'conteudo', nome:'Conteúdo', ico:'ph-newspaper', cor:'v-gold', perms:[
    {id:'conteudo.ver', nome:'Ver conteúdo', desc:'blog, horóscopo, e-mails'},
    {id:'conteudo.escrever', nome:'Escrever conteúdo', desc:'criar e editar em rascunho'},
    {id:'conteudo.publicar', nome:'Publicar no ar', desc:'soltar pro público'},
    {id:'conteudo.newsletter', nome:'Disparar newsletter', desc:'enviar pra base inteira'},
  ]},
  {id:'aquisicao', nome:'Aquisição', ico:'ph-megaphone', cor:'v-orange', perms:[
    {id:'aquisicao.ver', nome:'Ver os anúncios', desc:'gasto, conversões, custo por lead'},
    {id:'aquisicao.lancar', nome:'Lançar gasto na mão', desc:'digitar número que não veio sozinho'},
  ]},
  {id:'relatorios', nome:'Relatórios', ico:'ph-chart-line', cor:'v-teal', perms:[
    {id:'relatorios.ver', nome:'Ver relatórios de operação', desc:'volume de atendimento, clientes, tarólogas'},
    {id:'relatorios.producao', nome:'Ver a produção total', desc:'ex.: quantos minutos o atendimento fez no mês — consolidado'},
  ]},
  {id:'ajustes', nome:'Ajustes do sistema', ico:'ph-sliders', cor:'v-blue', perms:[
    {id:'ajustes.regras', nome:'Editar horários e regras', desc:'tempos, janelas, disponibilidade'},
    {id:'ajustes.bot', nome:'Editar mensagens do bot', desc:'os textos automáticos'},
    {id:'ajustes.integracoes', nome:'Ligar integrações', desc:'WhatsApp, pagamento, vídeo — técnico'},
  ]},
  {id:'usuarios', nome:'Usuários e Papéis', ico:'ph-shield-check', cor:'v-gold', perms:[
    {id:'usuarios.criar', nome:'Criar usuário', desc:'convidar gente nova'},
    {id:'usuarios.editar', nome:'Editar usuário', desc:'mudar dados, papel, setor, cargo'},
    {id:'usuarios.excluir', nome:'Desativar usuário', desc:'tirar o acesso'},
    {id:'papeis.criar', nome:'Criar papel', desc:'novo conjunto de permissões'},
    {id:'papeis.editar', nome:'Editar papel', desc:'mudar o que um papel pode'},
    {id:'papeis.excluir', nome:'Excluir papel', desc:'apagar um papel'},
    {id:'auditoria.ver', nome:'Ver auditoria', desc:'quem fez o quê, quando, de onde'},
  ]},
];

// ===== papéis (com permissões marcadas) =====
let INITIAL_ROLES =[
  {id:'atendente', nome:'Atendimento', ico:'ph-headset', g:'linear-gradient(135deg,#7fd4dd,#00a8b5)', pessoas:5, sistema:false,
   perms:{'chat.trabalhar':1,'dinheiro.recebimentos':1,'dinheiro.estornar':1,'consultas.encerrar':1,'consultas.ajustar_tempo':1,'consultas.cancelar_cobranca':1,'consultas.bonus':1,'consultas.ver':1,'consultas.fila':1,'clientes.buscar':1,'clientes.ver':1,'clientes.historico_completo':1,'agenda.editar':1}},
  {id:'supervisora', nome:'Supervisão', ico:'ph-user-gear', g:'linear-gradient(135deg,#f6c66b,#f39c12)', pessoas:2, sistema:false,
   perms:{'chat.trabalhar':1,'consultas.encerrar':1,'consultas.ajustar_tempo':1,'consultas.cancelar_cobranca':1,'consultas.bonus':1,'consultas.ver':1,'consultas.fila':1,'clientes.buscar':1,'clientes.ver':1,'clientes.historico_completo':1,'agenda.editar':1,'chat.rapidas_time':1,'chat.rapidas_aprovar':1,'chat.ver_grupo':1,'consultas.trocar':1,'consultas.cancelar_cobranca':1,'clientes.editar':1,'clientes.cpf_completo':1,'clientes.bloquear':1,'clientes.juntar':1,'dinheiro.recebimentos':1,'dinheiro.estornar':1}},
  {id:'financeiro', nome:'Financeiro', ico:'ph-hand-coins', g:'linear-gradient(135deg,#a9d66b,#6a9900)', pessoas:0, sistema:false,
   perms:{'dinheiro.recebimentos':1,'dinheiro.estornar':1,'dinheiro.conciliar':1,'dinheiro.nf':1,'dinheiro.pagamentos':1,'dinheiro.pagar_tarologas':1,'tarologas.comissao':1,'relatorios.ver':1}},
  // Perfil "assistente" do Gestão Fadas (suspiro): na B, "Financeiro é a Assistente" (docs/banco/20_Campos_Integracao_v584.md, seção 6).
  // Só as permissões que as rotas de LEITURA do módulo src/gestao-fadas exigem (consultas, clientes, tarólogas, recebimentos, repasse).
  {id:'assistente', nome:'Assistente (Gestão Fadas)', ico:'ph-hand-coins', g:'linear-gradient(135deg,#9bd0a5,#3f8f5a)', pessoas:0, sistema:false,
   perms:{'consultas.ver':1,'clientes.buscar':1,'clientes.ver':1,'tarologas.ver':1,'dinheiro.recebimentos':1,'dinheiro.pagar_tarologas':1}},
  {id:'financeiro_senior', nome:'Financeiro Pleno', ico:'ph-vault', g:'linear-gradient(135deg,#5a8200,#3e5a00)', pessoas:0, sistema:false,
   perms:{'dinheiro.recebimentos':1,'dinheiro.estornar':1,'dinheiro.conciliar':1,'dinheiro.nf':1,'dinheiro.pagamentos':1,'dinheiro.pagar_tarologas':1,'tarologas.comissao':1,'relatorios.ver':1,'dinheiro.aprovar_estorno':1,'dinheiro.folha':1,'dinheiro.saldo_total':1,'dinheiro.faturamento':1,'relatorios.producao':1}},
  {id:'marketing', nome:'Marketing', ico:'ph-megaphone', g:'linear-gradient(135deg,#e8c86b,#c8a23a)', pessoas:0, sistema:false,
   perms:{'aquisicao.ver':1,'aquisicao.lancar':1,'relatorios.ver':1}},
  {id:'social', nome:'Social', ico:'ph-share-network', g:'linear-gradient(135deg,#ff9db3,#e8508a)', pessoas:0, sistema:false,
   perms:{'conteudo.ver':1,'conteudo.escrever':1,'conteudo.publicar':1,'conteudo.newsletter':1,'relatorios.ver':1}},
  {id:'gestora', nome:'Gestão', ico:'ph-crown', g:'linear-gradient(135deg,#ff8fb1,#e52444)', pessoas:1, sistema:false,
   perms:{'chat.trabalhar':1,'chat.rapidas_time':1,'chat.rapidas_aprovar':1,'chat.ver_grupo':1,'consultas.ver':1,'consultas.fila':1,'consultas.trocar':1,'consultas.cancelar_cobranca':1,'clientes.buscar':1,'clientes.ver':1,'clientes.listar':1,'clientes.historico_completo':1,'clientes.editar':1,'clientes.cpf_completo':1,'clientes.bloquear':1,'clientes.juntar':1,'tarologas.ver':1,'tarologas.editar':1,'tarologas.ativar':1,'tarologas.aprovar_cand':1,'tarologas.comissao':1,'agenda.editar':1,'dinheiro.recebimentos':1,'dinheiro.estornar':1,'dinheiro.aprovar_estorno':1,'dinheiro.conciliar':1,'dinheiro.nf':1,'dinheiro.pagamentos':1,'dinheiro.pagar_tarologas':1,'dinheiro.folha':1,'dinheiro.saldo_total':1,'dinheiro.faturamento':1,'dinheiro.precos':1,'conteudo.ver':1,'conteudo.escrever':1,'conteudo.publicar':1,'conteudo.newsletter':1,'aquisicao.ver':1,'aquisicao.lancar':1,'relatorios.ver':1,'relatorios.producao':1,'ajustes.regras':1,'ajustes.bot':1,'usuarios.criar':1,'usuarios.editar':1,'usuarios.excluir':1,'auditoria.ver':1}},
  {id:'admin', nome:'Admin', ico:'ph-shield-star', g:'linear-gradient(135deg,#86a7bd,#51829b)', pessoas:1, sistema:false,
   perms:{'chat.trabalhar':1,'chat.rapidas_time':1,'chat.rapidas_aprovar':1,'chat.ver_grupo':1,'consultas.ver':1,'consultas.fila':1,'consultas.trocar':1,'consultas.cancelar_cobranca':1,'clientes.buscar':1,'clientes.ver':1,'clientes.listar':1,'clientes.historico_completo':1,'clientes.editar':1,'clientes.cpf_completo':1,'clientes.bloquear':1,'clientes.juntar':1,'tarologas.ver':1,'tarologas.editar':1,'tarologas.ativar':1,'tarologas.aprovar_cand':1,'tarologas.comissao':1,'agenda.editar':1,'dinheiro.recebimentos':1,'dinheiro.estornar':1,'dinheiro.aprovar_estorno':1,'dinheiro.conciliar':1,'dinheiro.nf':1,'dinheiro.pagamentos':1,'dinheiro.pagar_tarologas':1,'dinheiro.folha':1,'dinheiro.saldo_total':1,'dinheiro.faturamento':1,'dinheiro.precos':1,'conteudo.ver':1,'conteudo.escrever':1,'conteudo.publicar':1,'conteudo.newsletter':1,'aquisicao.ver':1,'aquisicao.lancar':1,'relatorios.ver':1,'relatorios.producao':1,'ajustes.regras':1,'ajustes.bot':1,'ajustes.integracoes':1,'usuarios.criar':1,'usuarios.editar':1,'usuarios.excluir':1,'papeis.criar':1,'papeis.editar':1,'papeis.excluir':1,'auditoria.ver':1}},
];


// ===== usuários internos =====
const MOCK_USUARIOS =[
  {id:'u1', nome:'Laya', ini:'L', g:'linear-gradient(135deg,#ff8fb1,#e52444)', email:'laya@fadasdobem.com.br', papeis:['admin'], setor:'Gestão', status:'ativo', ultimo:'agora', criado:'jan/2024',
    cpf:'123.456.789-00', nasc:'1988-05-14', whats:'(11) 9 9999-0001', whats2:'', emailPessoal:'laya@gmail.com', vinculo:'Sócia',
    cep:'01310-100', rua:'Av. Paulista', num:'1000', compl:'cj 101', bairro:'Bela Vista', cidade:'São Paulo', uf:'SP',
    pixTipo:'CPF', pixChave:'123.456.789-00', banco:'', ag:'', conta:''},
  {id:'u2', nome:'Camila Ribeiro', ini:'CR', g:'linear-gradient(135deg,#86a7bd,#51829b)', email:'camila@fadasdobem.com.br', papeis:['atendente'], setor:'Atendimento', cargo:'Atendente', status:'ativo', ultimo:'há 2h', criado:'mar/2025',
    cpf:'987.654.321-00', nasc:'1995-03-12', whats:'(11) 9 7777-2211', whats2:'', emailPessoal:'camila.ribeiro@gmail.com', vinculo:'CLT',
    cep:'03310-000', rua:'Rua Tuiuti', num:'520', compl:'ap 32', bairro:'Tatuapé', cidade:'São Paulo', uf:'SP',
    pixTipo:'Celular', pixChave:'(11) 9 7777-2211', banco:'Nubank', ag:'0001', conta:'12345678-9'},
  {id:'u3', nome:'Beatriz Souza', ini:'BS', g:'linear-gradient(135deg,#7fd4dd,#00a8b5)', email:'beatriz@fadasdobem.com.br', papeis:['atendente'], setor:'Atendimento', status:'ativo', ultimo:'ontem', criado:'abr/2025',
    cpf:'111.222.333-44', nasc:'1993-08-20', whats:'(21) 9 8888-1122', whats2:'', emailPessoal:'bia.souza@gmail.com', vinculo:'CLT',
    cep:'20040-002', rua:'Rua da Assembleia', num:'10', compl:'', bairro:'Centro', cidade:'Rio de Janeiro', uf:'RJ',
    pixTipo:'E-mail', pixChave:'bia.souza@gmail.com', banco:'Itaú', ag:'1234', conta:'56789-0'},
  {id:'u4', nome:'Renata Alves', ini:'RA', g:'linear-gradient(135deg,#f6c66b,#f39c12)', email:'renata@fadasdobem.com.br', papeis:['supervisora','financeiro'], setor:'Atendimento', cargo:'Supervisora de Atendimento', status:'ativo', ultimo:'há 3 dias', criado:'jun/2024',
    cpf:'222.333.444-55', nasc:'1990-01-30', whats:'(31) 9 9456-1200', whats2:'', emailPessoal:'renata.alves@gmail.com', vinculo:'PJ',
    cep:'30140-071', rua:'Av. do Contorno', num:'3200', compl:'sala 5', bairro:'Funcionários', cidade:'Belo Horizonte', uf:'MG',
    pixTipo:'CNPJ', pixChave:'12.345.678/0001-90', banco:'Inter', ag:'0001', conta:'99887766-5'},
  {id:'u5', nome:'Paula Lima', ini:'PL', g:'linear-gradient(135deg,#a9d66b,#6a9900)', email:'paula@fadasdobem.com.br', papeis:['gestora'], setor:'Gestão', cargo:'Coordenadora', status:'ativo', ultimo:'há 1h', criado:'set/2024',
    cpf:'333.444.555-66', nasc:'1987-11-05', whats:'(11) 9 3344-5566', whats2:'', emailPessoal:'paula.lima@gmail.com', vinculo:'CLT',
    cep:'05407-002', rua:'Rua dos Pinheiros', num:'800', compl:'ap 121', bairro:'Pinheiros', cidade:'São Paulo', uf:'SP',
    pixTipo:'CPF', pixChave:'333.444.555-66', banco:'Bradesco', ag:'4321', conta:'11223-4'},
  {id:'u6', nome:'Joana Prado', ini:'JP', g:'linear-gradient(135deg,#d9cec2,#b3a596)', email:'joana@fadasdobem.com.br', papeis:['atendente'], setor:'Atendimento', status:'pendente', ultimo:'—', criado:'há 5 min',
    cpf:'', nasc:'', whats:'(11) 9 5555-1234', whats2:'', emailPessoal:'joana.prado@gmail.com', vinculo:'',
    cep:'', rua:'', num:'', compl:'', bairro:'', cidade:'', uf:'', pixTipo:'', pixChave:'', banco:'', ag:'', conta:''},
  {id:'u7', nome:'Marina Dias', ini:'MD', g:'linear-gradient(135deg,#c9b8e8,#9a7cc9)', email:'marina@fadasdobem.com.br', papeis:['atendente'], setor:'Atendimento', status:'expirado', ultimo:'—', criado:'há 8 dias',
    cpf:'', nasc:'', whats:'(11) 9 6666-4321', whats2:'', emailPessoal:'marina.dias@gmail.com', vinculo:'',
    cep:'', rua:'', num:'', compl:'', bairro:'', cidade:'', uf:'', pixTipo:'', pixChave:'', banco:'', ag:'', conta:''},
  {id:'u8', nome:'Tânia Rocha', ini:'TR', g:'linear-gradient(135deg,#e8a9a9,#c96b6b)', email:'tania@fadasdobem.com.br', papeis:['supervisora'], setor:'Atendimento', status:'suspenso', ultimo:'há 15 dias', criado:'nov/2024',
    cpf:'444.555.666-77', nasc:'1985-06-18', whats:'(31) 9 9111-2233', whats2:'', emailPessoal:'tania.rocha@outlook.com', vinculo:'PJ',
    cep:'30112-000', rua:'Rua da Bahia', num:'1500', compl:'', bairro:'Centro', cidade:'Belo Horizonte', uf:'MG',
    pixTipo:'CPF', pixChave:'444.555.666-77', banco:'Santander', ag:'2020', conta:'33445-6'},
  {id:'u9', nome:'Fernanda Melo', ini:'FM', g:'linear-gradient(135deg,#b3a596,#8a7866)', email:'fernanda@fadasdobem.com.br', papeis:['atendente'], setor:'Atendimento', status:'desativado', ultimo:'há 2 meses', criado:'fev/2024',
    cpf:'555.666.777-88', nasc:'1991-02-25', whats:'(11) 9 2222-3344', whats2:'', emailPessoal:'fe.melo@gmail.com', vinculo:'CLT',
    cep:'02011-000', rua:'Rua Voluntários da Pátria', num:'2000', compl:'', bairro:'Santana', cidade:'São Paulo', uf:'SP',
    pixTipo:'CPF', pixChave:'555.666.777-88', banco:'Caixa', ag:'0101', conta:'77889-0'},
];
const USER_STATUS ={
  ativo:{lb:'Ativo',cls:'st-ativo'}, pendente:{lb:'Convite pendente',cls:'st-pend'},
  expirado:{lb:'Convite expirado',cls:'st-exp'}, suspenso:{lb:'Suspenso',cls:'st-susp'},
  desativado:{lb:'Desativado',cls:'st-desat'}, bloqueado:{lb:'Bloqueado',cls:'st-block'}
};
// candidatos internos — quem PREENCHEU o formulário no site (ou foi cadastrado por indicação). Origem do convite.
const MOCK_CANDIDATOS =[
  {id:'c1', nome:'Aline Ferraz', ini:'AF', g:'linear-gradient(135deg,#b6d97f,#6a9900)', emailPessoal:'aline.ferraz@gmail.com', whats:'(11) 9 7777-2211', vaga:'Atendente', origem:'formulário', quando:'há 2 dias', etapa:'novo',
    cidade:'São Paulo, SP', nasc:'12/03/1995', linkedin:'linkedin.com/in/alineferraz', comoConheceu:'Instagram da Fadas',
    disp:'Integral · manhã e tarde', pretensao:'R$ 2.200', inicio:'Imediato',
    exp:'2 anos em SAC de e-commerce. Atendimento por chat e telefone. Já usei Chatwoot e responder alto volume de tickets.',
    motivacao:'Sempre me interessei por tarot e acho lindo o cuidado que a Fadas tem com as clientes. Queria fazer parte disso.', obs:''},
  {id:'c2', nome:'Débora Nunes', ini:'DN', g:'linear-gradient(135deg,#7fd4dd,#00a8b5)', emailPessoal:'debora.nunes@gmail.com', whats:'(21) 9 8123-4590', vaga:'Atendente', origem:'formulário', quando:'há 5 dias', etapa:'analise',
    cidade:'Rio de Janeiro, RJ', nasc:'28/07/1990', linkedin:'—', comoConheceu:'Indicação de amiga',
    disp:'Tarde e noite', pretensao:'R$ 2.000', inicio:'A combinar (aviso prévio)',
    exp:'Trabalho com atendimento em e-commerce de moda há 3 anos. Experiência com cliente exigente e pós-venda.',
    motivacao:'Busco um ambiente mais acolhedor e com propósito. Me identifico com a proposta.', obs:'Entrevista marcada p/ quinta 14h'},
  {id:'c3', nome:'Sônia Barros', ini:'SB', g:'linear-gradient(135deg,#f6c66b,#f39c12)', emailPessoal:'sonia.barros@outlook.com', whats:'(31) 9 9456-7788', vaga:'Supervisora', origem:'indicação', quando:'há 1 semana', etapa:'aprovado',
    cidade:'Belo Horizonte, MG', nasc:'05/11/1985', linkedin:'linkedin.com/in/soniabarros', comoConheceu:'Indicada pela Paula (gestora)',
    disp:'Integral', pretensao:'R$ 3.500', inicio:'15 dias',
    exp:'5 anos liderando equipe de atendimento (12 pessoas) numa operação de telemarketing. Gestão de escala, métricas e treinamento.',
    motivacao:'Quero um desafio de gestão numa empresa que cresce. A Paula falou muito bem do time.', obs:'Indicada pela Paula. Aprovada na entrevista com a Laya.'},
  {id:'c4', nome:'Marcos Vinícius', ini:'MV', g:'linear-gradient(135deg,#c9b8e8,#9a7cc9)', emailPessoal:'marcos.v@gmail.com', whats:'(11) 9 3344-1200', vaga:'Financeiro', origem:'formulário', quando:'ontem', etapa:'novo',
    cidade:'São Paulo, SP', nasc:'19/09/1992', linkedin:'linkedin.com/in/marcosv', comoConheceu:'Google (busca por vagas)',
    disp:'Integral', pretensao:'R$ 3.000', inicio:'Imediato',
    exp:'Analista financeiro há 4 anos. Conciliação, contas a pagar/receber. Conheço Mercado Pago e emissão de notas.',
    motivacao:'Procuro uma empresa em crescimento onde eu possa estruturar processos financeiros.', obs:''},
];
const CANDIDATE_STAGES =[
  {id:'novo', nome:'Novos', ico:'ph-tray', cor:'v-blue', sub:'acabaram de se candidatar'},
  {id:'analise', nome:'Em análise', ico:'ph-magnifying-glass', cor:'v-gold', sub:'triagem e entrevista'},
  {id:'aprovado', nome:'Aprovados', ico:'ph-check-circle', cor:'v-green', sub:'prontos para virar usuário'},
];
// ===== setores =====
let INITIAL_CARGOS =[
  {id:'cg1', nome:'Atendente', desc:'linha de frente do atendimento', papel:'atendente', ico:'ph-headset', cor:'v-teal'},
  {id:'cg2', nome:'Supervisora de Atendimento', desc:'chefia o time de atendimento', papel:'supervisora', ico:'ph-user-gear', cor:'v-gold'},
  {id:'cg3', nome:'Analista Financeiro', desc:'cuida do financeiro da empresa', papel:'financeiro', ico:'ph-hand-coins', cor:'v-green'},
  {id:'cg4', nome:'Gestor de Tráfego', desc:'anúncios e aquisição', papel:'marketing', ico:'ph-megaphone', cor:'v-pink'},
  {id:'cg5', nome:'Social Media', desc:'blog, conteúdo e redes', papel:'social', ico:'ph-share-network', cor:'v-blue'},
  {id:'cg6', nome:'Coordenadora', desc:'coordena a operação inteira', papel:'gestora', ico:'ph-crown', cor:'v-red'},
  {id:'cg7', nome:'Gerente Financeiro', desc:'vê o caixa inteiro da empresa', papel:'financeiro_senior', ico:'ph-vault', cor:'v-green'},
];
let INITIAL_SETORES =[
  {id:'s1', nome:'Atendimento', ico:'ph-headset', cor:'v-teal', desc:'fila, consultas, recados', perms:{'chat.trabalhar':1,'chat.rapidas_time':1,'chat.rapidas_aprovar':1,'chat.ver_grupo':1,'consultas.ver':1,'consultas.fila':1,'consultas.trocar':1,'consultas.cancelar_cobranca':1,'clientes.buscar':1,'clientes.ver':1,'clientes.editar':1,'clientes.cpf_completo':1,'clientes.bloquear':1,'clientes.juntar':1,'agenda.editar':1}},
  {id:'s2', nome:'Gestão', ico:'ph-crown', cor:'v-red', desc:'coordenação geral da operação', perms:{'chat.trabalhar':1,'chat.rapidas_time':1,'chat.rapidas_aprovar':1,'chat.ver_grupo':1,'consultas.ver':1,'consultas.fila':1,'consultas.trocar':1,'consultas.cancelar_cobranca':1,'clientes.buscar':1,'clientes.ver':1,'clientes.editar':1,'clientes.cpf_completo':1,'clientes.bloquear':1,'clientes.juntar':1,'tarologas.ver':1,'tarologas.editar':1,'tarologas.ativar':1,'tarologas.aprovar_cand':1,'tarologas.comissao':1,'agenda.editar':1,'dinheiro.recebimentos':1,'dinheiro.estornar':1,'dinheiro.aprovar_estorno':1,'dinheiro.conciliar':1,'dinheiro.nf':1,'dinheiro.pagamentos':1,'dinheiro.pagar_tarologas':1,'dinheiro.folha':1,'dinheiro.saldo_total':1,'dinheiro.faturamento':1,'dinheiro.precos':1,'conteudo.ver':1,'conteudo.escrever':1,'conteudo.publicar':1,'conteudo.newsletter':1,'aquisicao.ver':1,'aquisicao.lancar':1,'relatorios.ver':1,'relatorios.producao':1,'ajustes.regras':1,'ajustes.bot':1,'usuarios.criar':1,'usuarios.editar':1,'usuarios.excluir':1,'auditoria.ver':1}},
  {id:'s3', nome:'Financeiro', ico:'ph-hand-coins', cor:'v-green', desc:'recebimentos, pagamentos e repasses', perms:{'dinheiro.recebimentos':1,'dinheiro.estornar':1,'dinheiro.aprovar_estorno':1,'dinheiro.conciliar':1,'dinheiro.nf':1,'dinheiro.pagamentos':1,'dinheiro.pagar_tarologas':1,'dinheiro.folha':1,'dinheiro.saldo_total':1,'dinheiro.faturamento':1,'tarologas.comissao':1,'relatorios.ver':1,'relatorios.producao':1}},
  {id:'s4', nome:'Recrutamento', ico:'ph-user-plus', cor:'v-gold', desc:'candidatas e onboarding', perms:{'tarologas.ver':1,'tarologas.editar':1,'tarologas.ativar':1,'tarologas.aprovar_cand':1}},
  {id:'s5', nome:'Marketing', ico:'ph-megaphone', cor:'v-pink', desc:'anúncios, tráfego e aquisição', perms:{'aquisicao.ver':1,'aquisicao.lancar':1,'relatorios.ver':1}},
  {id:'s6', nome:'Conteúdo', ico:'ph-newspaper', cor:'v-gold', desc:'blog, redes e newsletter', perms:{'conteudo.ver':1,'conteudo.escrever':1,'conteudo.publicar':1,'conteudo.newsletter':1,'relatorios.ver':1}},
];



module.exports = {
  PERMISSION_AREAS,
  INITIAL_ROLES,
  INITIAL_CARGOS,
  INITIAL_SETORES,
  MOCK_USUARIOS,
  USER_STATUS,
  MOCK_CANDIDATOS,
  CANDIDATE_STAGES,
};
