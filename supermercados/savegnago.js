const { limparNomeBusca } = require("../utils/texto");
const { validarCorrespondencia } = require("../core/validador");
const { calcularPontuacao } = require("../core/score");
const { escolherMelhorProduto } = require("../core/escolhedor");
const { criarProduto } = require("../core/produto");

async function consultarVTEX(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "DALE-Precos/1.0"
    }
  });

  if (!response.ok) {
    console.log("Erro VTEX:", response.status);
    return [];
  }

  return response.json();
}

async function buscarPorEAN(ean) {
  if (!ean) return [];

  return consultarVTEX(
    `https://www.savegnago.com.br/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${encodeURIComponent(ean)}`
  );
}

async function buscarPorNome(nome) {
  const termo = limparNomeBusca(nome);

  if (!termo) return [];

  return consultarVTEX(
    `https://www.savegnago.com.br/api/catalog_system/pub/products/search/${encodeURIComponent(termo)}?_from=0&_to=30`
  );
}

function extrairMelhorOferta(produto) {
  const item = produto.items?.[0];
  const seller =
    item?.sellers?.find((s) => s.sellerDefault) || item?.sellers?.[0];

  const oferta = seller?.commertialOffer;

  if (!item || !seller || !oferta) return null;

  return criarProduto({
    supermarketId: "savegnago",
    productName: produto.productName,
    ean: item.ean,
    itemId: item.itemId,
    sellerId: seller.sellerId,
    price: oferta.Price || null,
    listPrice: oferta.ListPrice || null,
    available: oferta.IsAvailable === true,
    image: item.images?.[0]?.imageUrl || null,
    url: produto.link || null
  });
}

async function buscarProduto(termoBusca, eanBuscado) {
  let produtos = [];

  if (eanBuscado) {
    produtos = await buscarPorEAN(eanBuscado);

    if (produtos.length) {
      const exato = produtos.find((p) =>
        p.items?.some((i) => String(i.ean) === String(eanBuscado))
      );

      if (exato && validarCorrespondencia(termoBusca, exato)) {
        return extrairMelhorOferta(exato);
      }
    }
  }

  produtos = await buscarPorNome(termoBusca);

  console.log("========== PRODUTOS ENCONTRADOS ==========");
  produtos.forEach((p) => {
    console.log(p.productName);
  });
  console.log("==========================================");

  const melhor = escolherMelhorProduto(
    produtos,
    calcularPontuacao,
    termoBusca,
    eanBuscado
  );

  if (!melhor) return null;

  return extrairMelhorOferta(melhor);
}

module.exports = {
  buscarProduto
};