'use strict';

/**
 * Domínio puro das contas de acesso (Configurações > Equipe). Regras do CÓDIGO do front, com as mesmas mensagens:
 *   senha forte: `strongAccountPassword` (auth/demo-credentials.ts:7); nome, usuário/e-mail e unicidade: `saveAccount`
 *   (shell/home-experience.tsx); última administradora: `lastAdministratorRoleChangeError` (admin/account-edit-guard.ts);
 *   rótulos de acesso: dados do demo ("Agora", "Hoje, 15:48", "Ontem, 22:10", "20/08, 18:45", "Ainda não acessou").
 * Nada de I/O, nada de senha em log.
 */

const PERFIS_EQUIPE = Object.freeze(['administradora', 'assistente', 'supervisora', 'atendente']);

/** Papéis que a A grava para cada perfil de equipe: os mesmos das contas de teste e de `MAPEAMENTO_PERFIL` (Maturacao/23). */
const PAPEIS_DA_A = Object.freeze({
  administradora: { produto: 'GESTORA', rbac: ['admin'] },
  assistente: { produto: 'GESTORA', rbac: ['assistente'] },
  supervisora: { produto: 'ATENDENTE', rbac: ['supervisora'] },
  atendente: { produto: 'ATENDENTE', rbac: ['atendente'] },
});

const MSG = Object.freeze({
  nomeEmail: 'Preencha o nome e o usuário ou e-mail.',
  emailInvalido: 'Confira o usuário ou e-mail informado.',
  emailEmUso: 'Esse usuário ou e-mail já está cadastrado.',
  senhaFraca: 'Use 12 caracteres, maiúscula, minúscula, número e símbolo. Confirme a mesma senha.',
  ultimaAdmin: 'Mantenha pelo menos uma administradora com acesso ativo. Crie ou ative outro acesso administrativo antes de alterar esta função.',
  bloquearPropria: 'Você não pode bloquear seu próprio acesso.',
  cadastroInativo: 'Ative o cadastro em Tarólogos antes de liberar o acesso.',
  vinculada: 'O acesso deve continuar vinculado à profissional.',
  semCadastro: 'O cadastro desta profissional não foi encontrado.',
  jaTemAcesso: 'Esta profissional já possui acesso. Abra o cadastro existente.',
  foto: 'A foto deve ter no máximo 3 MB.',
});

const FOTO_MAX_CARACTERES = 4_500_000; // 3 MB em data URL base64 (~4 MB) com folga

/** `strongAccountPassword`. */
const senhaForte = (s) => typeof s === 'string' && s.length >= 12 && /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s) && /[^A-Za-z0-9]/.test(s);

/** Nome como o front guarda: espaços repetidos viram um. */
const normalizarNome = (n) => (typeof n === 'string' ? n.trim().replace(/\s+/g, ' ') : '');

/** `null` se serve; senão a mensagem do front. O login da A é por e-mail: sem `@` não há como entrar (decisão no Maturacao/33). */
function validarEmail(bruto) {
  const email = typeof bruto === 'string' ? bruto.trim() : '';
  if (!email) return MSG.nomeEmail;
  if (/\s/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) return MSG.emailInvalido;
  return null;
}
const emailChave = (e) => `${e}`.trim().toLocaleLowerCase('pt-BR');

const DIA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
const HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const CHAVE_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Texto da coluna Acesso: "Agora" (até 5 min), "Hoje, HH:mm", "Ontem, HH:mm", "dd/MM, HH:mm" ou "Ainda não acessou". */
function rotuloAcesso(ultimoLogin, agora = new Date()) {
  if (!ultimoLogin) return 'Ainda não acessou';
  const quando = new Date(ultimoLogin);
  if (!Number.isFinite(quando.getTime())) return 'Ainda não acessou';
  const dif = agora.getTime() - quando.getTime();
  if (dif >= 0 && dif < 5 * 60 * 1000) return 'Agora';
  const hora = HORA.format(quando);
  const dia = CHAVE_DIA.format(quando); const hoje = CHAVE_DIA.format(agora); const ontem = CHAVE_DIA.format(new Date(agora.getTime() - 86400000));
  if (dia === hoje) return `Hoje, ${hora}`;
  if (dia === ontem) return `Ontem, ${hora}`;
  return `${DIA.format(quando)}, ${hora}`;
}

const comissaoTexto = (n) => `${Number(n)}%`.replace('.', ',');

/** Linha do usuário da A -> `UserAccount` do front (campo ausente fica ausente). */
function paraConta(l, agora = new Date()) {
  const conta = {
    id: l.id, name: l.nome, email: l.email, role: l.perfil,
    commission: l.perfil === 'tarologa' ? comissaoTexto(l.comissao ?? 30) : '—',
    access: rotuloAcesso(l.ultimo_login, agora), active: Boolean(l.ativo),
  };
  if (l.tarot_id) conta.tarotId = l.tarot_id;
  if (l.legacy_id) conta.legacyId = l.legacy_id;
  if (l.avatar) conta.avatar = l.avatar;
  return conta;
}

/** Regra da última administradora: alterar a função (ou bloquear) a única administradora ativa é recusado. */
function removeUltimaAdmin(contas, id, novoPerfil, novoAtivo) {
  const alvo = contas.find((c) => c.id === id);
  if (!alvo || alvo.role !== 'administradora' || !alvo.active) return false;
  const continua = novoPerfil === 'administradora' && novoAtivo !== false;
  if (continua) return false;
  return !contas.some((c) => c.id !== id && c.role === 'administradora' && c.active);
}

/**
 * `saveAccount` (shell/home-experience.tsx:1368-1369): com o cadastro da profissional na mão, outra conta já ligada a ele é recusada e a conta
 * ligada continua `tarologa`. `contaDoCadastroId`: id da conta que já está ligada ao cadastro (ou null); `idEditando`: a conta que se edita.
 */
function conferirVinculo({ temCadastro, contaDoCadastroId, idEditando, papel }) {
  if (temCadastro && contaDoCadastroId && contaDoCadastroId !== idEditando) return MSG.jaTemAcesso;
  if (temCadastro && papel !== 'tarologa') return MSG.vinculada;
  return null;
}

module.exports = { conferirVinculo, PERFIS_EQUIPE, PAPEIS_DA_A, MSG, FOTO_MAX_CARACTERES, senhaForte, normalizarNome, validarEmail, emailChave, rotuloAcesso, paraConta, removeUltimaAdmin };
