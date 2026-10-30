'use strict';

/** Compara os portes (`motivos-financeiros`, `adicionais`, `pendencias-adicional`, `log-operacional`) com o ouro do código do front. Devolve `{ ok, falhas, detalhe }`. */

const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..', '..', 'src', 'gestao-fadas', '_comum', 'dominio');
const mot = require(path.join(raiz, 'motivos-financeiros'));
const adi = require(path.join(raiz, 'adicionais'));
const pen = require(path.join(raiz, 'pendencias-adicional'));
const log = require(path.join(raiz, 'log-operacional'));

const clonar = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x));
const estavel = (v) => (Array.isArray(v) ? `[${v.map(estavel).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${estavel(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
const igual = (a, b) => estavel(a) === estavel(b);
const tentar = (fn) => { try { return { ok: fn() }; } catch (e) { return { erro: e.message, nome: e.name }; } };

function verificar(arquivo = path.join(__dirname, 'ouro-estado-front.json')) {
  const ouro = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const falhas = []; let ok = 0; const detalhe = { motivos: 0, recusasMotivos: 0, adicionais: 0, recusasAdicionais: 0, pendencias: 0, lojas: 0, trilhas: 0 };
  const marcar = (nome, bom, extra = '') => { if (bom) ok += 1; else falhas.push(`${nome} ${extra}`); };

  marcar('sementes iguais às do front', igual(mot.sementes(), ouro.sementes.reasons));
  ouro.motivos.forEach((c, n) => {
    let loja = clonar(ouro.sementes);
    c.passos.forEach((p, k) => {
      detalhe.motivos += 1;
      const r = p.op === 'add'
        ? tentar(() => mot.adicionar(loja, p.entrada, p.ator, p.at, p.papel))
        : tentar(() => mot.revisar(loja, p.id, p.versao, p.entrada, p.ator, p.at, p.papel));
      const nome = `motivo #${n}.${k} ${p.op}`;
      if (p.resultado.erro !== undefined) {
        detalhe.recusasMotivos += 1;
        marcar(`${nome} recusa`, r.erro === p.resultado.erro && r.nome === 'MotivoInvalidoError', `front="${p.resultado.erro}" servidor="${r.erro || 'aceitou'}"`);
      } else {
        const novos = r.ok ? (p.op === 'add' ? r.ok.loja : r.ok).reasons.slice(loja.reasons.length) : null;
        marcar(`${nome} aceita`, Boolean(r.ok) && igual(novos, p.resultado.novos) && (p.op !== 'add' || igual(r.ok.motivo, p.resultado.motivo)), r.erro || 'diferente');
        if (r.ok) loja = clonar(p.op === 'add' ? r.ok.loja : r.ok);
      }
    });
    marcar(`motivo #${n} loja final`, igual(loja, c.final));
    marcar(`motivo #${n} validação`, mot.lojaValida(c.final) === c.valida);
    marcar(`motivo #${n} normalização`, igual(mot.normalizarLoja(c.final), c.normalizada === 'igual' ? c.final : c.normalizada));
  });
  ouro.adulteradas.forEach((c, n) => {
    detalhe.lojas += 1;
    marcar(`loja adulterada #${n} (${c.mut})`, mot.lojaValida(c.loja) === c.valida);
    marcar(`loja adulterada #${n} normalização`, igual(mot.normalizarLoja(c.loja), c.normalizada === 'igual' ? c.loja : c.normalizada));
  });

  ouro.adicionais.forEach((c, n) => {
    let loja = adi.lojaVazia(); let ajustes = [];
    marcar(`adicional #${n} loja vazia`, n > 0 || igual(loja, { version: 1, categories: [{ id: 'carta-do-dia', name: 'Carta do dia' }, { id: 'monitoria', name: 'Monitoria' }, { id: 'outros', name: 'Outros' }], rules: [], occurrences: [] }));
    c.passos.forEach((p, k) => {
      detalhe.adicionais += 1;
      const e = p.entrada; let r;
      if (p.tipo === 'cat') r = tentar(() => ({ loja: adi.adicionarCategoria(loja, e), ajustes }));
      else if (p.tipo === 'rev') r = tentar(() => ({ loja: { ...loja, categories: adi.revisarCategoria(loja.categories, e.id, { name: e.name, active: e.active }, e.ator, p.at) }, ajustes }));
      else if (p.tipo === 'regra') r = tentar(() => ({ loja: adi.adicionarRegra(loja, e.regra, e.hoje), ajustes }));
      else if (p.tipo === 'mud') r = tentar(() => ({ loja: adi.mudarRegra(loja, e.id, e.acao, e.data, p.at, e.por), ajustes }));
      else if (p.tipo === 'mat') r = tentar(() => adi.materializar(loja, ajustes, e.ate, p.at, e.por));
      else r = tentar(() => adi.resolver(loja, ajustes, e.id, e.quantidade, e.hoje, p.at, e.por));
      const nome = `adicional #${n}.${k} ${p.tipo}`;
      if (p.resultado.erro !== undefined) {
        detalhe.recusasAdicionais += 1;
        marcar(`${nome} recusa`, r.erro === p.resultado.erro && r.nome === 'AdicionalInvalidoError', `front="${p.resultado.erro}" servidor="${r.erro || 'aceitou'}"`);
      } else {
        marcar(`${nome} aceita`, Boolean(r.ok) && igual(r.ok.loja, p.resultado.loja) && igual(r.ok.ajustes, p.resultado.ajustes), r.erro || 'diferente');
        if (r.ok) { loja = clonar(r.ok.loja); ajustes = clonar(r.ok.ajustes); }
      }
    });
    marcar(`adicional #${n} armazém final`, igual(loja, c.final) && igual(ajustes, c.ajustes));
    marcar(`adicional #${n} validação`, adi.lojaValida(c.final) === c.valida);
    for (const q of c.pendencias) {
      detalhe.pendencias += q.itens.length;
      marcar(`adicional #${n} pendências até ${q.ate}`, igual(pen.itensDeAdicional(c.final, c.nomes, q.ate), q.itens));
    }
    marcar(`adicional #${n} origens`, igual(pen.origensDeAdicional(c.final), c.final.occurrences.map((o) => `addition:${o.id}`)));
  });
  ouro.adicionaisRuins.forEach((c, n) => { detalhe.lojas += 1; marcar(`armazém adulterado #${n} (${c.mut})`, adi.lojaValida(c.loja) === c.valida); });

  ouro.trilha.forEach((c, n) => {
    detalhe.trilhas += 1;
    const servidor = tentar(() => log.validar(clonar(c.linhas)));
    // O servidor só é MAIS estrito no que o front não confere (antes/depois fora de objeto, id acima de 200); o ouro não os tem.
    const maisEstrito = c.linhas.some((l) => l && (l.id === '' || (typeof l.id === 'string' && l.id.length > 200)));
    marcar(`trilha #${n}`, Boolean(servidor.ok) === c.valida || (maisEstrito && !servidor.ok && c.valida), `front=${c.valida}`);
  });
  return { ok, falhas, detalhe };
}

module.exports = { verificar };
