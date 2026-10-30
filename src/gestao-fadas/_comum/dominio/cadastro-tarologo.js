'use strict';

/**
 * Domínio puro do Cadastro de tarólogos, portado de `features/professionals/registration-model.ts`,
 * `registration-projection.ts` (projeção aprovada) e `registration-intake-projection.ts` (o que o link individual mostra).
 * As mensagens são as do front. Sem banco e sem HTTP: o service e o teste usam as mesmas funções.
 */

const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const ORCAMENTO_FOTOS = 500000;
const GRUPOS_COMPETENCIA = ['definitions', 'tarot', 'cartomancy', 'astrology', 'numerology', 'oracles', 'spreads', 'practices'];
const GRUPOS_SEM = ['tarot', 'cartomancy', 'astrology', 'numerology', 'oracles'];
const PRIVADOS = ['commissionRate', 'paymentSchedule', 'role', 'active', 'password', 'passwordHash', 'account', 'accountId', 'login', 'permissions', 'tarotId', 'status'];

class CadastroInvalidoError extends Error {}
const falha = (m) => new CadastroInvalidoError(m);

function cadastroVazio() {
  return {
    professionalName: '', fullName: '', birthDate: '', cpf: '',
    address: { street: '', number: '', complement: '', district: '', city: '', state: '', postalCode: '', raw: '' },
    phone: '', phone2: '', email: '', avatar: '', portrait: '', gallery: [], biography: '', definitions: [], oracles: [], techniques: [],
    spreads: [], channels: [], equipment: [], themes: [], weeklySchedule: {},
    bank: { name: '', agency: '', agencyDigit: '', account: '', accountDigit: '', accountType: '', pixType: '', pix: '', holderName: '', holderDocument: '' },
    preferredPaymentMethod: '', commissionRate: 30, paymentSchedule: null,
  };
}

const ehObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
function objeto(v, campo = 'Cadastro') { if (!ehObjeto(v)) throw falha(`${campo}: conteúdo inválido.`); return v; }
function texto(v, campo, max = 200) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw falha(`${campo}: informe um texto.`);
  const limpo = v.trim().replace(/\r\n?/g, '\n');
  if (limpo.length > max) throw falha(`${campo}: use até ${max} caracteres.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(limpo)) throw falha(`${campo}: contém caracteres inválidos.`);
  return limpo;
}
function lista(v, campo) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 120) throw falha(`${campo}: seleção inválida.`);
  return [...new Set(v.map((i) => texto(i, campo, 160)).filter(Boolean))];
}
function foto(v, rotulo, max = 700000) {
  const fonte = texto(v, rotulo, max);
  if (!fonte) return '';
  const imagem = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(fonte);
  const local = /^\/avatars\/tarologos\/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/.test(fonte);
  let url = false;
  try { const p = new URL(fonte); url = p.protocol === 'https:' && !p.username && !p.password; } catch (_e) { /* caminho local e imagem já foram vistos */ }
  if (!imagem && !url && !local) throw falha('Use uma foto PNG, JPEG ou WebP, ou um endereço HTTPS.');
  return fonte;
}
function cpfValido(valor) {
  const d = String(valor).replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  for (let n = 9; n <= 10; n += 1) {
    const soma = [...d.slice(0, n)].reduce((t, dig, i) => t + Number(dig) * (n + 1 - i), 0);
    if (((soma * 10) % 11) % 10 !== Number(d[n])) return false;
  }
  return true;
}

const dois = (n) => String(n).padStart(2, '0');
const hora = (v) => { const [h, m] = v.split(':'); return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`; };
const periodosDoTexto = (t) => [...String(t).matchAll(/(\d{1,2})(?:(?:h|:)(\d{2})|h)?\s*(?:às|a|-)\s*(\d{1,2})(?:(?:h|:)(\d{2})|h)?/gi)]
  .map((m) => ({ start: `${m[1].padStart(2, '0')}:${m[2] || '00'}`, end: `${m[3].padStart(2, '0')}:${m[4] || '00'}` }));
const formatarPeriodos = (ps) => ps.map((p) => `${hora(p.start)} às ${hora(p.end)}`).join(' · ');

/** `validateOwnWorkPeriods(periodos, 3)` do front (lança qualquer erro: a mensagem do cadastro é uma só). */
function validarPeriodos(periodos) {
  if (!periodos.length || periodos.length > 3) throw new Error('periodos');
  let ultimo = -1;
  for (const p of periodos) {
    const minuto = (t) => {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error('hora');
      const [h, m] = t.split(':').map(Number);
      const v = h * 60 + m;
      return v < 360 ? v + 1440 : v;
    };
    const ini = minuto(p.start);
    const fim = p.end === '06:00' && ini > 360 ? 1800 : minuto(p.end);
    if (fim <= ini || ini < ultimo) throw new Error('ordem');
    ultimo = fim;
  }
}

/** `normalizePaymentSchedule` do front. */
function calendarioDePagamento(v) {
  if (v.kind === 'weekday') return ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'].includes(v.weekday) ? { kind: 'weekday', weekday: v.weekday } : null;
  if (v.kind !== 'monthdays' || !Array.isArray(v.days) || !v.days.length || v.days.some((d) => !Number.isInteger(d) || d < 1 || d > 31)) return null;
  if (new Set(v.days).size !== v.days.length || (v.weekendPolicy !== undefined && !['keep', 'next-business-day'].includes(v.weekendPolicy))) return null;
  return { kind: 'monthdays', days: [...v.days].sort((a, b) => a - b), ...(v.weekendPolicy ? { weekendPolicy: v.weekendPolicy } : {}) };
}

/** `validateRegistrationData`. `publica`: o envio do formulário (sem campos de repasse/acesso, com os obrigatórios). */
function validarCadastro(entrada, { publica = false, hoje = new Date().toISOString().slice(0, 10) } = {}) {
  const dados = objeto(entrada);
  if (publica && PRIVADOS.some((c) => Object.prototype.hasOwnProperty.call(dados, c))) throw falha('O formulário não pode alterar repasse, acesso ou aprovação.');
  const r = cadastroVazio();
  for (const k of ['professionalName', 'fullName', 'phone', 'phone2', 'cpf', 'birthDate', 'email']) r[k] = texto(dados[k], k, 200);
  if (!r.professionalName) throw falha('Informe o nome profissional.');
  if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) throw falha('Confira o e-mail informado.');
  if (r.cpf && (!/^[\d.\-\s]+$/.test(r.cpf) || !cpfValido(r.cpf))) throw falha('Confira o CPF informado.');
  if (r.birthDate) {
    const p = new Date(`${r.birthDate}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.birthDate) || !Number.isFinite(p.getTime()) || p.toISOString().slice(0, 10) !== r.birthDate || r.birthDate > hoje || r.birthDate < '1900-01-01') throw falha('Confira a data de nascimento.');
  }
  for (const k of ['phone', 'phone2']) {
    const n = r[k].replace(/\D/g, '').length;
    if (r[k] && (!/^[+\d()\s.\-]+$/.test(r[k]) || n < 10 || n > 15)) throw falha('Confira os números de celular.');
  }
  const end = dados.address === undefined ? {} : objeto(dados.address, 'Endereço');
  for (const k of Object.keys(r.address)) r.address[k] = texto(end[k], `Endereço: ${k}`, k === 'raw' ? 1500 : 240);
  if (r.address.state && !/^[A-Za-z]{2}$/.test(r.address.state)) throw falha('Informe a UF com duas letras.');
  r.address.state = r.address.state.toUpperCase();
  if (r.address.postalCode && !/^\d{5}-?\d{3}$/.test(r.address.postalCode)) throw falha('Confira o CEP informado.');
  r.biography = texto(dados.biography, 'Apresentação', 10000);
  r.avatar = foto(dados.avatar, 'Foto');
  r.portrait = foto(dados.portrait, 'Retrato', ORCAMENTO_FOTOS);
  if (dados.gallery !== undefined && (!Array.isArray(dados.gallery) || dados.gallery.length > 4)) throw falha('Inclua até quatro fotos adicionais.');
  r.gallery = (dados.gallery || []).map((i) => foto(i, 'Foto adicional', ORCAMENTO_FOTOS)).filter(Boolean);
  if ((r.portrait || r.gallery.length) && [r.avatar, r.portrait, ...r.gallery].reduce((s, i) => s + i.length, 0) > ORCAMENTO_FOTOS) throw falha('As fotos estão grandes demais. Substitua a foto maior por uma versão menor.');
  for (const k of ['definitions', 'oracles', 'techniques', 'spreads', 'channels', 'equipment', 'themes']) r[k] = lista(dados[k], k);
  if (dados.capabilityGroups !== undefined) {
    const g = objeto(dados.capabilityGroups, 'Grupos de competências');
    if (Object.keys(g).some((k) => !GRUPOS_COMPETENCIA.includes(k))) throw falha('Grupo de competências inválido.');
    r.capabilityGroups = Object.fromEntries(Object.entries(g).map(([k, v]) => [k, lista(v, 'Competências')]));
  }
  if (dados.capabilityNone !== undefined) {
    r.capabilityNone = lista(dados.capabilityNone, 'Competências não atendidas');
    if (r.capabilityNone.some((k) => !GRUPOS_SEM.includes(k))) throw falha('Grupo de competências inválido.');
    if (r.capabilityNone.some((k) => r.capabilityGroups && r.capabilityGroups[k] && r.capabilityGroups[k].length)) throw falha('Confira as competências: uma categoria não pode estar vazia e selecionada ao mesmo tempo.');
  }
  if (r.channels.some((c) => c !== 'Chat' && c !== 'Voz')) throw falha('Os canais disponíveis são Chat e Voz.');
  const semana = dados.weeklySchedule === undefined ? {} : objeto(dados.weeklySchedule, 'Horários');
  for (const dia of DIAS) {
    if (semana[dia] === undefined) continue;
    const horas = texto(semana[dia], `Horário de ${dia}`, 240);
    if (!horas || /^(folga|não atende|não vou atender|horário não informado|horário a informar|sem horário informado)$/i.test(horas)) { r.weeklySchedule[dia] = horas; continue; }
    const ps = periodosDoTexto(horas);
    try { validarPeriodos(ps); } catch (_e) { throw falha(`Confira os horários de ${dia}. Use períodos como 9h às 12h e 14h às 18h, ou Folga.`); }
    r.weeklySchedule[dia] = formatarPeriodos(ps);
  }
  const banco = dados.bank === undefined ? {} : objeto(dados.bank, 'Dados bancários');
  for (const k of Object.keys(r.bank)) r.bank[k] = texto(banco[k], `Banco: ${k}`, k === 'pix' ? 300 : 200);
  const forma = dados.preferredPaymentMethod ?? '';
  if (forma !== '' && forma !== 'pix' && forma !== 'bank') throw falha('Forma de recebimento inválida.');
  if (dados.paymentMethods === undefined) {
    r.paymentMethods = [];
    if (r.bank.pix || forma === 'pix') r.paymentMethods.push('pix');
    if (r.bank.name || r.bank.agency || r.bank.account || forma === 'bank') r.paymentMethods.push('bank');
  } else {
    if (!Array.isArray(dados.paymentMethods) || dados.paymentMethods.length > 2 || dados.paymentMethods.some((m) => m !== 'pix' && m !== 'bank')) throw falha('Formas de recebimento inválidas.');
    r.paymentMethods = [...new Set(dados.paymentMethods)];
  }
  r.preferredPaymentMethod = forma && r.paymentMethods.includes(forma) ? forma : r.paymentMethods.includes('pix') ? 'pix' : r.paymentMethods[0] || '';
  const taxa = publica ? 30 : dados.commissionRate === undefined ? 30 : dados.commissionRate;
  if (typeof taxa !== 'number' || !Number.isFinite(taxa) || taxa < 0 || taxa > 100 || Math.abs(Math.round(taxa * 100) - taxa * 100) > 0.000001) throw falha('O percentual de repasse deve ficar entre 0 e 100, com até duas casas decimais.');
  r.commissionRate = taxa;
  if (!publica && dados.paymentSchedule !== undefined && dados.paymentSchedule !== null) {
    r.paymentSchedule = calendarioDePagamento(objeto(dados.paymentSchedule, 'Calendário de pagamento'));
    if (!r.paymentSchedule) throw falha('Confira o calendário de pagamento. Escolha um dia da semana ou dias do mês.');
  }
  if (publica) {
    for (const [k, rotulo] of [['fullName', 'nome completo'], ['birthDate', 'nascimento'], ['cpf', 'CPF'], ['email', 'e-mail'], ['phone', 'celular principal']]) if (!r[k]) throw falha(`Informe ${rotulo}.`);
    if (!r.paymentMethods.length) throw falha('Selecione Pix ou conta bancária para recebimento.');
    const conta = r.bank.name && r.bank.agency && r.bank.account;
    if (!r.bank.pix && !conta) throw falha('Informe sua chave Pix ou banco, agência e conta para recebimento.');
    if (r.paymentMethods.includes('pix') && !r.bank.pix) throw falha('Informe sua chave Pix ou desmarque essa forma de recebimento.');
    if (r.paymentMethods.includes('bank') && !conta) throw falha('Informe banco, agência e conta ou desmarque essa forma de recebimento.');
    r.paymentSchedule = null;
  }
  return r;
}

/** `publicProfessionalProfile`: o que atravessa para o diretório quando a ficha é aprovada. */
function perfilPublico(d, tarotId) {
  return {
    tarotId, professionalName: d.professionalName, avatar: d.avatar, portrait: d.portrait || '', gallery: [...(d.gallery || [])], biography: d.biography,
    definitions: [...d.definitions], oracles: [...d.oracles], techniques: [...d.techniques], spreads: [...d.spreads], channels: [...d.channels],
    equipment: [...d.equipment], themes: [...d.themes], weeklySchedule: { ...d.weeklySchedule },
  };
}

/** `registrationIntakeProjection`: lista branca do link individual. */
function projecaoDoLink(salvo) {
  const d = { ...cadastroVazio(), ...salvo };
  const a = d.address; const b = d.bank;
  return {
    professionalName: d.professionalName, fullName: d.fullName, birthDate: d.birthDate, cpf: d.cpf, phone: d.phone, phone2: d.phone2, email: d.email,
    biography: d.biography, avatar: d.avatar, portrait: d.portrait, gallery: [...d.gallery],
    address: { street: a.street, number: a.number, complement: a.complement, district: a.district, city: a.city, state: a.state, postalCode: a.postalCode, raw: a.raw },
    bank: { name: b.name, agency: b.agency, agencyDigit: b.agencyDigit, account: b.account, accountDigit: b.accountDigit, accountType: b.accountType, pixType: b.pixType, pix: b.pix, holderName: b.holderName, holderDocument: b.holderDocument },
    definitions: [...d.definitions], oracles: [...d.oracles], techniques: [...d.techniques], spreads: [...d.spreads], channels: [...d.channels],
    equipment: [...d.equipment], themes: [...d.themes], weeklySchedule: { ...d.weeklySchedule }, preferredPaymentMethod: d.preferredPaymentMethod,
    ...(salvo.paymentMethods ? { paymentMethods: [...salvo.paymentMethods] } : {}),
    ...(salvo.capabilityGroups ? { capabilityGroups: JSON.parse(JSON.stringify(salvo.capabilityGroups)) } : {}),
    ...(salvo.capabilityNone ? { capabilityNone: [...salvo.capabilityNone] } : {}),
  };
}

/** `approvedRegistrationProjection`: a ficha aprovada que o diretório recebe (`GET ?approved=1`). */
function projecaoAprovada({ id, revisao, dados, tarotId }) {
  return { ...perfilPublico(dados, tarotId), registrationId: id, revision: revisao, commissionRate: dados.commissionRate, paymentBank: dados.bank.name, paymentSchedule: dados.paymentSchedule };
}

module.exports = {
  CadastroInvalidoError, foto, cadastroVazio, validarCadastro, perfilPublico, projecaoDoLink, projecaoAprovada, cpfValido, calendarioDePagamento, ORCAMENTO_FOTOS, dois,
};
