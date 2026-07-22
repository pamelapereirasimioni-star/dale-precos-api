const { detectarAtributos } = require("./atributos");

/**
 * Compara dois pesos em uma unidade padronizada.
 *
 * Esta função pressupõe que utils/peso.js devolve
 * um valor numérico comparável, por exemplo:
 * 500 g -> 500
 * 1 kg  -> 1000
 * 1 L   -> 1000
 */
function pesosCompativeis(pesoBusca, pesoProduto) {
  if (!pesoBusca || !pesoProduto) {
    return true;
  }

  const busca = Number(pesoBusca);
  const produto = Number(pesoProduto);

  if (
    !Number.isFinite(busca) ||
    !Number.isFinite(produto)
  ) {
    return true;
  }

  const diferenca = Math.abs(busca - produto);
  const tolerancia = Math.max(5, busca * 0.02);

  return diferenca <= tolerancia;
}

/**
 * Verifica conflitos entre atributos que não podem
 * coexistir no mesmo produto.
 */
function possuiConflitoDeFlags(flagsBusca, flagsProduto) {
  const gruposExcludentes = [
    [
      "integral",
      "semidesnatado",
      "desnatado"
    ],
    [
      "carioca",
      "preto",
      "branco",
      "rajado",
      "fradinho"
    ],
    [
      "tipo 1",
      "tipo 2"
    ],
    [
      "com sal",
      "sem sal"
    ],
    [
      "diet",
      "light",
      "zero"
    ],
    [
      "espaguete",
      "penne",
      "parafuso"
    ]
  ];

  for (const grupo of gruposExcludentes) {
    const flagBuscada = grupo.find((flag) =>
      flagsBusca.includes(flag)
    );

    const flagProduto = grupo.find((flag) =>
      flagsProduto.includes(flag)
    );

    if (
      flagBuscada &&
      flagProduto &&
      flagBuscada !== flagProduto
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Verifica se todas as características realmente
 * importantes da busca aparecem no produto.
 */
function possuiFlagsObrigatorias(flagsBusca, flagsProduto) {
  const flagsObrigatorias = [
    "integral",
    "semidesnatado",
    "desnatado",
    "zero lactose",
    "com lactose",
    "protein",
    "a2",
    "girassol",
    "soja",
    "carioca",
    "preto",
    "branco",
    "rajado",
    "fradinho",
    "parboilizado",
    "tipo 1",
    "tipo 2",
    "espaguete",
    "penne",
    "parafuso",
    "diet",
    "light",
    "sem sal",
    "com sal",
    "extra virgem",
    "soluvel",
    "descafeinado"
  ];

  for (const flag of flagsBusca) {
    if (
      flagsObrigatorias.includes(flag) &&
      !flagsProduto.includes(flag)
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Valida se o produto realmente corresponde à busca.
 *
 * Regras principais:
 * - categoria diferente: rejeita;
 * - marca diferente: rejeita;
 * - peso diferente: rejeita;
 * - tipo ou característica conflitante: rejeita;
 * - característica obrigatória ausente: rejeita.
 */
function validarCorrespondencia(
  termoBusca,
  produto
) {
  const nomeProduto =
    produto?.productName ||
    produto?.productTitle ||
    "";

  if (!nomeProduto) {
    return false;
  }

  const buscado =
    detectarAtributos(termoBusca);

  const encontrado =
    detectarAtributos(nomeProduto);

  /*
   * Categoria
   */
  if (
    buscado.categoria &&
    encontrado.categoria &&
    buscado.categoria !== encontrado.categoria
  ) {
    return false;
  }

  /*
   * Se a busca possui categoria conhecida,
   * mas o produto não possui nenhuma categoria,
   * não rejeitamos automaticamente.
   *
   * Isso evita perder produtos cujo título é curto.
   */

  /*
   * Marca
   *
   * Exemplo:
   * busca = Patéko
   * produto = Vapza
   * resultado = rejeitado
   */
  if (buscado.marca) {
    if (!encontrado.marca) {
      return false;
    }

    if (buscado.marca !== encontrado.marca) {
      return false;
    }
  }

  /*
   * Peso ou volume
   */
  if (
    buscado.peso &&
    encontrado.peso &&
    !pesosCompativeis(
      buscado.peso,
      encontrado.peso
    )
  ) {
    return false;
  }

  /*
   * Se a busca informa peso e o produto não apresenta
   * peso no nome, deixamos o score decidir.
   *
   * Isso evita rejeitar produtos cujo título do site
   * omite a quantidade.
   */

  const flagsBusca =
    buscado.flags || [];

  const flagsProduto =
    encontrado.flags || [];

  /*
   * Exemplo:
   * busca = feijão preto
   * produto = feijão carioca
   */
  if (
    possuiConflitoDeFlags(
      flagsBusca,
      flagsProduto
    )
  ) {
    return false;
  }

  /*
   * Exemplo:
   * busca = leite zero lactose
   * produto = leite integral comum
   */
  if (
    !possuiFlagsObrigatorias(
      flagsBusca,
      flagsProduto
    )
  ) {
    return false;
  }

  return true;
}

module.exports = {
  validarCorrespondencia,
  pesosCompativeis,
  possuiConflitoDeFlags,
  possuiFlagsObrigatorias
};