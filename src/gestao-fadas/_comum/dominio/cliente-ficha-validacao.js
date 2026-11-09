'use strict';

/**
 * Validação dos dados da ficha que o banco novo passa a guardar (Nice, 08/11; 09/11 e-mail 2 e telefone comercial): nome completo, CPF, e-mail, e-mail 2, telefone comercial, telefones e endereço.
 * Porta FIEL do código do front, que é o ouro (scripts/apoio-gf-ficha-dados/ouro.json, gerado por gerar-ouro-gf-ficha-dados.js):
 *   validateText (features/domain/input-validation.ts), validateClientRegistration/validateClientAddress/validateClientPhonePreferences
 *   (client-profile-model.ts), validDuplicateCpf (client-duplicate-model.ts), normalizeClientEmail (client-input-format.ts),
 *   normalizeClientPhone/clientPhoneComplete (client-create-model.ts) e prepareClientRegistrationEdit (client-registration-editor-model.ts).
 * Diferença deliberada: o front deixa limpar um campo; a API NÃO apaga (o vazio nunca apaga o que veio do legado), então vazio é recusado aqui.
 * Funções puras; todo erro é `Error` com a mensagem que a tela mostra.
 */

const { clientePhoneComplete, normalizarTelefone } = require('./cliente-ficha-telefone');

const LIMITES = { fullName: 255, cpf: 50, email: 50, email2: 100, workPhone: 50 };
const MAX_TELEFONES = 20;

/** validateText do front: o texto aparado, ou erro "<rótulo>: ...". */
function texto(valor, rotulo, max, { obrigatorio = false } = {}) {
  const falha = (m) => { throw new Error(`${rotulo}: ${m}`); };
  if (typeof valor !== 'string') return falha('informe um texto válido.');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(valor)) return falha('há um caractere de controle inválido. Apague e digite novamente o trecho colado.');
  for (const ch of valor) { const p = ch.codePointAt(0); if (p >= 0xD800 && p <= 0xDFFF) return falha('há um caractere incompleto. Apague e digite novamente o trecho colado.'); }
  if (/[\r\n\t\u2028\u2029]/u.test(valor)) return falha('use uma única linha.');
  const t = valor.trim();
  if (obrigatorio && !t) return falha('preencha este campo.');
  if (Array.from(t).length > max) return falha(`use no máximo ${max} caracteres. O texto não foi cortado.`);
  return t;
}

function cpfValido(valor) {
  const cpf = (valor ?? '').trim().replace(/[.\-\s]/g, '');
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return '';
  for (const n of [9, 10]) {
    const soma = [...cpf.slice(0, n)].reduce((t, d, i) => t + Number(d) * (n + 1 - i), 0);
    const d = (soma * 10) % 11;
    if (Number(cpf[n]) !== (d === 10 ? 0 : d)) return '';
  }
  return cpf;
}

/** normalizeClientEmail do front: só aparar; o formato decide. */
function emailValido(valor) {
  const partes = valor.split('@');
  return partes.length === 2 && partes[0].length > 0 && partes[0].length <= 64 && !/[\s<>(),;:"\\]/.test(partes[0]) && !/^\.|\.$|\.\./.test(partes[0])
    && partes[1].length <= 253 && partes[1].split('.').length >= 2
    && partes[1].split('.').every((p) => /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(p)) && /^[a-z]{2,63}$/i.test(partes[1].split('.').at(-1) ?? '');
}

function nomeCompleto(v) {
  const t = texto(v, 'Nome completo', LIMITES.fullName);
  if (!t) throw new Error('Informe o nome completo da cliente.');
  return t;
}

function cpf(v) {
  // Como o editor: primeiro a conferência do número (validDuplicateCpf), depois o texto (validateText).
  if (typeof v === 'string' && v.trim() && !cpfValido(v)) throw new Error('Confira o CPF da cliente.');
  const t = texto(v, 'Cadastro', LIMITES.cpf);
  if (!t) throw new Error('O CPF não pode ser apagado neste cadastro. Informe o novo número.');
  return t;
}

function email(v, campo = 'email') {
  // Como o editor: primeiro o formato (normalizeClientEmail), depois o texto e a conferência de validateClientRegistration.
  // email2 ("Outro e-mail") segue o mesmo caminho do front, com o limite de 100 (CLIENT_REGISTRATION_LIMITS.email2).
  if (typeof v === 'string' && v.trim() && !emailValido(v.trim())) throw new Error('Confira o e-mail: nome@dominio.com.');
  const t = texto(v, 'E-mail', LIMITES[campo]);
  if (!t) throw new Error(campo === 'email2' ? 'O outro e-mail não pode ser apagado neste cadastro. Informe o novo endereço.' : 'O e-mail não pode ser apagado neste cadastro. Informe o novo endereço.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) throw new Error('Confira o endereço de e-mail.');
  return t;
}

/** Telefone comercial: o front só confere o texto (validateText, rótulo "Cadastro", até 50, uma linha); não impõe formato de número. */
function telefoneComercial(v) {
  const t = texto(v, 'Cadastro', LIMITES.workPhone);
  if (!t) throw new Error('O telefone comercial não pode ser apagado neste cadastro. Informe o novo número.');
  return t;
}

/** Telefones, com o de consultas e o do WhatsApp entre eles (validateClientPhonePreferences + a conferência de DDI/DDD do editor). */
function telefones({ phones, consultationPhoneIndex, whatsappPhoneIndex }) {
  if (phones === undefined) {
    if (consultationPhoneIndex !== undefined || whatsappPhoneIndex !== undefined) throw new Error('Confira os números escolhidos para consultas e WhatsApp.');
    return null;
  }
  if (!Array.isArray(phones) || phones.length < 1) throw new Error('Informe um número de telefone da cliente.');
  if (phones.length > MAX_TELEFONES) throw new Error(`Informe no máximo ${MAX_TELEFONES} telefones.`);
  // Como o editor: primeiro DDI/DDD completos (clientPhoneComplete), depois as conferências de validateClientPhonePreferences.
  if (phones.some((p) => typeof p === 'string' && p.trim() && !clientePhoneComplete(normalizarTelefone(p.trim())))) throw new Error('Confira os telefones preenchidos, incluindo DDI e DDD.');
  const lista = phones.map((p) => texto(p, 'Telefone', 50, { obrigatorio: true }));
  for (const p of lista) if (!/^\+?[\d\s().-]+$/.test(p) || p.replace(/\D/g, '').length < 8 || p.replace(/\D/g, '').length > 15) throw new Error('Confira os telefones da cliente.');
  const consulta = consultationPhoneIndex ?? 0;
  const whats = whatsappPhoneIndex ?? 0;
  if ([consulta, whats].some((i) => !Number.isInteger(i) || i < 0 || i >= lista.length)) throw new Error('Escolha o telefone de consultas e o WhatsApp entre os números informados.');
  return { phones: lista, consultationPhoneIndex: consulta, whatsappPhoneIndex: whats };
}

const CAMPOS_ENDERECO = [['street', 'Rua', 200], ['number', 'Número', 20], ['complement', 'Complemento', 100], ['district', 'Bairro', 100], ['city', 'Cidade', 100]];

/** validateClientAddress do front. Endereço todo vazio é recusado (não apaga). */
function endereco(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('Confira o endereço da cliente.');
  const ler = (campo, rotulo, max) => texto(a[campo] ?? '', rotulo, max);
  const pais = ler('country', 'País', 100);
  const brasil = !pais || ['br', 'bra', 'brasil', 'brazil'].includes(pais.toLowerCase());
  const zip = texto(a.cep || a.zip || '', brasil ? 'CEP' : 'Código postal', brasil ? 9 : 24);
  if (brasil && zip && !/^\d{5}-?\d{3}$/.test(zip)) throw new Error('O CEP precisa ter 8 dígitos.');
  const regiao = ler('state', brasil ? 'UF' : 'Estado/região', brasil ? 2 : 100);
  const state = brasil ? regiao.toUpperCase() : regiao;
  if (brasil && state && !/^[A-Z]{2}$/.test(state)) throw new Error('Informe a UF com duas letras.');
  const saida = { zip: brasil ? zip.replace(/^(\d{5})(\d{3})$/, '$1-$2') : zip, state, country: pais };
  for (const [campo, rotulo, max] of CAMPOS_ENDERECO) saida[campo] = ler(campo, rotulo, max);
  if (!Object.values(saida).some((v) => v)) throw new Error('O endereço não pode ser apagado neste cadastro. Informe o novo endereço.');
  return saida;
}

const CHAVES = ['fullName', 'cpf', 'email', 'email2', 'workPhone', 'phones', 'consultationPhoneIndex', 'whatsappPhoneIndex', 'address'];

/** Os campos da ficha presentes em `mudancas`, validados; `{}` se nenhum. Campo ausente = preservado. */
function validarFicha(m) {
  const s = {};
  if (m.fullName !== undefined) s.fullName = nomeCompleto(m.fullName);
  if (m.cpf !== undefined) s.cpf = cpf(m.cpf);
  if (m.email !== undefined) s.email = email(m.email);
  if (m.email2 !== undefined) s.email2 = email(m.email2, 'email2');
  if (m.workPhone !== undefined) s.workPhone = telefoneComercial(m.workPhone);
  const fones = telefones(m);
  if (fones) Object.assign(s, fones);
  if (m.address !== undefined) s.address = endereco(m.address);
  return s;
}

module.exports = { CHAVES, MAX_TELEFONES, cpfValido, emailValido, endereco, telefones, validarFicha };
