const {
  normalizarTexto,
  limparNomeBusca
} = require("../utils/texto");

const {
  detectarAtributos
} = require("./atributos");

const {
  validarCorrespondencia
} = require("./validador");

/*
 * Palavras com pouco valor para distinguir produtos.
 * Elas não devem pesar tanto quanto marca, categoria,
 * peso e características importantes.
 */
const PALAVRAS_FRACAS = new Set([
  "com",
  "para",
  "tipo",
  "classe",
  "produto",
  "pacote",
  "embalagem",
  "unidade",
  "unidades",
  "tradicional",
  "original"
]);

/*
 * Flags que mudam de forma importante o produto.
 * A ausência ou conflito deve ser penalizado com força.
 */
const FLAGS_CRITICAS = new Set([
  "zero",
  "sem_acucar",
  "integral",
  "desnatado",
  "semidesnatado",
  "sem_lactose",
  "com_lactose",
  "preto",
  "carioca",
  "branco",
  "parboilizado",
  "refinado"
]);

function obterPalavras(texto) {
  return [
    ...new Set(
      normalizarTexto(texto)
        .split(/\s+/)
        .map((palavra) => palavra.trim())
        .filter(
          (palavra) =>
            palavra.length > 2 &&
            !PALAVRAS_FRACAS.has(palavra)
        )
    )
  ];
}

function calcularCobertura(
  palavrasBuscadas,
  palavrasProduto
) {
  if (palavrasBuscadas.length === 0) {
    return 0;
  }

  const palavrasProdutoSet =
    new Set(palavrasProduto);

  let totalEncontrado = 0;

  for (const palavra of palavrasBuscadas) {
    if (palavrasProdutoSet.has(palavra)) {
      totalEncontrado += 1;
    }
  }

  return (
    totalEncontrado /
    palavrasBuscadas.length
  );
}

function calcularPrecisao(
  palavrasBuscadas,
  palavrasProduto
) {
  if (palavrasProduto.length === 0) {
    return 0;
  }

  const palavrasBuscadasSet =
    new Set(palavrasBuscadas);

  let totalRelevante = 0;

  for (const palavra of palavrasProduto) {
    if (palavrasBuscadasSet.has(palavra)) {
      totalRelevante += 1;
    }
  }

  return (
    totalRelevante /
    palavrasProduto.length
  );
}

function calcularOrdemDasPalavras(
  palavrasBuscadas,
  nomeProduto
) {
  let ultimaPosicao = -1;
  let palavrasNaOrdem = 0;

  for (const palavra of palavrasBuscadas) {
    const posicao = nomeProduto.indexOf(
      palavra,
      ultimaPosicao + 1
    );

    if (posicao !== -1) {
      palavrasNaOrdem += 1;
      ultimaPosicao = posicao;
    }
  }

  return palavrasNaOrdem;
}

function pontuarAtributoExato({
  esperado,
  encontrado,
  bonus,
  penalidade,
  obrigatorio = true
}) {
  if (!esperado) {
    return 0;
  }

  if (esperado === encontrado) {
    return bonus;
  }

  if (!encontrado && !obrigatorio) {
    return 0;
  }

  return -penalidade;
}

function pontuarFlags(
  flagsBuscadas,
  flagsProduto
) {
  const produtoSet =
    new Set(flagsProduto || []);

  let pontos = 0;

  for (const flag of flagsBuscadas || []) {
    if (produtoSet.has(flag)) {
      pontos += FLAGS_CRITICAS.has(flag)
        ? 500
        : 280;
    } else {
      pontos -= FLAGS_CRITICAS.has(flag)
        ? 1200
        : 450;
    }
  }

  return pontos;
}

function existeConflitoDeFlags(
  flagsBuscadas,
  flagsProduto
) {
  const buscadas =
    new Set(flagsBuscadas || []);

  const produto =
    new Set(flagsProduto || []);

  const paresConflitantes = [
    ["zero", "tradicional"],
    ["sem_acucar", "com_acucar"],
    ["integral", "tradicional"],
    ["desnatado", "integral"],
    ["desnatado", "semidesnatado"],
    ["sem_lactose", "com_lactose"],
    ["preto", "carioca"],
    ["preto", "branco"],
    ["carioca", "branco"],
    ["parboilizado", "branco"]
  ];

  for (const [a, b] of paresConflitantes) {
    if (
      (buscadas.has(a) && produto.has(b)) ||
      (buscadas.has(b) && produto.has(a))
    ) {
      return true;
    }
  }

  return false;
}

function calcularPontuacao(
  termoBusca,
  produto,
  eanBuscado
) {
  const buscado =
    limparNomeBusca(termoBusca);

  const nomeProduto =
    normalizarTexto(
      produto.productName ||
      produto.productTitle ||
      ""
    );

  const item = produto.items?.[0];

  if (!nomeProduto) {
    return -9999;
  }

  /*
   * EAN exato possui prioridade absoluta.
   * Retornamos imediatamente para impedir
   * que qualquer outro candidato ultrapasse.
   */
  if (
    eanBuscado &&
    item?.ean &&
    String(item.ean) ===
      String(eanBuscado)
  ) {
    return 10000;
  }

  if (
    !validarCorrespondencia(
      termoBusca,
      produto
    )
  ) {
    return -9999;
  }

  let pontos = 0;

  const buscadoAttr =
    detectarAtributos(termoBusca);

  const produtoAttr =
    detectarAtributos(nomeProduto);

  /*
   * Categoria: produto de categoria errada
   * deve perder quase toda a chance.
   */
  pontos += pontuarAtributoExato({
    esperado: buscadoAttr.categoria,
    encontrado: produtoAttr.categoria,
    bonus: 900,
    penalidade: 2500,
    obrigatorio: true
  });

  /*
   * Marca: é um dos critérios mais importantes.
   * Coca-Cola não pode perder para Pepsi;
   * Camil não pode ser trocado por outra marca.
   */
  pontos += pontuarAtributoExato({
    esperado: buscadoAttr.marca,
    encontrado: produtoAttr.marca,
    bonus: 1400,
    penalidade: 3000,
    obrigatorio: true
  });

  /*
   * Peso ou volume.
   * Diferença exata recebe grande bônus.
   * Peso diferente recebe forte penalização.
   */
  pontos += pontuarAtributoExato({
    esperado: buscadoAttr.peso,
    encontrado: produtoAttr.peso,
    bonus: 1000,
    penalidade: 2200,
    obrigatorio: true
  });

  /*
   * Características importantes.
   */
  const flagsBuscadas =
    buscadoAttr.flags || [];

  const flagsProduto =
    produtoAttr.flags || [];

  pontos += pontuarFlags(
    flagsBuscadas,
    flagsProduto
  );

  if (
    existeConflitoDeFlags(
      flagsBuscadas,
      flagsProduto
    )
  ) {
    pontos -= 3000;
  }

  /*
   * Comparação das palavras relevantes.
   */
  const palavrasBuscadas =
    obterPalavras(buscado);

  const palavrasProduto =
    obterPalavras(nomeProduto);

  const palavrasProdutoSet =
    new Set(palavrasProduto);

  for (const palavra of palavrasBuscadas) {
    if (palavrasProdutoSet.has(palavra)) {
      pontos += 140;
    } else {
      pontos -= 120;
    }
  }

  /*
   * Cobertura:
   * quantas palavras da busca aparecem no produto.
   */
  const cobertura =
    calcularCobertura(
      palavrasBuscadas,
      palavrasProduto
    );

  if (cobertura === 1) {
    pontos += 1300;
  } else if (cobertura >= 0.85) {
    pontos += 900;
  } else if (cobertura >= 0.7) {
    pontos += 500;
  } else if (cobertura >= 0.5) {
    pontos += 100;
  } else {
    pontos -= 900;
  }

  /*
   * Precisão:
   * evita escolher produto com muitas palavras
   * extras e descrição de outro tipo de item.
   */
  const precisao =
    calcularPrecisao(
      palavrasBuscadas,
      palavrasProduto
    );

  if (precisao >= 0.8) {
    pontos += 500;
  } else if (precisao >= 0.6) {
    pontos += 250;
  } else if (precisao < 0.35) {
    pontos -= 500;
  }

  /*
   * Ordem das palavras.
   */
  const palavrasNaOrdem =
    calcularOrdemDasPalavras(
      palavrasBuscadas,
      nomeProduto
    );

  if (
    palavrasBuscadas.length > 0 &&
    palavrasNaOrdem ===
      palavrasBuscadas.length
  ) {
    pontos += 600;
  } else {
    pontos += palavrasNaOrdem * 40;
  }

  /*
   * Nome idêntico ou contido.
   */
  if (nomeProduto === buscado) {
    pontos += 1800;
  } else if (
    nomeProduto.includes(buscado)
  ) {
    pontos += 900;
  } else if (
    buscado.includes(nomeProduto)
  ) {
    pontos += 500;
  }

  /*
   * Penalidade para excesso de palavras.
   */
  const palavrasBuscadasSet =
    new Set(palavrasBuscadas);

  const palavrasExtras =
    palavrasProduto.filter(
      (palavra) =>
        !palavrasBuscadasSet.has(palavra)
    );

  pontos -= Math.min(
    palavrasExtras.length * 35,
    350
  );

  return Math.round(pontos);
}

module.exports = {
  calcularPontuacao
};
