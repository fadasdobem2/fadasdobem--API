// Item 2: os DTOs de resposta da B (acordo e abertura) a partir de linhas de banco simuladas, pelas funções reais da B
// (db/finance-store.ts lê e valida as linhas; real-payouts-http.server.ts monta a resposta).
import { createFinanceStore } from "/FRONT/db/finance-store";
import { __B } from "./b-http";
import { apoio } from "./comum";

const { gerarCenariosDto } = apoio("gerador/linhas-dto");

type Linha = Record<string, unknown>;
const por = (campos: string[]) => (a: Linha, b: Linha) => {
  for (const c of campos) {
    const x = a[c] as string | number, y = b[c] as string | number;
    const ambosNumero = c === "registrado_em" || c === "sequencia" || c === "revisao";
    const [m, n] = ambosNumero ? [Number(x), Number(y)] : [x, y];
    if (m < n) return -1;
    if (m > n) return 1;
  }
  return 0;
};

// Responde ao SQL da B como o MariaDB: o filtro por tarólogo e o ORDER BY de cada consulta (as linhas chegam embaralhadas).
function poolDeLeitura(c: { linhas: Record<string, Linha[]>; contas: Record<string, string> }) {
  const L = c.linhas;
  return {
    query: async (sql: string, p: unknown[]) => {
      const t = p[0];
      const abertas = L.aberturas.filter((r) => r.tarot_id === t);
      const dividas = L.dividas.filter((r) => r.tarot_id === t);
      let linhas: Linha[];
      if (/FROM gf_repasse_percentuais/.test(sql)) linhas = L.percentuais.filter((r) => r.tarot_id === t).sort(por(["vigente_desde", "id"]));
      else if (/FROM gf_repasse_calendarios/.test(sql)) linhas = L.calendarios.filter((r) => r.tarot_id === t).sort(por(["vigente_desde", "id"]));
      else if (/FROM gf_repasse_divida_parcelas/.test(sql)) linhas = L.parcelas.filter((r) => dividas.some((d) => d.id === r.divida_id)).sort(por(["divida_id", "sequencia"]));
      else if (/FROM gf_repasse_dividas/.test(sql)) linhas = dividas.sort(por(["registrado_em", "id"]));
      else if (/FROM gf_repasse_ajustes/.test(sql)) linhas = L.ajustes.filter((r) => r.tarot_id === t).sort(por(["registrado_em", "id"]));
      else if (/FROM gf_repasse_abertura_pendencias/.test(sql)) linhas = L.pendencias.filter((r) => abertas.some((a) => a.id === r.abertura_id)).sort(por(["abertura_id", "id"]));
      else if (/FROM gf_repasse_aberturas/.test(sql)) {
        linhas = abertas.sort(por(["revisao"])).map((r) => ({ ...r, corrige_id: abertas.find((o) => o.revisao === r.corrige_revisao)?.id ?? null }));
      } else if (/FROM gf_auth_accounts/.test(sql)) linhas = p.filter((id) => c.contas[id as string]).map((id) => ({ id, display_name: c.contas[id as string] }));
      else throw new Error(`consulta não prevista: ${sql.slice(0, 60)}`);
      return [structuredClone(linhas)];
    },
  };
}

async function lerDaB(c: Parameters<typeof poolDeLeitura>[0] & { tarotId: string }) {
  const finance = createFinanceStore(poolDeLeitura(c) as never, { now: () => 1, newId: () => "x", legacy: { tarologistExists: async () => true, findConsultation: async () => null, clientExists: async () => true } });
  try {
    const acordo = await __B.agreementOf(finance, c.tarotId);
    // Como handleOpening monta a resposta.
    const aberturas = await finance.listOpenings(c.tarotId);
    const nomes = await finance.listAccountNames(__B.namesIn(aberturas));
    const vista = (item: (typeof aberturas)[number] | null) => (item === null ? null : __B.openingView(item, nomes));
    const resposta = {
      current: vista(__B.currentOf(aberturas)), draft: vista(aberturas.find((i) => i.status === "rascunho") ?? null), revisions: aberturas.map((i) => __B.openingView(i, nomes)),
    };
    return { acordo, aberturas: resposta };
  } catch {
    return { erro: true };
  }
}

export async function gerarDto() {
  const saida = [];
  for (const c of gerarCenariosDto()) saida.push({ tarotId: c.tarotId, linhas: c.linhas, contas: c.contas, defeito: c.defeito ?? null, esperado: await lerDaB(c) });
  return saida;
}
