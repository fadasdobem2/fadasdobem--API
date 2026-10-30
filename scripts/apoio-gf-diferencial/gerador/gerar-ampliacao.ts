// history-access: a B (real-clients-http.server.ts: LEGACY_ID, GRANT_BODY, plano e conferência da liberação, appendOnce
// real sobre gf_auditoria) com a bateria de entradas e sequências de repetição.
import { operationKeyConflict, operationsError } from "/FRONT/features/auth/real-access.server";
import { saoPauloTimestamp } from "/FRONT/features/domain/formatters";
import { createPayoutAudit } from "/FRONT/features/integrations/payout-audit";
import { planRealClientHistoryGrant, sameRealClientHistoryGrant } from "/FRONT/features/clientes/real-clients-model";
import { __C } from "./b-clients";
import { apoio, resumo } from "./comum";

const { gerarCasos } = apoio("gerador/casos-validacao");
const { criarExecutorDeAuditoria } = apoio("auditoria-falsa");
const { SEQUENCIAS } = apoio("gerador/sequencias-ampliacao");

type Pedido = { id: unknown; corpoJson: string; papel: string; sessao: string; existe: boolean; conta?: string };

// handleClientHistoryAccess, passo a passo, sobre o executor de auditoria dado.
async function pedidoNaB(p: Pedido, executor: { execute: unknown }, relogio: { agora: () => number; novoId: () => string }) {
  const clientId = __C.LEGACY_ID.safeParse(p.id);
  const entrada = __C.GRANT_BODY.safeParse(JSON.parse(p.corpoJson));
  const erro = async (codigo: "INVALID_INPUT" | "ACCESS_DENIED" | "CLIENT_NOT_FOUND") => ({ ...(await resumo(operationsError(codigo, true))) });
  if (!clientId.success || !entrada.success) return erro("INVALID_INPUT");
  const ator = { accountId: p.conta ?? "conta-1", role: p.papel as "supervisora" };
  const plano = planRealClientHistoryGrant({ clientId: clientId.data, actor: ator, sessionId: p.sessao }, entrada.data.reason);
  if ("denied" in plano) return erro(plano.denied === "input" ? "INVALID_INPUT" : "ACCESS_DENIED");
  if (!p.existe) return erro("CLIENT_NOT_FOUND");
  const auditoria = createPayoutAudit(executor as never, { now: relogio.agora, newId: relogio.novoId });
  const registro = await auditoria.appendOnce(plano.fact, entrada.data.operationKey);
  if (!sameRealClientHistoryGrant(registro, plano.fact)) return { ...(await resumo(operationKeyConflict())) };
  return { status: 201, grant: { id: registro.id, clientId: clientId.data, grantedAt: saoPauloTimestamp(new Date(registro.createdAt)) } };
}

const relogioNovo = () => { let t = 1_790_000_000_000, n = 0; return { agora: () => (t += 1000), novoId: () => `aud-${++n}` }; };

export async function gerarAmpliacao() {
  const unicos = [];
  for (const c of gerarCasos().filter((x: { rota: string }) => x.rota === "history")) {
    const pedido: Pedido = { id: c.params.id, corpoJson: c.corpoJson, papel: c.papel, sessao: c.sessao, existe: c.existe };
    if (typeof c.sessao !== "string" || c.sessao === "") continue; // sem sessão a A recusa de propósito (501); fica fora do ouro
    const executor = criarExecutorDeAuditoria();
    unicos.push({ pedido, esperado: await pedidoNaB(pedido, executor, relogioNovo()), linhas: executor.linhas });
  }
  const sequencias = [];
  for (const seq of SEQUENCIAS) {
    const executor = criarExecutorDeAuditoria();
    const relogio = relogioNovo();
    const saidas = [];
    for (const passo of seq.passos) saidas.push(await pedidoNaB(passo, executor, relogio));
    sequencias.push({ nome: seq.nome, passos: seq.passos, esperado: saidas, linhas: executor.linhas });
  }
  return { unicos, sequencias };
}
