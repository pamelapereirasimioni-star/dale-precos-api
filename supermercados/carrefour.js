const { limparNomeBusca } = require("../utils/texto");
const { validarCorrespondencia } = require("../core/validador");
const { calcularPontuacao } = require("../core/score");
const { escolherMelhorProduto } = require("../core/escolhedor");
const { criarProduto } = require("../core/produto");

const HOSTS_VTEX = [
  "https://master--carrefourbrfood.myvtex.com",
  "https://carrefourbrfood.vtexcommercestable.com.br"
];

let hostPreferido = null;

function limparCep(cep) {
  return String(cep || "").replace(/\D/g, "");
}

function normalizarTexto(valor) {
  return String(valor || "").trim();
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  adicionarDaResposta(resposta) {
    let valores = [];

    if (typeof resposta?.headers?.getSetCookie === "function") {
      valores = resposta.headers.getSetCookie();
    } else {
      const unico = resposta?.headers?.get?.("set-cookie");
      if (unico) valores = [unico];
    }

    for (const bruto of valores) {
      const primeiro = String(bruto || "").split(";")[0];
      const indice = primeiro.indexOf("=");
      if (indice <= 0) continue;
      const nome = primeiro.slice(0, indice).trim();
      const valor = primeiro.slice(indice + 1).trim();
      if (nome) this.cookies.set(nome, valor);
    }
  }

  cabecalho() {
    return [...this.cookies.entries()]
      .map(([nome, valor]) => `${nome}=${valor}`)
      .join("; ");
  }

  nomes() {
    return [...this.cookies.keys()];
  }
}

async function requisitarJson(url, options = {}, jar = null) {
  try {
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "DALE-Precos/1.0",
      ...(options.headers || {})
    };

    const cookies = jar?.cabecalho?.();
    if (cookies) headers.Cookie = cookies;

    const resposta = await fetch(url, { ...options, headers });
    if (jar) jar.adicionarDaResposta(resposta);

    const texto = await resposta.text().catch(() => "");
    let data = null;
    try { data = texto ? JSON.parse(texto) : null; } catch {}

    return { ok: resposta.ok, status: resposta.status, data, texto };
  } catch (erro) {
    return {
      ok: false,
      status: 0,
      data: null,
      texto: "",
      erro: erro?.message || String(erro)
    };
  }
}

function valorSessao(namespaces, namespace, chave) {
  return namespaces?.[namespace]?.[chave]?.value ??
    namespaces?.[namespace]?.[chave]?.Value ?? null;
}

function ordenarHosts() {
  if (!hostPreferido) return [...HOSTS_VTEX];
  return [hostPreferido, ...HOSTS_VTEX.filter((host) => host !== hostPreferido)];
}

async function criarContextoRegional(cep) {
  const cepLimpo = limparCep(cep);
  if (cepLimpo.length !== 8) return null;

  for (const host of ordenarHosts()) {
    const jar = new CookieJar();

    const criarSessao = await requisitarJson(
      `${host}/api/sessions`,
      {
        method: "POST",
        body: JSON.stringify({
          public: {
            country: { value: "BRA" },
            postalCode: { value: cepLimpo }
          }
        })
      },
      jar
    );

    if (!criarSessao.ok) continue;

    const items = [
      "public.country",
      "public.postalCode",
      "public.regionId",
      "checkout.regionId",
      "checkout.cartId",
      "store.channel"
    ].join(",");

    const lerSessao = await requisitarJson(
      `${host}/api/sessions?items=${encodeURIComponent(items)}`,
      { method: "GET" },
      jar
    );

    if (!lerSessao.ok) continue;

    const namespaces = lerSessao.data?.namespaces || {};
    const regionId =
      valorSessao(namespaces, "checkout", "regionId") ||
      valorSessao(namespaces, "public", "regionId");
    const salesChannel = String(
      valorSessao(namespaces, "store", "channel") || "1"
    );

    if (!regionId) continue;

    hostPreferido = host;

    const contexto = {
      host,
      jar,
      cep: cepLimpo,
      regionId,
      salesChannel,
      cartId: valorSessao(namespaces, "checkout", "cartId")
    };

    console.log("Carrefour: contexto regional resolvido.", {
      host,
      cep: cepLimpo,
      regionId,
      salesChannel,
      cookies: jar.nomes()
    });

    return contexto;
  }

  console.log("Carrefour: não foi possível criar sessão regional VTEX.", { cep: cepLimpo });
  return null;
}

function extrairProdutos(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.products)) return data.products;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

async function buscarIntelligentSearch(contexto, termo) {
  if (!contexto || !termo) return [];

  const params = new URLSearchParams({
    query: String(termo),
    page: "1",
    count: "30",
    country: "BRA",
    "zip-code": contexto.cep,
    sc: contexto.salesChannel,
    regionId: contexto.regionId
  });

  const resultado = await requisitarJson(
    `${contexto.host}/api/io/_v/api/intelligent-search/product_search?${params.toString()}`,
    { method: "GET" },
    contexto.jar
  );

  if (!resultado.ok) {
    console.log("Carrefour: Intelligent Search falhou.", {
      status: resultado.status,
      termo: String(termo),
      host: contexto.host
    });
    return [];
  }

  return extrairProdutos(resultado.data);
}

async function buscarPorEAN(contexto, ean) {
  return ean ? buscarIntelligentSearch(contexto, ean) : [];
}

async function buscarPorNome(contexto, nome) {
  const termo = limparNomeBusca(nome);
  return termo ? buscarIntelligentSearch(contexto, termo) : [];
}

function sellersCarrefourDoItem(item) {
  const ids = [];

  for (const seller of item?.sellers || []) {
    const id = normalizarTexto(seller?.sellerId || seller?.seller);
    const nome = normalizarTexto(seller?.sellerName || seller?.name).toLowerCase();
    const pareceCarrefour = nome.includes("carrefour") || id === "1";
    if (pareceCarrefour && id && !ids.includes(id)) ids.push(id);
  }

  if (!ids.length) ids.push("1");
  return ids;
}

async function simularProduto(contexto, itemId, sellerId, quantidade = 1) {
  const resultado = await requisitarJson(
    `${contexto.host}/api/checkout/pub/orderForms/simulation?RnbBehavior=0&sc=${encodeURIComponent(contexto.salesChannel)}`,
    {
      method: "POST",
      body: JSON.stringify({
        items: [{ id: String(itemId), quantity: quantidade, seller: String(sellerId) }],
        postalCode: contexto.cep,
        country: "BRA"
      })
    },
    contexto.jar
  );

  if (!resultado.ok) return null;

  const resposta = resultado.data;
  const item = resposta?.items?.[0];
  if (!item) return null;

  const available = item.availability === "available";
  const price = typeof item.sellingPrice === "number" ? item.sellingPrice / 100 : null;
  const listPrice = typeof item.listPrice === "number" ? item.listPrice / 100 : price;

  const pickupDistances = [];
  for (const info of resposta?.logisticsInfo || []) {
    for (const sla of info?.slas || []) {
      if (sla.deliveryChannel === "pickup-in-point" && typeof sla.pickupDistance === "number") {
        pickupDistances.push(sla.pickupDistance);
      }
    }
  }

  return {
    sellerId: String(sellerId),
    available,
    price,
    listPrice,
    pickupDistance: pickupDistances.length ? Math.min(...pickupDistances) : null,
    priceTags: Array.isArray(item.priceTags) ? item.priceTags : [],
    messages: Array.isArray(resposta?.messages) ? resposta.messages : []
  };
}

async function buscarOfertaRegional(contexto, item) {
  const candidatos = [...new Set(sellersCarrefourDoItem(item))];

  console.log("Carrefour sellers candidatos na sessão regional:", candidatos);

  const simulacoes = await Promise.all(
    candidatos.map((sellerId) => simularProduto(contexto, item.itemId, sellerId, 1))
  );

  const ofertas = simulacoes.filter(
    (oferta) => oferta && oferta.available && typeof oferta.price === "number" && oferta.price > 0
  );

  if (!ofertas.length) return null;

  ofertas.sort((a, b) => {
    const ad = typeof a.pickupDistance === "number";
    const bd = typeof b.pickupDistance === "number";
    if (ad && bd && a.pickupDistance !== b.pickupDistance) return a.pickupDistance - b.pickupDistance;
    if (ad && !bd) return -1;
    if (!ad && bd) return 1;
    return a.price - b.price;
  });

  return ofertas[0];
}

function localizarItemExato(produto, eanBuscado) {
  if (!produto?.items?.length) return null;
  if (!eanBuscado) return produto.items[0];
  return produto.items.find((item) => String(item.ean || "") === String(eanBuscado)) || null;
}

async function montarProdutoRegional(contexto, produto, eanBuscado) {
  const item = localizarItemExato(produto, eanBuscado);
  if (!item) return null;

  const oferta = await buscarOfertaRegional(contexto, item);

  if (!oferta) {
    console.log("Carrefour: produto exato sem oferta disponível na sessão regional.", {
      cep: contexto.cep,
      ean: item.ean,
      itemId: item.itemId,
      regionId: contexto.regionId,
      salesChannel: contexto.salesChannel
    });
    return null;
  }

  console.log("Carrefour oferta regional:", {
    hostVTEX: contexto.host,
    cep: contexto.cep,
    regionId: contexto.regionId,
    salesChannel: contexto.salesChannel,
    ean: item.ean,
    itemId: item.itemId,
    sellerId: oferta.sellerId,
    price: oferta.price,
    listPrice: oferta.listPrice
  });

  return criarProduto({
    supermarketId: "carrefour",
    productName: produto.productName || produto.name,
    ean: item.ean,
    itemId: item.itemId,
    sellerId: oferta.sellerId,
    price: oferta.price,
    listPrice: oferta.listPrice,
    available: oferta.available,
    image: item.images?.[0]?.imageUrl || null,
    url: produto.link || produto.linkText || null
  });
}

async function buscarProduto(termoBusca, eanBuscado, cep) {
  const contexto = await criarContextoRegional(cep);
  if (!contexto) return null;

  let produtos = [];

  if (eanBuscado) {
    produtos = await buscarPorEAN(contexto, eanBuscado);

    const exatos = produtos.filter((produto) =>
      produto.items?.some((item) => String(item.ean || "") === String(eanBuscado))
    );

    for (const produto of exatos) {
      if (!validarCorrespondencia(termoBusca, produto)) continue;
      const resultado = await montarProdutoRegional(contexto, produto, eanBuscado);
      if (resultado) return resultado;
    }
  }

  produtos = await buscarPorNome(contexto, termoBusca);
  if (!produtos.length) return null;

  if (eanBuscado) {
    const exatos = produtos.filter((produto) =>
      produto.items?.some((item) => String(item.ean || "") === String(eanBuscado))
    );

    for (const produto of exatos) {
      if (!validarCorrespondencia(termoBusca, produto)) continue;
      const resultado = await montarProdutoRegional(contexto, produto, eanBuscado);
      if (resultado) return resultado;
    }

    console.log("Carrefour: nenhum cadastro com EAN exato gerou oferta regional válida.", {
      termoBusca,
      eanBuscado,
      candidatos: produtos.length,
      exatos: exatos.length
    });
    return null;
  }

  const melhor = escolherMelhorProduto(produtos, calcularPontuacao, termoBusca, null);
  if (!melhor) return null;

  return montarProdutoRegional(contexto, melhor, null);
}

module.exports = { buscarProduto };
