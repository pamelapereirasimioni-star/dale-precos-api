const { limparNomeBusca } = require("../utils/texto");
const { validarCorrespondencia } = require("../core/validador");
const { calcularPontuacao } = require("../core/score");
const { escolherMelhorProduto } = require("../core/escolhedor");
const { criarProduto } = require("../core/produto");

const BASE_URL = "https://www.savegnago.com.br";

function limparCep(cep) {
  return String(cep || "").replace(/\D/g, "");
}

async function consultarVTEX(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "DALE-Precos/1.0",
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      console.log("Savegnago - erro VTEX:", response.status, url);
      return null;
    }

    return await response.json();
  } catch (erro) {
    console.log("Savegnago - erro de rede:", erro.message);
    return null;
  }
}

async function buscarPorEAN(ean) {
  if (!ean) return [];

  const resultado = await consultarVTEX(
    `${BASE_URL}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${encodeURIComponent(ean)}`
  );

  return Array.isArray(resultado) ? resultado : [];
}

async function buscarPorNome(nome) {
  const termo = limparNomeBusca(nome);

  if (!termo) return [];

  const resultado = await consultarVTEX(
    `${BASE_URL}/api/catalog_system/pub/products/search/${encodeURIComponent(termo)}?_from=0&_to=30`
  );

  return Array.isArray(resultado) ? resultado : [];
}

async function buscarSellersPorCep(cep) {
  const cepLimpo = limparCep(cep);

  if (cepLimpo.length !== 8) {
    return [];
  }

  const regioes = await consultarVTEX(
    `${BASE_URL}/api/checkout/pub/regions?country=BRA&postalCode=${cepLimpo}`
  );

  if (!Array.isArray(regioes)) {
    return [];
  }

  const sellers = [];

  for (const regiao of regioes) {
    for (const seller of regiao?.sellers || []) {
      const id = String(seller?.id || "").trim();

      if (
        id &&
        id !== "1" &&
        !sellers.includes(id)
      ) {
        sellers.push(id);
      }
    }
  }

  return sellers;
}

async function simularProduto(itemId, sellerId, cep, quantidade = 1) {
  const cepLimpo = limparCep(cep);

  const resposta = await consultarVTEX(
    `${BASE_URL}/api/checkout/pub/orderForms/simulation?RnbBehavior=0&sc=1`,
    {
      method: "POST",
      body: JSON.stringify({
        items: [
          {
            id: String(itemId),
            quantity: quantidade,
            seller: sellerId
          }
        ],
        postalCode: cepLimpo,
        country: "BRA"
      })
    }
  );

  if (!resposta) {
    return null;
  }

  const item = resposta?.items?.[0];

  if (!item) {
    return null;
  }

  const available =
    item.availability === "available";

  const price =
    typeof item.sellingPrice === "number"
      ? item.sellingPrice / 100
      : null;

  const listPrice =
    typeof item.listPrice === "number"
      ? item.listPrice / 100
      : price;

  const pickupDistances = [];

  for (const condicao of
    resposta?.purchaseConditions?.itemPurchaseConditions || []) {
    for (const sla of condicao?.slas || []) {
      if (
        sla.deliveryChannel === "pickup-in-point" &&
        typeof sla.pickupDistance === "number"
      ) {
        pickupDistances.push(sla.pickupDistance);
      }
    }
  }

  const pickupDistance =
    pickupDistances.length > 0
      ? Math.min(...pickupDistances)
      : null;

  return {
    sellerId,
    available,
    price,
    listPrice,
    pickupDistance
  };
}

async function buscarOfertaRegional(itemId, cep) {
  const sellers = await buscarSellersPorCep(cep);

  if (!sellers.length) {
    console.log(
      "Savegnago: nenhum seller encontrado para CEP",
      cep
    );
    return null;
  }

  console.log(
    "Savegnago sellers para CEP",
    cep,
    ":",
    sellers
  );

  const simulacoes = await Promise.all(
    sellers.map((sellerId) =>
      simularProduto(itemId, sellerId, cep, 1)
    )
  );

  const ofertas = simulacoes.filter(
    (oferta) =>
      oferta &&
      oferta.available &&
      typeof oferta.price === "number" &&
      oferta.price > 0
  );

  if (!ofertas.length) {
    return null;
  }

  ofertas.sort((a, b) => {
    const aTemDistancia =
      typeof a.pickupDistance === "number";
    const bTemDistancia =
      typeof b.pickupDistance === "number";

    if (aTemDistancia && bTemDistancia) {
      if (a.pickupDistance !== b.pickupDistance) {
        return a.pickupDistance - b.pickupDistance;
      }
    } else if (aTemDistancia) {
      return -1;
    } else if (bTemDistancia) {
      return 1;
    }

    return a.price - b.price;
  });

  return ofertas[0];
}

function localizarItem(produto, eanBuscado) {
  if (!produto?.items?.length) {
    return null;
  }

  if (eanBuscado) {
    const itemExato = produto.items.find(
      (item) =>
        String(item.ean || "") ===
        String(eanBuscado)
    );

    if (itemExato) {
      return itemExato;
    }
  }

  return produto.items[0];
}

async function montarProdutoRegional(produto, eanBuscado, cep) {
  const item = localizarItem(produto, eanBuscado);

  if (!item) {
    return null;
  }

  const cepLimpo = limparCep(cep);

  if (cepLimpo.length !== 8) {
    console.log(
      "Savegnago: CEP ausente ou inválido. Preço regional não será retornado."
    );
    return null;
  }

  const oferta = await buscarOfertaRegional(
    item.itemId,
    cepLimpo
  );

  if (!oferta) {
    return null;
  }

  console.log("Savegnago oferta regional:", {
    cep: cepLimpo,
    ean: item.ean,
    itemId: item.itemId,
    sellerId: oferta.sellerId,
    price: oferta.price,
    listPrice: oferta.listPrice
  });

  return criarProduto({
    supermarketId: "savegnago",
    productName: produto.productName,
    ean: item.ean,
    itemId: item.itemId,
    sellerId: oferta.sellerId,
    price: oferta.price,
    listPrice: oferta.listPrice,
    available: oferta.available,
    image: item.images?.[0]?.imageUrl || null,
    url: produto.link || null
  });
}

async function buscarProduto(
  termoBusca,
  eanBuscado,
  cep
) {
  let produtos = [];

  if (eanBuscado) {
    produtos = await buscarPorEAN(eanBuscado);

    if (produtos.length) {
      const exato = produtos.find((p) =>
        p.items?.some(
          (i) =>
            String(i.ean) ===
            String(eanBuscado)
        )
      );

      if (
        exato &&
        validarCorrespondencia(
          termoBusca,
          exato
        )
      ) {
        return montarProdutoRegional(
          exato,
          eanBuscado,
          cep
        );
      }
    }
  }

  produtos = await buscarPorNome(termoBusca);

  console.log(
    "========== PRODUTOS ENCONTRADOS SAVEGNAGO =========="
  );

  produtos.forEach((p) => {
    console.log(p.productName);
  });

  console.log(
    "====================================================="
  );

  const melhor = escolherMelhorProduto(
    produtos,
    calcularPontuacao,
    termoBusca,
    eanBuscado
  );

  if (!melhor) {
    return null;
  }

  return montarProdutoRegional(
    melhor,
    eanBuscado,
    cep
  );
}

module.exports = {
  buscarProduto
};
