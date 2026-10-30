// Peças comuns do gerador do ouro (roda na cópia do FRONT da B, com tsx; ver scripts/gerar-ouro-gf-diferencial-b.js).
import { createRequire } from "node:module";

const raizA = process.env.GF_A_RAIZ as string;
export const requireA = createRequire(`${raizA}/package.json`);
export const apoio = (nome: string) => requireA(`${raizA}/scripts/apoio-gf-diferencial/${nome}`);

export const ATOR = { accountId: "conta-1", role: "administradora" as const };
export const VIGENCIA_FIXA = "2026-10-29 12:00:00"; // o agora fixo dos dois lados: 2026-10-29T15:00:00Z em São Paulo

/** Resposta HTTP da B reduzida ao que o contrato fixa: status, código e mensagem. */
export async function resumo(resposta: Response) {
  const corpo = (await resposta.json()) as { error: { code: string; message: string } };
  return { status: resposta.status, code: corpo.error.code, message: corpo.error.message };
}
