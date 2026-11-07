'use strict';

/**
 * Cobertura do snapshot (Maturacao/59, 3.11): por assunto, o que foi lido e se a leitura foi TOTAL. `complete` só é true quando todo assunto
 * EXIGIDO pelo evento terminou com cobertura total. Falha ou limite estourado => assunto vazio e `complete:false`; nunca uma lista parcial
 * apresentada como total. Só o NOME da falha vai ao registro (nunca mensagem, SQL ou dado).
 */

class LimiteExcedido extends Error {
  constructor(assunto) { super(`limite excedido: ${assunto}`); this.name = 'LimiteExcedido'; this.assunto = assunto; }
}

const motivoDe = (e) => {
  if (e instanceof LimiteExcedido) return 'limite';
  const codigo = e && e.dados && e.dados.codigo;
  return `falha:${typeof codigo === 'string' ? codigo : (e && e.name) || 'erro'}`;
};

class Cobertura {
  constructor() { this.itens = {}; }

  /** Roda a leitura de um assunto. Em falha devolve `vazio` e registra o motivo; o erro não sobe. */
  async montar(assunto, leitura, vazio = [], contar = null) {
    try {
      const valor = await leitura();
      const contagem = contar ? contar(valor) : Array.isArray(valor) ? valor.length : (valor ? 1 : 0);
      this.itens[assunto] = { ok: true, contagem };
      return valor;
    } catch (e) {
      this.itens[assunto] = { ok: false, contagem: 0, motivo: motivoDe(e) };
      return vazio;
    }
  }

  /** Marca coberto sem leitura (assunto que o evento não exige). */
  naoAplicavel(assunto) { this.itens[assunto] = { ok: true, contagem: 0, motivo: 'nao-aplicavel' }; }

  /** Assunto que o contrato exige mas a API não tem de onde ler: nunca fica completo. */
  semFonte(assunto) { this.itens[assunto] = { ok: false, contagem: 0, motivo: 'sem-fonte' }; }

  /** Cobertura parcial de um campo opcional de um assunto já lido (ex.: saldo): o assunto passa a incompleto, o conteúdo fica. */
  rebaixar(assunto, motivo) {
    const atual = this.itens[assunto] || { contagem: 0 };
    this.itens[assunto] = { ...atual, ok: false, motivo };
  }

  completo(exigidos) {
    return [...exigidos].every((a) => this.itens[a] && this.itens[a].ok === true);
  }

  /** Para o registro: só nomes de assunto, contagens e motivos curtos. */
  resumo() {
    return Object.fromEntries(Object.entries(this.itens).map(([a, i]) => [a, i.ok ? `ok:${i.contagem}` : `incompleto:${i.motivo}`]));
  }
}

module.exports = { Cobertura, LimiteExcedido };
