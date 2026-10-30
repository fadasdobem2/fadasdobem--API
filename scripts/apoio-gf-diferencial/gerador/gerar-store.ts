// Item 3: o traço de SQL, as saídas e as tabelas finais da loja REAL da B (db/finance-store.ts) nos cenários compartilhados.
import { createFinanceStore } from "/FRONT/db/finance-store";
import { __B } from "./b-http";
import { apoio } from "./comum";

const { CENARIOS } = apoio("cenarios-store");
const { rodarCenario } = apoio("rodar-cenario");

export async function gerarStore() {
  const saida = [];
  for (const cenario of CENARIOS) {
    const r = await rodarCenario(cenario, (banco: { paraB: () => unknown }, d: { agora: () => number; novoId: () => string; legado: { tarologoExiste: (id: string) => Promise<boolean> } }) =>
      createFinanceStore(banco.paraB() as never, {
        now: d.agora, newId: d.novoId,
        legacy: { tarologistExists: d.legado.tarologoExiste, findConsultation: async () => null, clientExists: async () => true },
      }));
    // A resposta de uma gravação de abertura é a `openingView` do registro gravado, com os nomes das contas.
    const nomes = new Map([["conta-1", "Laya Souza"], ["conta-2", "Nice"]]);
    const vistas = r.saidas.map((s: { ok?: { revision?: number } }) => (s.ok && s.ok.revision !== undefined ? __B.openingView(s.ok as never, nomes) : null));
    saida.push({ nome: cenario.nome, ...r, vistas });
  }
  return saida;
}
