/*
 * Motor inteligente de geração de termos de busca.
 */

const PALAVRAS_DESCARTAVEIS = new Set([
  "emb", "embalagem", "pacote", "pcte", "pct",
  "tipo", "classe", "produto", "unidade",
  "unidades", "und", "un", "tradicional", "original"
]);

const PALAVRAS_IMPORTANTES = new Set([
  "zero", "integral", "desnatado", "semidesnatado",
  "semi", "light", "diet", "lactose", "gluten",
  "açucar", "acucar", "sem", "refinado",
  "parboilizado", "carioca", "preto", "branco",
  "vermelho", "longa", "vida", "lata", "pet"
]);

const SINONIMOS = [
  { encontrar: /\bsem\s+a[cç][uú]car\b/gi, substituir: "zero" },
  { encontrar: /\bzero\s+a[cç][uú]car\b/gi, substituir: "zero" },
  { encontrar: /\bsemi\s+desnatado\b/gi, substituir: "semidesnatado" },
  { encontrar: /\bsemi-desnatado\b/gi, substituir: "semidesnatado" },
  { encontrar: /\bcoca[\s-]*cola\b/gi, substituir: "coca cola" }
];

function removerAcentos(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizarEspacos(valor) {
  return String(valor || "").replace(/\s+/g, " ").trim();
}

function normalizarComparacao(valor) {
  return removerAcentos(valor)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aplicarSinonimos(valor) {
  let resultado = String(valor || "");
  for (const regra of SINONIMOS) {
    resultado = resultado.replace(regra.encontrar, regra.substituir);
  }
  return normalizarEspacos(resultado);
}

function extrairPesoOuVolume(valor) {
  const correspondencias = String(valor || "").match(
    /\b\d+(?:[.,]\d+)?\s*(?:kg|g|mg|ml|l|lt|litro|litros|un|und|unidade|unidades)\b/gi
  );
  if (!correspondencias) return [];

  return correspondencias.map((item) =>
    normalizarEspacos(
      item
        .replace(/\blt\b/gi, "l")
        .replace(/\blitros?\b/gi, "l")
        .replace(/\bunidades?\b/gi, "un")
        .replace(/\bund\b/gi, "un")
    )
  );
}

function removerPesoOuVolume(valor) {
  return normalizarEspacos(
    String(valor || "").replace(
      /\b\d+(?:[.,]\d+)?\s*(?:kg|g|mg|ml|l|lt|litro|litros|un|und|unidade|unidades)\b/gi,
      " "
    )
  );
}

function removerPalavrasDescartaveis(valor) {
  return normalizarEspacos(
    normalizarEspacos(valor)
      .split(" ")
      .filter(Boolean)
      .filter((token) => !PALAVRAS_DESCARTAVEIS.has(normalizarComparacao(token)))
      .join(" ")
  );
}

function removerRepeticoes(valor) {
  const vistos = new Set();
  const resultado = [];

  for (const token of normalizarEspacos(valor).split(" ").filter(Boolean)) {
    const chave = normalizarComparacao(token);
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    resultado.push(token);
  }

  return normalizarEspacos(resultado.join(" "));
}

function limitarPalavras(valor, limite) {
  return normalizarEspacos(valor)
    .split(" ")
    .filter(Boolean)
    .slice(0, limite)
    .join(" ");
}

function extrairPalavrasImportantes(valor) {
  return normalizarEspacos(valor)
    .split(" ")
    .filter(Boolean)
    .filter((token) => PALAVRAS_IMPORTANTES.has(normalizarComparacao(token)));
}

function adicionarTermo(lista, vistos, termo) {
  const limpo = normalizarEspacos(termo);
  if (!limpo) return;

  const chave = normalizarComparacao(limpo);
  if (!chave || vistos.has(chave)) return;

  vistos.add(chave);
  lista.push(limpo);
}

function gerarTermosBusca(termoOriginal, opcoes = {}) {
  const limite = Number(opcoes.limite) > 0 ? Number(opcoes.limite) : 6;
  const original = normalizarEspacos(termoOriginal);
  if (!original) return [];

  const termos = [];
  const vistos = new Set();

  const comSinonimos = aplicarSinonimos(original);
  const semRepeticoes = removerRepeticoes(comSinonimos);
  const pesos = extrairPesoOuVolume(semRepeticoes);
  const pesoPrincipal = pesos[0] || "";
  const semPeso = removerPesoOuVolume(semRepeticoes);
  const semDescartaveis = removerPalavrasDescartaveis(semPeso);
  const palavras = semDescartaveis.split(" ").filter(Boolean);
  const importantes = extrairPalavrasImportantes(semDescartaveis);

  adicionarTermo(termos, vistos, semRepeticoes);
  adicionarTermo(termos, vistos, semPeso);
  adicionarTermo(
    termos,
    vistos,
    [semDescartaveis, pesoPrincipal].filter(Boolean).join(" ")
  );

  if (palavras.length > 0) {
    adicionarTermo(
      termos,
      vistos,
      [limitarPalavras(semDescartaveis, 4), pesoPrincipal]
        .filter(Boolean)
        .join(" ")
    );
  }

  if (palavras.length >= 2) {
    adicionarTermo(
      termos,
      vistos,
      removerRepeticoes(
        [
          ...palavras.slice(-3),
          ...importantes,
          pesoPrincipal
        ].filter(Boolean).join(" ")
      )
    );
  }

  adicionarTermo(
    termos,
    vistos,
    limitarPalavras(semDescartaveis, 3)
  );

  if (palavras.length >= 2) {
    adicionarTermo(
      termos,
      vistos,
      palavras.slice(-2).join(" ")
    );
  }

  return termos.slice(0, limite);
}

module.exports = {
  gerarTermosBusca,
  aplicarSinonimos,
  extrairPesoOuVolume,
  removerPesoOuVolume,
  removerPalavrasDescartaveis,
  removerRepeticoes,
  normalizarComparacao
};
