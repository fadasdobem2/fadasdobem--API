// Ponto de entrada do gerador do ouro (ver scripts/gerar-ouro-gf-diferencial-b.js): escreve os JSON em GF_OURO_SAIDA.
import { mkdirSync, writeFileSync } from "node:fs";
import { gerarAmpliacao } from "./gerar-ampliacao";
import { gerarDto } from "./gerar-dto";
import { gerarStore } from "./gerar-store";
import { gerarValidacao } from "./gerar-validacao";

const saida = process.env.GF_OURO_SAIDA as string;
mkdirSync(saida, { recursive: true });
const gravar = (nome: string, dado: unknown) => { writeFileSync(`${saida}/${nome}`, `${JSON.stringify(dado)}\n`); console.log(`  ${nome}`); };

async function principal() {
  const validacao = await gerarValidacao();
  const aceitos = validacao.filter((c) => c.esperado.aceito).length;
  console.log(`validacao: ${validacao.length} casos, ${aceitos} aceitos, ${validacao.length - aceitos} recusados`);
  gravar("validacao.json", validacao);
  const dto = await gerarDto();
  console.log(`dto: ${dto.length} cenarios, ${dto.filter((d) => "erro" in d.esperado).length} com linha fora do formato`);
  gravar("dto.json", dto);
  const store = await gerarStore();
  console.log(`store: ${store.length} cenarios`);
  gravar("store.json", store);
  const ampliacao = await gerarAmpliacao();
  console.log(`ampliacao: ${ampliacao.unicos.length} pedidos, ${ampliacao.sequencias.length} sequencias`);
  gravar("ampliacao.json", ampliacao);
}
principal().catch((e) => { console.error(e); process.exit(1); });
