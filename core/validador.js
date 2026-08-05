const { detectarAtributos } = require("./atributos");

function pesosCompativeis(pesoBusca, pesoProduto) {
  if (!pesoBusca || !pesoProduto) {
    return true;
  }

  const busca = Number(pesoBusca);
  const produto = Number(pesoProduto);

  if (!Number.isFinite(busca) || !Number.isFinite(produto)) {
    return true;
  }

  const diferenca = Math.abs(busca - produto);
  const tolerancia = Math.max(5, busca * 0.02);

  return diferenca <= tolerancia;
}

function obterFlagDoGrupo(flags, grupo) {
  return grupo.find((flag) => flags.includes(flag));
}

function possuiConflitoDeFlags(flagsBusca, flagsProduto) {
  const gruposExcludentes = [
    ["integral", "semidesnatado", "desnatado"],
    ["carioca", "preto", "branco", "rajado", "fradinho"],
    ["tipo 1", "tipo 2"],
    ["com sal", "sem sal"],
    ["diet", "light", "zero"],
    ["espaguete", "penne", "parafuso"]
  ];

  for (const grupo of gruposExcludentes) {
    const flagBuscada = obterFlagDoGrupo(flagsBusca, grupo);
    const flagProduto = obterFlagDoGrupo(flagsProduto, grupo);

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

function validarCorrespondencia(termoBusca, produto) {
  const nomeProduto =
    produto?.productName ||
    produto?.productTitle ||
    "";

  if (!nomeProduto) {
    return false;
  }

  const buscado = detectarAtributos(termoBusca);
  const encontrado = detectarAtributos(nomeProduto);

  if (
    buscado.categoria &&
    encontrado.categoria &&
    buscado.categoria !== encontrado.categoria
  ) {
    return false;
  }

  if (buscado.marca) {
    if (!encontrado.marca) {
      return false;
    }

    if (buscado.marca !== encontrado.marca) {
      return false;
    }
  }

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

  const flagsBusca = buscado.flags || [];
  const flagsProduto = encontrado.flags || [];

  if (
    possuiConflitoDeFlags(
      flagsBusca,
      flagsProduto
    )
  ) {
    return false;
  }

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
