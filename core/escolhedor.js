const { detectarAtributos } = require("./atributos");
const { normalizarTexto } = require("../utils/texto");

const VARIACOES_EQUIVALENTES = new Set([
  "menta",
  "hortela",
  "mint",
  "original",
  "sabor",
  "caixa",
  "embalagem"
]);

function normalizarEAN(valor) {
  return String(valor || "").replace(/\D/g, "").trim();
}

function obterEANsProduto(produto) {
  const itens = Array.isArray(produto?.items) ? produto.items : [];
  return itens
    .map((item) => normalizarEAN(item?.ean))
    .filter(Boolean);
}

function possuiEANExato(produto, eanBuscado) {
  const ean = normalizarEAN(eanBuscado);
  if (!ean) return false;
  return obterEANsProduto(produto).includes(ean);
}

function calcularScoreMinimo(termoBusca, eanBuscado) {
  if (normalizarEAN(eanBuscado)) return 1000;

  const atributos = detectarAtributos(termoBusca);
  let minimo = 500;

  if (atributos.categoria) minimo += 250;
  if (atributos.marca) minimo += 700;
  if (atributos.peso) minimo += 350;

  if (Array.isArray(atributos.flags) && atributos.flags.length > 0) {
    minimo += atributos.flags.length * 150;
  }

  return minimo;
}

function obterNomeProduto(produto) {
  return produto?.productName || produto?.productTitle || "Produto sem nome";
}

function obterEANPrincipal(produto) {
  return obterEANsProduto(produto)[0] || "sem EAN";
}

function normalizarNomeBase(nome) {
  return normalizarTexto(nome)
    .split(/\s+/)
    .map((palavra) => palavra.trim())
    .filter(Boolean)
    .filter((palavra) => !VARIACOES_EQUIVALENTES.has(palavra))
    .join(" ");
}

function possuemMesmosAtributosPrincipais(produtoA, produtoB) {
  const atributosA = detectarAtributos(obterNomeProduto(produtoA));
  const atributosB = detectarAtributos(obterNomeProduto(produtoB));

  for (const campo of ["categoria", "marca", "peso"]) {
    if (
      atributosA[campo] &&
      atributosB[campo] &&
      atributosA[campo] !== atributosB[campo]
    ) {
      return false;
    }
  }

  const flagsA = new Set(atributosA.flags || []);
  const flagsB = new Set(atributosB.flags || []);

  const flagsCriticas = [
    "integral", "semidesnatado", "desnatado",
    "zero lactose", "com lactose",
    "carioca", "preto", "branco", "rajado", "fradinho",
    "parboilizado", "diet", "light", "zero",
    "sem sal", "com sal"
  ];

  for (const flag of flagsCriticas) {
    if (flagsA.has(flag) !== flagsB.has(flag)) {
      return false;
    }
  }

  return true;
}

function saoVariantesEquivalentes(produtoA, produtoB, termoBusca) {
  const buscaNormalizada = normalizarTexto(termoBusca);
  const palavrasBusca = new Set(buscaNormalizada.split(/\s+/).filter(Boolean));

  for (const variacao of VARIACOES_EQUIVALENTES) {
    if (palavrasBusca.has(variacao)) {
      return false;
    }
  }

  if (!possuemMesmosAtributosPrincipais(produtoA, produtoB)) {
    return false;
  }

  return (
    normalizarNomeBase(obterNomeProduto(produtoA)) ===
    normalizarNomeBase(obterNomeProduto(produtoB))
  );
}

function obterPrecoProduto(produto) {
  const item = Array.isArray(produto?.items) ? produto.items[0] : null;
  const sellers = Array.isArray(item?.sellers) ? item.sellers : [];

  for (const seller of sellers) {
    const oferta = seller?.commertialOffer || seller?.commercialOffer;
    const preco = Number(oferta?.Price ?? oferta?.price);

    if (Number.isFinite(preco) && preco > 0) {
      return preco;
    }
  }

  const precoDireto = Number(produto?.price);

  return Number.isFinite(precoDireto) && precoDireto > 0
    ? precoDireto
    : null;
}

function escolherEntreEquivalentes(primeiro, segundo) {
  const precoPrimeiro = obterPrecoProduto(primeiro.produto);
  const precoSegundo = obterPrecoProduto(segundo.produto);

  if (
    precoPrimeiro !== null &&
    precoSegundo !== null &&
    precoSegundo < precoPrimeiro
  ) {
    return segundo;
  }

  return primeiro;
}

function exibirRanking(rankingCompleto, scoreMinimo) {
  console.log("\n========== RANKING INTELIGENTE ==========");
  console.log(`Score mínimo exigido: ${scoreMinimo}`);

  if (rankingCompleto.length === 0) {
    console.log("Nenhum produto foi recebido para classificação.");
    console.log("=========================================\n");
    return;
  }

  rankingCompleto.slice(0, 10).forEach((item, indice) => {
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

  console.log("=========================================\n");
}

function escolherMelhorProduto(
  produtos,
  calcularPontuacao,
  termoBusca,
  eanBuscado
) {
  if (!Array.isArray(produtos) || produtos.length === 0) {
    console.log(`Nenhum produto encontrado para: ${termoBusca}`);
    return null;
  }

  if (typeof calcularPontuacao !== "function") {
    console.error("A função calcularPontuacao não foi informada corretamente.");
    return null;
  }

  const scoreMinimo = calcularScoreMinimo(termoBusca, eanBuscado);

  const rankingCompleto = produtos
    .filter(Boolean)
    .map((produto) => {
      let score;

      try {
        score = calcularPontuacao(termoBusca, produto, eanBuscado);
      } catch (erro) {
        console.error(
          "Erro ao calcular pontuação do produto:",
          obterNomeProduto(produto),
          erro.message
        );
        score = -9999;
      }

      if (!Number.isFinite(score)) score = -9999;

      return {
        produto,
        score,
        eanExato: possuiEANExato(produto, eanBuscado),
        invalido: score <= -9999
      };
    })
    .sort((a, b) => {
      if (a.eanExato && !b.eanExato) return -1;
      if (!a.eanExato && b.eanExato) return 1;
      return b.score - a.score;
    });

  exibirRanking(rankingCompleto, scoreMinimo);

  const candidatosValidos = rankingCompleto.filter(
    (item) => !item.invalido && item.score >= scoreMinimo
  );

  if (candidatosValidos.length === 0) {
    console.log(`Nenhum produto confiável encontrado para: ${termoBusca}`);
    return null;
  }

  const candidatoEAN = candidatosValidos.find((item) => item.eanExato);

  if (candidatoEAN) {
    console.log("Produto escolhido por EAN exato:", obterNomeProduto(candidatoEAN.produto));
    return candidatoEAN.produto;
  }

  let primeiro = candidatosValidos[0];
  const segundo = candidatosValidos[1];

  if (segundo) {
    const diferenca = primeiro.score - segundo.score;
    const atributosBusca = detectarAtributos(termoBusca);
    const diferencaMinima = atributosBusca.marca ? 100 : 200;

    if (diferenca < diferencaMinima) {
      if (
        saoVariantesEquivalentes(
          primeiro.produto,
          segundo.produto,
          termoBusca
        )
      ) {
        primeiro = escolherEntreEquivalentes(primeiro, segundo);

        console.log(
          "Empate resolvido entre variantes equivalentes:",
          obterNomeProduto(primeiro.produto)
        );
      } else {
        console.log(
          "Resultado ambíguo. Os dois melhores produtos ficaram muito próximos:"
        );

        console.log(primeiro.score, "-", obterNomeProduto(primeiro.produto));
        console.log(segundo.score, "-", obterNomeProduto(segundo.produto));

        return null;
      }
    }
  }

  console.log(
    "Produto escolhido pelo Score Inteligente:",
    primeiro.score,
    "-",
    obterNomeProduto(primeiro.produto)
  );

  return primeiro.produto;
}

module.exports = {
  escolherMelhorProduto,
  calcularScoreMinimo,
  possuiEANExato,
  obterEANsProduto,
  saoVariantesEquivalentes
};
