const {
  detectarAtributos
} = require("./atributos");

/**
 * Padroniza o EAN, removendo espaços e caracteres não numéricos.
 */
function normalizarEAN(valor) {
  return String(valor || "")
    .replace(/\D/g, "")
    .trim();
}

/**
 * Retorna todos os EANs cadastrados nos itens do produto.
 */
function obterEANsProduto(produto) {
  const itens = Array.isArray(produto?.items)
    ? produto.items
    : [];

  return itens
    .map((item) => normalizarEAN(item?.ean))
    .filter(Boolean);
}

/**
 * Verifica se o produto possui exatamente o EAN procurado.
 */
function possuiEANExato(produto, eanBuscado) {
  const ean = normalizarEAN(eanBuscado);

  if (!ean) {
    return false;
  }

  return obterEANsProduto(produto).includes(ean);
}

/**
 * Define a pontuação mínima conforme a quantidade
 * de informações presentes na busca.
 *
 * Quanto mais específica for a busca, maior deve ser
 * a qualidade mínima do produto encontrado.
 */
function calcularScoreMinimo(termoBusca, eanBuscado) {
  if (normalizarEAN(eanBuscado)) {
    return 1000;
  }

  const atributos = detectarAtributos(termoBusca);

  let minimo = 500;

  if (atributos.categoria) {
    minimo += 250;
  }

  if (atributos.marca) {
    minimo += 700;
  }

  if (atributos.peso) {
    minimo += 350;
  }

  if (
    Array.isArray(atributos.flags) &&
    atributos.flags.length > 0
  ) {
    minimo += atributos.flags.length * 150;
  }

  return minimo;
}

/**
 * Obtém um nome seguro para exibição nos logs.
 */
function obterNomeProduto(produto) {
  return (
    produto?.productName ||
    produto?.productTitle ||
    "Produto sem nome"
  );
}

/**
 * Obtém o primeiro EAN disponível para exibição.
 */
function obterEANPrincipal(produto) {
  const eans = obterEANsProduto(produto);

  return eans[0] || "sem EAN";
}

/**
 * Mostra no terminal os produtos classificados.
 */
function exibirRanking(
  rankingCompleto,
  scoreMinimo
) {
  console.log(
    "\n========== RANKING INTELIGENTE =========="
  );

  console.log(
    `Score mínimo exigido: ${scoreMinimo}`
  );

  if (rankingCompleto.length === 0) {
    console.log(
      "Nenhum produto foi recebido para classificação."
    );

    console.log(
      "=========================================\n"
    );

    return;
  }

  rankingCompleto
    .slice(0, 10)
    .forEach((item, indice) => {
      let situacao = "CANDIDATO";

      if (item.invalido) {
        situacao = "REJEITADO";
      } else if (item.score < scoreMinimo) {
        situacao = "ABAIXO DO MÍNIMO";
      } else if (item.eanExato) {
        situacao = "EAN EXATO";
      }

      console.log(
        `${indice + 1}.`,
        `[${situacao}]`,
        `Score: ${item.score}`,
        "-",
        obterNomeProduto(item.produto),
        "| EAN:",
        obterEANPrincipal(item.produto)
      );
    });

  console.log(
    "=========================================\n"
  );
}

/**
 * Escolhe o produto com maior correspondência.
 *
 * Regras:
 *
 * 1. Produtos rejeitados pelo validador possuem score -9999.
 * 2. EAN exato tem prioridade.
 * 3. O produto precisa atingir o score mínimo.
 * 4. Resultados muito próximos podem ser considerados ambíguos.
 * 5. O sistema nunca retorna simplesmente o "menos ruim".
 */
function escolherMelhorProduto(
  produtos,
  calcularPontuacao,
  termoBusca,
  eanBuscado
) {
  if (
    !Array.isArray(produtos) ||
    produtos.length === 0
  ) {
    console.log(
      `Nenhum produto encontrado para: ${termoBusca}`
    );

    return null;
  }

  if (typeof calcularPontuacao !== "function") {
    console.error(
      "A função calcularPontuacao não foi informada corretamente."
    );

    return null;
  }

  const scoreMinimo =
    calcularScoreMinimo(
      termoBusca,
      eanBuscado
    );

  const rankingCompleto = produtos
    .filter(Boolean)
    .map((produto) => {
      let score;

      try {
        score = calcularPontuacao(
          termoBusca,
          produto,
          eanBuscado
        );
      } catch (erro) {
        console.error(
          "Erro ao calcular pontuação do produto:",
          obterNomeProduto(produto),
          erro.message
        );

        score = -9999;
      }

      if (!Number.isFinite(score)) {
        score = -9999;
      }

      return {
        produto,
        score,
        eanExato: possuiEANExato(
          produto,
          eanBuscado
        ),
        invalido: score <= -9999
      };
    })
    .sort((a, b) => {
      /*
       * EAN exato sempre vem primeiro.
       */
      if (a.eanExato && !b.eanExato) {
        return -1;
      }

      if (!a.eanExato && b.eanExato) {
        return 1;
      }

      return b.score - a.score;
    });

  exibirRanking(
    rankingCompleto,
    scoreMinimo
  );

  /*
   * Remove todos os produtos rejeitados pelo validador.
   */
  const candidatosValidos =
    rankingCompleto.filter(
      (item) =>
        !item.invalido &&
        item.score >= scoreMinimo
    );

  if (candidatosValidos.length === 0) {
    console.log(
      `Nenhum produto confiável encontrado para: ${termoBusca}`
    );

    return null;
  }

  /*
   * Se houver EAN exato, ele será escolhido imediatamente.
   */
  const candidatoEAN =
    candidatosValidos.find(
      (item) => item.eanExato
    );

  if (candidatoEAN) {
    console.log(
      "Produto escolhido por EAN exato:",
      obterNomeProduto(
        candidatoEAN.produto
      )
    );

    return candidatoEAN.produto;
  }

  const primeiro =
    candidatosValidos[0];

  const segundo =
    candidatosValidos[1];

  /*
   * Evita escolher entre dois resultados quase empatados
   * quando a busca não possui marca identificada.
   */
  if (segundo) {
    const diferenca =
      primeiro.score - segundo.score;

    const atributosBusca =
      detectarAtributos(termoBusca);

    const buscaPossuiMarca =
      Boolean(atributosBusca.marca);

    const diferencaMinima =
      buscaPossuiMarca ? 100 : 200;

    if (diferenca < diferencaMinima) {
      console.log(
        "Resultado ambíguo. Os dois melhores produtos ficaram muito próximos:"
      );

      console.log(
        primeiro.score,
        "-",
        obterNomeProduto(
          primeiro.produto
        )
      );

      console.log(
        segundo.score,
        "-",
        obterNomeProduto(
          segundo.produto
        )
      );

      return null;
    }
  }

  console.log(
    "Produto escolhido pelo Score Inteligente:",
    primeiro.score,
    "-",
    obterNomeProduto(
      primeiro.produto
    )
  );

  return primeiro.produto;
}

module.exports = {
  escolherMelhorProduto,
  calcularScoreMinimo,
  possuiEANExato,
  obterEANsProduto
};