const crypto = require("crypto");

const { limparNomeBusca } = require("../utils/texto");
const { validarCorrespondencia } = require("../core/validador");
const { calcularPontuacao } = require("../core/score");
const { escolherMelhorProduto } = require("../core/escolhedor");
const { criarProduto } = require("../core/produto");

const API_BASE =
  process.env.TONIN_API_BASE ||
  "https://services.vipcommerce.com.br/api-admin/v1";

const ORG = process.env.TONIN_ORG || "346";
const FILIAL = process.env.TONIN_FILIAL || "1";
const CENTRO_DISTRIBUICAO =
  process.env.TONIN_CENTRO_DISTRIBUICAO || "3";

const SITE_BASE =
  process.env.TONIN_SITE_BASE ||
  "https://www.supertonin.com.br";

const TONIN_BEARER_TOKEN =
  process.env.TONIN_BEARER_TOKEN || "";

const TONIN_LOJA_AUTH_JWT =
  process.env.TONIN_LOJA_AUTH_JWT || "";

const SESSION =
  process.env.TONIN_SESSION ||
  crypto.randomUUID();

function prepararTermosBusca(termoBusca) {
  const original = String(termoBusca || "")
    .replace(/\s+/g, " ")
    .trim();

  const termoLimpo = limparNomeBusca(original);

  const semQuantidade = original
    .replace(
      /\b\d+(?:[.,]\d+)?\s*(kg|g|mg|ml|l|un|und|unidade|unidades)\b/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();

  return [
    ...new Set(
      [
        original,
        termoLimpo,
        semQuantidade
      ].filter(Boolean)
    )
  ];
}

function criarHeaders(token) {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "pt-BR,pt;q=0.9",
    OrganizationId: ORG,
    Origin: SITE_BASE,
    Referer: `${SITE_BASE}/`,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/150.0.0.0 Safari/537.36"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function obterTokensParaTeste() {
  return [
    TONIN_BEARER_TOKEN,
    TONIN_LOJA_AUTH_JWT,
    ""
  ].filter(
    (token, indice, lista) =>
      lista.indexOf(token) === indice
  );
}

function montarUrlBusca(termo, pagina = 1) {
  const termoCodificado = encodeURIComponent(termo);

  return (
    `${API_BASE}/org/${ORG}` +
    `/filial/${FILIAL}` +
    `/centro_distribuicao/${CENTRO_DISTRIBUICAO}` +
    `/loja/buscas/produtos/termo/${termoCodificado}` +
    `?page=${pagina}` +
    `&session=${encodeURIComponent(SESSION)}`
  );
}

async function requisitarProdutos(termo) {
  const url = montarUrlBusca(termo);
  const tokens = obterTokensParaTeste();

  let ultimoStatus = null;
  let ultimaMensagem = null;

  for (const token of tokens) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: criarHeaders(token),
        signal: AbortSignal.timeout(30000)
      });

      ultimoStatus = response.status;

      const texto = await response.text();

      if (!response.ok) {
        ultimaMensagem = texto.slice(0, 500);

        console.log(
          "Tonin: tentativa recusada:",
          response.status,
          token
            ? "com autenticação"
            : "sem autenticação"
        );

        continue;
      }

      let dados;

      try {
        dados = JSON.parse(texto);
      } catch {
        console.log(
          "Tonin: a resposta não é um JSON válido."
        );

        continue;
      }

      console.log(
        "Tonin: consulta realizada com sucesso:",
        token
          ? "com autenticação"
          : "sem autenticação"
      );

      return dados;
    } catch (erro) {
      ultimaMensagem = erro.message;

      console.log(
        "Tonin: erro durante a tentativa:",
        erro.message
      );
    }
  }

  console.log(
    "Tonin: nenhuma tentativa de consulta funcionou.",
    {
      status: ultimoStatus,
      mensagem: ultimaMensagem
    }
  );

  return null;
}

function localizarArrayProdutos(dados) {
  if (!dados) {
    return [];
  }

  if (Array.isArray(dados)) {
    return dados;
  }

  const possibilidades = [
    dados.produtos,
    dados.products,
    dados.items,
    dados.data,
    dados.resultado,
    dados.resultados,
    dados.content,
    dados.lista
  ];

  for (const possibilidade of possibilidades) {
    if (Array.isArray(possibilidade)) {
      return possibilidade;
    }

    if (
      possibilidade &&
      typeof possibilidade === "object"
    ) {
      const arrayInterno = localizarArrayProdutos(
        possibilidade
      );

      if (arrayInterno.length > 0) {
        return arrayInterno;
      }
    }
  }

  return [];
}

function converterNumero(valor) {
  if (typeof valor === "number") {
    return Number.isFinite(valor)
      ? valor
      : null;
  }

  const numero = Number(
    String(valor || "")
      .replace("R$", "")
      .replace(/\s+/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
  );

  return Number.isFinite(numero)
    ? numero
    : null;
}

function normalizarImagem(imagem) {
  if (!imagem) {
    return null;
  }

  if (
    String(imagem).startsWith("http://") ||
    String(imagem).startsWith("https://")
  ) {
    return imagem;
  }

  try {
    return new URL(imagem, SITE_BASE).toString();
  } catch {
    return null;
  }
}

function normalizarLink(produto) {
  const produtoId =
    produto.produto_id ||
    produto.id ||
    produto.product_id ||
    produto.codigo;

  const slug =
    produto.link ||
    produto.slug ||
    produto.url_amigavel;

  if (
    slug &&
    String(slug).startsWith("http")
  ) {
    return slug;
  }

  if (produtoId && slug) {
    return `${SITE_BASE}/produto/${produtoId}/${String(
      slug
    ).replace(/^\/+/, "")}`;
  }

  if (produtoId) {
    return `${SITE_BASE}/produto/${produtoId}`;
  }

  return null;
}

function converterParaFormatoInterno(produto) {
  const productName =
    produto.descricao ||
    produto.nome ||
    produto.productName ||
    produto.titulo ||
    "";

  const ean =
    produto.codigo_barras ||
    produto.ean ||
    produto.codigoBarras ||
    null;

  const itemId =
    produto.produto_id ||
    produto.sku ||
    produto.id ||
    ean ||
    null;

  // A API do Tonin retorna os valores monetários em centavos.
  // Ex.: 1469 representa R$ 14,69.
  const priceBruto = converterNumero(
    produto.preco ??
    produto.price ??
    produto.valor
  );

  const listPriceBruto =
    converterNumero(
      produto.preco_de ??
      produto.preco_original ??
      produto.listPrice
    );

  const price =
    Number.isFinite(priceBruto)
      ? priceBruto / 100
      : null;

  const listPrice =
    Number.isFinite(listPriceBruto)
      ? listPriceBruto / 100
      : price;

  const available =
    produto.disponivel !== false &&
    produto.available !== false &&
    produto.estoque !== 0 &&
    Number.isFinite(price) &&
    price > 0;

  const image = normalizarImagem(
    produto.imagem ||
    produto.image ||
    produto.foto
  );

  return {
    productName,
    productTitle: productName,

    items: [
      {
        ean: ean
          ? String(ean)
          : null,

        itemId: itemId
          ? String(itemId)
          : null,

        images: [
          {
            imageUrl: image
          }
        ],

        sellers: [
          {
            sellerId: "tonin",
            sellerDefault: true,

            commertialOffer: {
              Price: price,
              ListPrice: listPrice,
              IsAvailable: available
            }
          }
        ]
      }
    ],

    link: normalizarLink(produto),
    toninOriginal: produto
  };
}

function removerDuplicados(produtos) {
  const identificadores = new Set();

  return produtos.filter((produto) => {
    const ean = String(
      produto.items?.[0]?.ean || ""
    ).trim();

    const nome = String(
      produto.productName || ""
    )
      .toLowerCase()
      .trim();

    const identificador = ean || nome;

    if (!identificador) {
      return false;
    }

    if (identificadores.has(identificador)) {
      return false;
    }

    identificadores.add(identificador);

    return true;
  });
}

async function pesquisarNoTonin(termo) {
  const dados = await requisitarProdutos(termo);

  const produtosBrutos =
    localizarArrayProdutos(dados);

  const produtos = produtosBrutos
    .map(converterParaFormatoInterno)
    .filter(
      (produto) =>
        produto.productName &&
        produto.items?.[0]?.sellers?.[0]
          ?.commertialOffer
    );

  console.log(
    "Tonin termo pesquisado:",
    termo
  );

  console.log(
    "Produtos encontrados no Tonin:",
    produtos.map(
      (produto) => produto.productName
    )
  );

  return produtos;
}

function extrairOferta(produto) {
  const item = produto.items?.[0];

  const seller =
    item?.sellers?.find(
      (registro) => registro.sellerDefault
    ) ||
    item?.sellers?.[0];

  const oferta = seller?.commertialOffer;

  if (!item || !seller || !oferta) {
    return null;
  }

  return criarProduto({
    supermarketId: "tonin",
    productName: produto.productName,

    ean: item.ean,
    itemId: item.itemId,

    sellerId: seller.sellerId,

    price: oferta.Price || null,
    listPrice:
      oferta.ListPrice ||
      oferta.Price ||
      null,

    available:
      oferta.IsAvailable === true,

    image:
      item.images?.[0]?.imageUrl ||
      null,

    url: produto.link || null
  });
}

async function buscarProduto(
  termoBusca,
  eanBuscado
) {
  const termos = prepararTermosBusca(
    termoBusca
  );

  let produtos = [];

  for (const termo of termos) {
    const encontrados =
      await pesquisarNoTonin(termo);

    produtos.push(...encontrados);

    if (encontrados.length > 0) {
      break;
    }
  }

  produtos = removerDuplicados(produtos);

  if (produtos.length === 0) {
    return null;
  }

  if (eanBuscado) {
    const produtoExato = produtos.find(
      (produto) =>
        produto.items?.some(
          (item) =>
            String(item.ean || "") ===
            String(eanBuscado)
        )
    );

    if (
      produtoExato &&
      validarCorrespondencia(
        termoBusca,
        produtoExato
      )
    ) {
      return extrairOferta(produtoExato);
    }
  }

  const melhor = escolherMelhorProduto(
    produtos,
    calcularPontuacao,
    termoBusca,
    eanBuscado
  );

  if (!melhor) {
    return null;
  }

  return extrairOferta(melhor);
}

module.exports = {
  buscarProduto
};