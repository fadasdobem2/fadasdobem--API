// Item 1: a bateria de entradas da validação, rodada na B (zod de real-payouts-http.server.ts + zod do db/finance-store.ts).
import { createFinanceStore } from "/FRONT/db/finance-store";
import { operationsError } from "/FRONT/features/auth/real-access.server";
import { __B } from "./b-http";
import { apoio, ATOR, resumo, VIGENCIA_FIXA } from "./comum";

const { gerarCasos } = apoio("gerador/casos-validacao");

// Pool que deixa a validação do store e a conferência da repetição passarem, e para na abertura da transação: chegar lá
// quer dizer "aceito", o resto é recusa de regra do store.
function lojaQueParaNaTransacao() {
  const estado = { chegou: false };
  const pool = {
    query: async () => [[]],
    getConnection: async () => ({
      beginTransaction: async () => { estado.chegou = true; throw new Error("PARADA"); },
      rollback: async () => undefined, release() {}, destroy() {},
    }),
  };
  const loja = createFinanceStore(pool as never, {
    now: () => 1, newId: () => "x",
    legacy: { tarologistExists: async () => true, findConsultation: async () => null, clientExists: async () => true },
  });
  return { loja, estado };
}

const recusada = async () => ({ aceito: false, ...(await resumo(operationsError("INVALID_INPUT", true))) });

async function tentarNoStore(chamar: (loja: ReturnType<typeof createFinanceStore>) => Promise<unknown>, entrada: unknown) {
  const { loja, estado } = lojaQueParaNaTransacao();
  try {
    await chamar(loja);
  } catch {
    // a recusa do store e a parada da transação caem aqui; `chegou` diz qual das duas foi
  }
  return estado.chegou ? { aceito: true, entrada } : recusada();
}

async function avaliarSemQueda(caso: { rota: string; params: Record<string, string>; corpoJson: string }) {
  const corpo = JSON.parse(caso.corpoJson);
  const { rota, params } = caso;
  if (rota === "commission" || rota === "schedule") {
    const tarotId = __B.TAROT_ID.safeParse(params.tarotId);
    const entrada = (rota === "commission" ? __B.commissionBody : __B.scheduleBody).safeParse(corpo);
    if (!tarotId.success || !entrada.success) return recusada();
    const base = { operationKey: entrada.data.operationKey, actor: ATOR, tarotId: tarotId.data, effectiveFrom: VIGENCIA_FIXA, reason: entrada.data.reason ?? null };
    if (rota === "commission") {
      const dado = { ...base, rate: (entrada.data as { rate: string }).rate };
      return tentarNoStore((l) => l.setCommissionRate(dado), semAtor(dado));
    }
    const dado = { ...base, schedule: (entrada.data as { schedule: unknown }).schedule };
    return tentarNoStore((l) => l.setPaymentSchedule(dado as never), semAtor(dado));
  }
  if (rota === "openings") {
    const entrada = __B.openingBody.safeParse(corpo);
    if (!entrada.success) return recusada();
    const dado = __B.openingInput(entrada.data, ATOR);
    return tentarNoStore((l) => l.draftOpening(dado), semAtor(dado));
  }
  const ref = __B.OPENING_ID.safeParse(params.ref);
  if (rota === "confirm") {
    const entrada = __B.confirmBody.safeParse(corpo);
    if (!ref.success || !entrada.success) return recusada();
    const dado = { operationKey: entrada.data.operationKey, actor: ATOR, openingId: ref.data };
    return tentarNoStore((l) => l.confirmOpening(dado), semAtor(dado));
  }
  const entrada = __B.correctionBody.safeParse(corpo);
  if (!ref.success || !entrada.success) return recusada();
  const dado = { ...__B.openingInput(entrada.data, ATOR), openingId: ref.data, reason: entrada.data.reason };
  return tentarNoStore((l) => l.correctOpening(dado), semAtor(dado));
}

// Achado: zod roda os `.refine` seguintes mesmo depois de a regex de MONEY falhar, e `moneyToCents` lança numa string que não
// é dinheiro (POSITIVE e NOT_NEGATIVE). A exceção sobe até o guarda, que responde 503 em vez do 400 da validação.
async function avaliar(caso: Parameters<typeof avaliarSemQueda>[0]) {
  try {
    return await avaliarSemQueda(caso);
  } catch (erro) {
    return { aceito: false, b503: true, motivo: String((erro as Error).message).slice(0, 60) };
  }
}

const semAtor = (dado: object) => JSON.parse(JSON.stringify({ ...dado, actor: undefined }));

export async function gerarValidacao() {
  const casos = gerarCasos().filter((c: { rota: string }) => c.rota !== "history");
  const saida = [];
  for (const caso of casos) saida.push({ ...caso, esperado: await avaliar(caso) });
  return saida;
}
