'use strict';

/**
 * Monta strings agregadas (admin G20a) + objeto `_raw` estruturado a partir do payload público.
 */

function joinList(arr) {
  if (!Array.isArray(arr)) return '';
  return arr.filter(Boolean).map((x) => `${x}`.trim()).filter(Boolean).join(' · ');
}

function serializeOraculos(raw = {}) {
  const arts = Array.isArray(raw.artes) ? raw.artes : [];
  const parts = [...arts];
  const tarot = joinList(raw.tarotTypes);
  const cigano = joinList(raw.ciganoSchools);
  if (arts.includes('Tarot') && tarot) parts.push(`Tarot (${tarot})`);
  if (arts.includes('Baralho Cigano') && cigano) parts.push(`Cigano (${cigano})`);
  const terapias = [
    ...joinList(raw.terapiasPresets || raw.terapias).split(' · ').filter(Boolean),
    ...joinList(raw.terapiasCustom || raw.customTherapies).split(' · ').filter(Boolean),
  ];
  if (terapias.length) parts.push(`Terapias: ${terapias.join(', ')}`);
  return parts.filter(Boolean).join(' · ') || '';
}

function serializeDisponibilidade(raw = {}) {
  const blocks = Array.isArray(raw.availBlocks) ? raw.availBlocks : [];
  if (!blocks.length) return '';
  return blocks
    .map((b) => {
      const days = Array.isArray(b.days) ? b.days.join(', ') : joinList(b.days);
      const from = `${b.from || b.inicio || ''}`.trim();
      const to = `${b.to || b.fim || ''}`.trim();
      if (!days && !from) return '';
      return `${days || '?'} ${from && to ? `${from}–${to}` : from || ''}`.trim();
    })
    .filter(Boolean)
    .join(' | ');
}

function serializeEquipamento(raw = {}) {
  const map = { desktop: 'Computador', notebook: 'Notebook', celular: 'Celular' };
  const devices = Array.isArray(raw.devices) ? raw.devices : [];
  return devices.map((d) => map[d] || d).join(' · ') || '';
}

function serializeVideo(raw = {}) {
  const v = `${raw.video ?? raw.atendeVideo ?? ''}`.toLowerCase();
  if (v === 'nao' || v === 'não' || v === 'false') return 'Não — só áudio ou texto';
  if (v === 'sim' || v === 'true') {
    const cam = raw.camera || raw.cameraPref;
    if (cam === 'rosto') return 'Sim — aparece na câmera';
    if (cam === 'maos') return 'Sim — só mãos/cartas';
    return 'Sim — vídeo';
  }
  return `${raw.video || ''}`.trim();
}

function serializeRedes(raw = {}) {
  const nets = raw.redes || raw.social || {};
  const rows = [];
  if (nets.facebook) rows.push(`Facebook: ${nets.facebook}`);
  if (nets.youtube) rows.push(`YouTube: ${nets.youtube}`);
  if (nets.instagram) rows.push(`Instagram: ${nets.instagram}`);
  if (nets.tiktok) rows.push(`TikTok: ${nets.tiktok}`);
  return rows.join(' · ') || '';
}

function parseIndicadaPor(comoChegou) {
  const s = `${comoChegou || ''}`.trim();
  if (!s) return '—';
  const m = s.match(/indica[cç][aã]o\s+(?:da?\s+|de\s+)?(.+)/i);
  return m ? m[1].trim().slice(0, 160) : '—';
}

function buildF1FromPublicBody(body = {}) {
  const raw = body.f1?._raw || body._raw || body.raw || {};
  const nested = body.f1 && typeof body.f1 === 'object' ? body.f1 : {};

  const nomeSocial = `${body.nomeSocial ?? body.nome_social ?? nested.nomeSocial ?? ''}`.trim();
  const nomeEsoterico = `${body.nomeEsoterico ?? body.nome_esoterico ?? body.apelido ?? nested.nomeEsoterico ?? ''}`.trim();
  const apresentacao = `${body.apresentacao ?? nested.apresentacao ?? ''}`.trim();
  const comoChegou = `${body.comoChegou ?? body.como_chegou ?? nested.comoChegou ?? body.origem ?? ''}`.trim();
  const email = `${body.email ?? nested.email ?? ''}`.trim();
  const telefone = `${body.telefone ?? body.phone ?? nested.telefone ?? ''}`.trim();
  const whatsapp = `${body.whatsapp ?? nested.whatsapp ?? ''}`.trim();
  const melhorHorario = `${body.melhorHorario ?? body.melhor_horario ?? nested.melhorHorario ?? ''}`.trim();

  const atendeHa = `${body.atendeHa ?? body.tempo_oraculista ?? body.tempoOraculista ?? nested.atendeHa ?? raw.atendeHa ?? ''}`.trim();
  const estudaHa = `${body.estudaHa ?? body.tempo_estudo ?? body.tempoEstudo ?? nested.estudaHa ?? raw.estudaHa ?? ''}`.trim();
  const sitesAtuais = `${body.sitesAtuais ?? body.sites_atuais ?? nested.sitesAtuais ?? raw.sitesAtuais ?? ''}`.trim();

  const metodologia = {
    estiloAtendimento: body.estiloAtendimento ?? body.estilo_atendimento ?? raw.estiloAtendimento ?? null,
    inicioConsulta: body.inicioConsulta ?? body.inicio_consulta ?? raw.inicioConsulta ?? null,
    tempoConsulta: body.tempoConsulta ?? body.tempo_consulta ?? raw.tempoConsulta ?? null,
  };

  const f1Flat = {
    apresentacao: apresentacao || body.f1?.apresentacao || '',
    oraculos: `${body.oraculos ?? nested.oraculos ?? ''}`.trim() || serializeOraculos(raw),
    atendeHa: atendeHa || '',
    estudaHa: estudaHa || '',
    disponibilidade:
      `${body.disponibilidade ?? nested.disponibilidade ?? ''}`.trim() || serializeDisponibilidade(raw),
    video: `${body.video ?? nested.video ?? ''}`.trim() || serializeVideo(raw),
    email,
    telefone,
    whatsapp,
    melhorHorario,
    comoChegou: comoChegou || 'Site',
    equipamento: `${body.equipamento ?? nested.equipamento ?? ''}`.trim() || serializeEquipamento(raw),
    redes: `${body.redes ?? nested.redes ?? ''}`.trim() || serializeRedes(raw),
    indicadaPor: `${body.indicadaPor ?? body.indicada_por ?? nested.indicadaPor ?? ''}`.trim() || parseIndicadaPor(comoChegou),
    sitesAtuais,
    terapias: joinList([
      ...(Array.isArray(raw.terapiasPresets) ? raw.terapiasPresets : Array.isArray(raw.terapias) ? raw.terapias : []),
      ...(Array.isArray(raw.terapiasCustom) ? raw.terapiasCustom : Array.isArray(raw.customTherapies) ? raw.customTherapies : []),
    ]),
    metodologia,
    _raw: {
      ...raw,
      nomeSocial,
      nomeEsoterico,
      artes: raw.artes || [],
      tarotTypes: raw.tarotTypes || [],
      ciganoSchools: raw.ciganoSchools || [],
      terapiasPresets: raw.terapiasPresets || [],
      terapiasCustom: raw.terapiasCustom || raw.customTherapies || [],
      availBlocks: raw.availBlocks || [],
      devices: raw.devices || [],
      video: raw.video ?? null,
      camera: raw.camera ?? null,
      redes: raw.redes || raw.social || {},
      metodologia,
      sitesAtuais,
    },
  };

  return {
    apelido: nomeEsoterico || nomeSocial || email.split('@')[0] || 'Candidata',
    nomeCivil: nomeSocial || null,
    email,
    telefone,
    whatsapp,
    origem: comoChegou || 'Site',
    f1: f1Flat,
  };
}

module.exports = {
  buildF1FromPublicBody,
  serializeOraculos,
  serializeDisponibilidade,
  serializeEquipamento,
  serializeVideo,
  serializeRedes,
};
