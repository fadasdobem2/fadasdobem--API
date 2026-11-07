'use strict';

/** Busca por telefone: 8 x 9 dígitos, telefone compartilhado, nenhuma candidata, limite, falha, sem DDD, extensão da ficha e DDD divergente. */

module.exports = async ({ r, snap, body, contato, legado, conferir, passo }) => {
  const tel = require(r('src/gestao-fadas/features/lilly/contexto/contexto.telefone'));
  // `fullPhone` da Lilly (registration-format.mjs): igualdade do texto +DDI..., número sem DDD descartado, 8 não casa com 9.
  const fullPhone = (v) => { const t = `${v}`.trim(); if (!/^\+?[\d\s().-]+$/.test(t)) return ''; const d = t.replace(/\D/g, ''); return t.startsWith('+') && d.length >= 10 && d.length <= 15 && !(d.startsWith('55') && [10, 11].includes(d.length)) ? `+${d}` : ''; };
  // Fila e consultas do dia vazias: assim `clients` mostra SÓ as candidatas da busca.
  const semFila = { agenda: async () => [], consultas: async () => [] };
  const porTelefone = (phone, conversa = 'chat-C', trocas = {}) => snap(body({ conversationId: conversa }, { id: conversa, contact: contato(phone) }), { trocas: { ...semFila, ...trocas } });
  const ids = (s) => s.snapshot.clients.map((c) => c.id).sort();

  console.log('Telefone');
  await passo('normaliza o observado e formata `+55 DD número`; sem DDD vira vazio (nunca inventa DDD)', async () => {
    conferir('com +55', tel.normalizarObservado('+55 11 99888-7777') === '+5511998887777');
    conferir('sem + e com 55', tel.normalizarObservado('5511998887777') === '+5511998887777');
    conferir('sem DDI', tel.normalizarObservado('11998887777') === '+5511998887777');
    conferir('9 dígitos sem DDD', tel.normalizarObservado('998887777') === '');
    conferir('+55 com 10/11 dígitos (sem DDD) não vale', tel.normalizarObservado('+55 998887777') === '');
    conferir('formato do painel', tel.textoParaLilly('11998887777') === '+55 11 99888-7777' && tel.textoParaLilly('(11) 3333-4444') === '+55 11 3333-4444');
  });
  await passo('9 dígitos observado = 9 dígitos cadastrado: candidata única, sem marca de nono dígito, phoneLookup completo', async () => {
    const s = await porTelefone('+5511998887777');
    conferir('uma candidata (Ana)', ids(s).join() === '900101');
    conferir('telefone normalizado', s.snapshot.clients[0].phones.includes('+55 11 99888-7777') && fullPhone(s.snapshot.clients[0].phones[0]) === '+5511998887777');
    conferir('sem phoneMatch', s.snapshot.clients[0].phoneMatch === undefined);
    conferir('phoneLookup completo e igual ao normalizado', s.snapshot.phoneLookup.complete === true && s.snapshot.phoneLookup.phone === '+5511998887777');
    conferir('snapshot completo', s.snapshot.complete === true);
  });
  await passo('observado de 9 dígitos x cadastro de 8: o painel casa pelo nono dígito e a API devolve o número no formato do observado', async () => {
    const s = await porTelefone('+5511998776666');
    const duda = s.snapshot.clients.find((c) => c.id === '900104');
    conferir('Duda é candidata, marcada ninth_digit', Boolean(duda) && duda.phoneMatch === 'ninth_digit');
    conferir('a Lilly (fullPhone) casa com o telefone devolvido', duda.phones.map(fullPhone).includes('+5511998776666'));
    conferir('phoneLookup completo', s.snapshot.phoneLookup.complete === true);
  });
  await passo('observado de 8 dígitos x cadastro de 9: também casa pelo nono dígito', async () => {
    const s = await porTelefone('+551198887777');
    const ana = s.snapshot.clients.find((c) => c.id === '900101');
    conferir('Ana candidata, ninth_digit, número no formato do observado', Boolean(ana) && ana.phoneMatch === 'ninth_digit' && ana.phones.map(fullPhone).includes('+551198887777'));
  });
  await passo('telefone compartilhado: todas as candidatas vão (a Lilly decide a pendência) e a busca é completa', async () => {
    const s = await porTelefone('+5531977771234');
    conferir('duas candidatas', ids(s).join() === '900105,900106');
    conferir('phoneLookup completo', s.snapshot.phoneLookup.complete === true);
  });
  await passo('nenhuma candidata COM cobertura completa: lista vazia e phoneLookup {complete:true} (não existe, não "não sei")', async () => {
    const s = await porTelefone('+5585911112222');
    conferir('sem clientes', s.snapshot.clients.length === 0);
    conferir('phoneLookup completo', s.snapshot.phoneLookup.complete === true && s.snapshot.complete === true);
  });
  await passo('mais de 50 candidatas: busca NÃO completa, clients vazio, snapshot incompleto', async () => {
    const s = await porTelefone('+5551912345678');
    conferir('phoneLookup incompleto', s.snapshot.phoneLookup.complete === false);
    conferir('clients vazio e complete:false', s.snapshot.clients.length === 0 && s.snapshot.complete === false);
    conferir('motivo registrado', /limite/.test(s.cobertura.resumo().phoneLookup));
  });
  await passo('legado fora do ar: phoneLookup incompleto, nenhum cliente, complete:false; os outros assuntos seguem', async () => {
    legado.estado.falhas.add('usuarios');
    const s = await porTelefone('+5511998887777');
    legado.estado.falhas.delete('usuarios');
    conferir('phoneLookup incompleto', s.snapshot.phoneLookup.complete === false && s.snapshot.clients.length === 0 && s.snapshot.complete === false);
    conferir('tarólogos seguem', s.snapshot.tarologists.length >= 2);
    conferir('cobertura marca a busca por telefone como incompleta', /^incompleto/.test(s.cobertura.resumo().phoneLookup));
  });
  await passo('telefone sem DDD: phoneLookup complete:false (cai na conferência humana)', async () => {
    const s = await porTelefone('998887777');
    conferir('incompleto', s.snapshot.phoneLookup.complete === false && s.snapshot.clients.length === 0 && s.snapshot.complete === false);
  });
  await passo('WhatsApp editado na ficha (gf_clientes_ext) também é candidato, mesmo com outro telefone no legado', async () => {
    const s = await porTelefone('+5511955554321');
    conferir('Gabi é candidata', ids(s).join() === '900107');
    conferir('WhatsApp da ficha normalizado', s.snapshot.clients[0].whatsapp === '+55 11 95555-4321');
  });
  await passo('ddd x ddd_real divergentes: a busca é incompleta (não afirma o DDD), a candidata ainda vai', async () => {
    const s = await porTelefone('+5511944445555');
    conferir('Hana listada e phoneLookup incompleto', ids(s).join() === '900108' && s.snapshot.phoneLookup.complete === false && s.snapshot.complete === false);
  });
  await passo('conversa JÁ vinculada: não busca por telefone (nada de phoneLookup)', async () => {
    const antes = legado.estado.chamadas.porTelefone;
    const s = await snap(body({ conversationId: 'chat-A' }, { id: 'chat-A', contact: contato('+5511998887777') }));
    conferir('sem consulta ao legado por telefone e sem phoneLookup', legado.estado.chamadas.porTelefone === antes && s.snapshot.phoneLookup === undefined);
  });
};
