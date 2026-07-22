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

function obterPalavras(texto) {
  return [
    ...new Set(
      normalizarTexto(texto)
        .split(/\s+/)
        .map((palavra) => palavra.trim())
        .filter((palavra) => palavra.length > 2)
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

  const totalEncontrado =
    palavrasBuscadas.filter(
      (palavra) =>
        palavrasProduto.includes(palavra)
    ).length;

  return totalEncontrado /
    palavrasBuscadas.length;
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
    return -999;
  }

  if (
    !validarCorrespondencia(
      termoBusca,
      produto
    )
  ) {
    return -999;
  }

  let pontos = 0;

  /*
   * EAN exato possui prioridade absoluta.
   */
  if (
    eanBuscado &&
    item?.ean &&
    String(item.ean) ===
      String(eanBuscado)
  ) {
    pontos += 5000;
  }

  const buscadoAttr =
    detectarAtributos(termoBusca);

  const produtoAttr =
    detectarAtributos(nomeProduto);

  /*
   * Categoria
   */
  if (buscadoAttr.categoria) {
    if (
      produtoAttr.categoria ===
      buscadoAttr.categoria
    ) {
      pontos += 400;
    } else {
      pontos -= 1000;
    }
  }

  /*
   * Marca
   */
  if (buscadoAttr.marca) {
    if (
      produtoAttr.marca ===
      buscadoAttr.marca
    ) {
      pontos += 700;
    } else {
      pontos -= 1200;
    }
  }

  /*
   * Peso ou volume
   */
  if (buscadoAttr.peso) {
    if (
      produtoAttr.peso ===
      buscadoAttr.peso
    ) {
      pontos += 500;
    } else {
      pontos -= 900;
    }
  }

  /*
   * Características importantes:
   * preto, carioca, integral, zero,
   * sem açúcar, tradicional etc.
   */
  const flagsBuscadas =
    buscadoAttr.flags || [];

  const flagsProduto =
    produtoAttr.flags || [];

  for (const flag of flagsBuscadas) {
    if (flagsProduto.includes(flag)) {
      pontos += 350;
    } else {
      pontos -= 700;
    }
  }

  /*
   * Comparação das palavras do nome.
   */
  const palavrasBuscadas =
    obterPalavras(buscado);

  const palavrasProduto =
    obterPalavras(nomeProduto);

  for (const palavra of palavrasBuscadas) {
    if (palavrasProduto.includes(palavra)) {
      pontos += 100;
    } else {
      pontos -= 80;
    }
  }

  /*
   * Cobertura total da pesquisa.
   *
   * Quando praticamente todas as palavras
   * pesquisadas aparecem no produto,
   * ele recebe um bônus grande.
   */
  const cobertura =
    calcularCobertura(
      palavrasBuscadas,
      palavrasProduto
    );

  if (cobertura === 1) {
    pontos += 800;
  } else if (cobertura >= 0.8) {
    pontos += 550;
  } else if (cobertura >= 0.6) {
    pontos += 250;
  } else {
    pontos -= 400;
  }

  /*
   * Bônus quando as palavras aparecem
   * na mesma ordem da pesquisa.
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
    pontos += 350;
  } else {
    pontos += palavrasNaOrdem * 30;
  }

  /*
   * Nome praticamente idêntico.
   */
  if (nomeProduto === buscado) {
    pontos += 1000;
  } else if (
    nomeProduto.includes(buscado)
  ) {
    pontos += 500;
  }

  /*
   * Pequena penalidade para palavras extras.
   * Isso favorece o produto mais próximo
   * do que foi solicitado.
   */
  const palavrasExtras =
    palavrasProduto.filter(
      (palavra) =>
        !palavrasBuscadas.includes(palavra)
    );

  pontos -= Math.min(
    palavrasExtras.length * 20,
    160
  );

  return pontos;
}

module.exports = {
  calcularPontuacao
};