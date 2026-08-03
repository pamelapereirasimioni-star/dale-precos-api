/*
 * Motor inteligente de geração de termos de busca.
 *
 * Gera consultas do mais específico para o mais amplo,
 * usando atributos detectados quando disponíveis.
 */

const PALAVRAS_DESCARTAVEIS = new Set([
  "emb", "embalagem", "pacote", "pcte", "pct",
  "tipo", "classe", "produto", "unidade",
  "unidades", "und", "un", "tradicional",
  "original", "especial", "caixa"
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
  return String(valor || "")
    .replace(/\s+/g, " ")
    .trim();
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
    resultado = resultado.replace(
      regra.encontrar,
      regra.substituir
    );
  }

  return normalizarEspacos(resultado);
}

function extrairPesoOuVolume(valor) {
  const correspondencias = String(valor || "").match(
    /\b\d+(?:[.,]\d+)?\s*(?:kg|g|mg|ml|l|lt|litro|litros|un|und|unidade|unidades)\b/gi
  );

  if (!correspondencias) {
    return [];
  }

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
      .filter(
        (token) =>
          !PALAVRAS_DESCARTAVEIS.has(
            normalizarComparacao(token)
          )
      )
      .join(" ")
  );
}

function removerRepeticoes(valor) {
  const vistos = new Set();
  const resultado = [];

  for (
    const token of normalizarEspacos(valor)
      .split(" ")
      .filter(Boolean)
  ) {
    const chave = normalizarComparacao(token);

    if (!chave || vistos.has(chave)) {
      continue;
    }

    vistos.add(chave);
    resultado.push(token);
  }

  return normalizarEspacos(resultado.join(" "));
}

function adicionarTermo(lista, vistos, partes) {
  const termo = removerRepeticoes(
    (Array.isArray(partes) ? partes : [partes])
      .filter(Boolean)
      .join(" ")
  );

  if (!termo) {
    return;
  }

  const chave = normalizarComparacao(termo);

  if (!chave || vistos.has(chave)) {
    return;
  }

  vistos.add(chave);
  lista.push(termo);
}

function gerarTermosBusca(
  termoOriginal,
  opcoes = {}
) {
  const limite =
    Number(opcoes.limite) > 0
      ? Number(opcoes.limite)
      : 8;

  const original = normalizarEspacos(
    termoOriginal
  );

  if (!original) {
    return [];
  }

  const termos = [];
  const vistos = new Set();

  const normalizado = removerRepeticoes(
    aplicarSinonimos(original)
  );

  const pesoOriginal =
    extrairPesoOuVolume(normalizado)[0] ||
    opcoes.pesoTexto ||
    "";

  const semPeso =
    removerPesoOuVolume(normalizado);

  const simplificado =
    removerPalavrasDescartaveis(semPeso);

  const marca = normalizarEspacos(
    opcoes.marca || ""
  );

  const categoria = normalizarEspacos(
    opcoes.categoria || ""
  );

  const flags = Array.isArray(opcoes.flags)
    ? opcoes.flags
    : [];

  const flagsTexto = flags
    .map((flag) =>
      String(flag || "")
        .replace(/_/g, " ")
    )
    .filter(Boolean)
    .join(" ");

  /*
   * 1. Consulta original normalizada.
   */
  adicionarTermo(
    termos,
    vistos,
    normalizado
  );

  /*
   * 2. Categoria + marca + características + peso.
   * Ex.: CREME DENTAL COLGATE TRIPLA AÇÃO 90g
   */
  adicionarTermo(
    termos,
    vistos,
    [
      categoria,
      marca,
      flagsTexto,
      pesoOriginal
    ]
  );

  /*
   * 3. Categoria + marca + peso.
   * Ex.: AÇÚCAR UNIÃO 1kg
   */
  adicionarTermo(
    termos,
    vistos,
    [
      categoria,
      marca,
      pesoOriginal
    ]
  );

  /*
   * 4. Marca + características + peso.
   * Ex.: COLGATE TRIPLA AÇÃO 90g
   */
  adicionarTermo(
    termos,
    vistos,
    [
      marca,
      flagsTexto,
      pesoOriginal
    ]
  );

  /*
   * 5. Nome simplificado + peso.
   */
  adicionarTermo(
    termos,
    vistos,
    [
      simplificado,
      pesoOriginal
    ]
  );

  /*
   * 6. Marca + peso.
   * Ex.: UNIÃO 1kg
   */
  adicionarTermo(
    termos,
    vistos,
    [
      marca,
      pesoOriginal
    ]
  );

  /*
   * 7. Categoria + marca.
   */
  adicionarTermo(
    termos,
    vistos,
    [
      categoria,
      marca
    ]
  );

  /*
   * 8. Apenas marca.
   */
  adicionarTermo(
    termos,
    vistos,
    marca
  );

  /*
   * Fallbacks quando detectarAtributos não reconhece
   * marca ou categoria.
   */
  const palavras = simplificado
    .split(" ")
    .filter(Boolean);

  if (!marca && palavras.length >= 2) {
    adicionarTermo(
      termos,
      vistos,
      [
        ...palavras.slice(-3),
        pesoOriginal
      ]
    );

    adicionarTermo(
      termos,
      vistos,
      palavras.slice(-2)
    );
  }

  if (!categoria && palavras.length >= 3) {
    adicionarTermo(
      termos,
      vistos,
      [
        ...palavras.slice(0, 3),
        pesoOriginal
      ]
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
