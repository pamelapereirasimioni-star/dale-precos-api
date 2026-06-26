const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.options("*", cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Servidor DALE online 🚀");
});

function normalizarTexto(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extrairPeso(texto) {
  const normalizado = normalizarTexto(texto);
  const match = normalizado.match(/(\d+(?:[.,]\d+)?)\s?(kg|g|ml|l)/);

  if (!match) return null;

  return `${match[1].replace(",", ".")}${match[2]}`;
}

function calcularPontuacao(termoBusca, produto, eanBuscado) {
  const buscado = normalizarTexto(termoBusca);
  const nome = normalizarTexto(produto.productName || produto.productTitle || "");

  let pontos = 0;

  const item = produto.items?.[0];

  if (eanBuscado && item?.ean && String(item.ean) === String(eanBuscado)) {
    pontos += 1000;
  }

  const palavras = buscado.split(" ").filter((p) => p.length > 2);

  for (const palavra of palavras) {
    if (nome.includes(palavra)) pontos += 5;
    else pontos -= 2;
  }

  const pesoBuscado = extrairPeso(buscado);
  const pesoProduto = extrairPeso(nome);

  if (pesoBuscado && pesoProduto) {
    if (pesoBuscado === pesoProduto) pontos += 80;
    else pontos -= 100;
  }

  const termosProibidos = ["pronto", "branco", "preto", "500g", "380g"];

  for (const termo of termosProibidos) {
    if (!buscado.includes(termo) && nome.includes(termo)) {
      pontos -= 40;
    }
  }

  return pontos;
}

function extrairMelhorOferta(produto) {
  const item = produto.items?.[0];
  const seller = item?.sellers?.find((s) => s.sellerDefault) || item?.sellers?.[0];
  const oferta = seller?.commertialOffer;

  if (!item || !seller || !oferta) return null;

  return {
    productName: produto.productName,
    productTitle: produto.productTitle,
    ean: item.ean,
    itemId: item.itemId,
    sellerId: seller.sellerId,
    price: oferta.Price || null,
    listPrice: oferta.ListPrice || null,
    available: oferta.IsAvailable === true,
    image: item.images?.[0]?.imageUrl || null,
    url: produto.link || null
  };
}

function escolherMelhorProduto(termoBusca, produtos, eanBuscado) {
  if (!Array.isArray(produtos) || produtos.length === 0) return null;

  const ordenados = produtos
    .map((produto) => ({
      produto,
      pontuacao: calcularPontuacao(termoBusca, produto, eanBuscado)
    }))
    .sort((a, b) => b.pontuacao - a.pontuacao);

  console.log(
    "Ranking:",
    ordenados.slice(0, 5).map((x) => ({
      nome: x.produto.productName,
      ean: x.produto.items?.[0]?.ean,
      pontuacao: x.pontuacao
    }))
  );

  return ordenados[0].produto;
}

async function consultarVTEX(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "DALE-Precos/1.0"
    }
  });

  if (!response.ok) {
    console.log("Erro VTEX:", response.status, url);
    return [];
  }

  return response.json();
}

async function buscarPorEAN(ean) {
  if (!ean) return [];

  const url = `https://www.savegnago.com.br/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${encodeURIComponent(ean)}`;

  return consultarVTEX(url);
}

async function buscarPorNome(termoBusca) {
  const termo = String(termoBusca || "").trim();

  if (!termo) return [];

  const url = `https://www.savegnago.com.br/api/catalog_system/pub/products/search/${encodeURIComponent(termo)}?_from=0&_to=30`;

  return consultarVTEX(url);
}

async function buscarSavegnagoVTEX(termoBusca, eanBuscado) {
  let produtos = [];

  if (eanBuscado) {
    produtos = await buscarPorEAN(eanBuscado);

    if (Array.isArray(produtos) && produtos.length > 0) {
      const produtoExato = produtos.find(
        (p) => p.items?.some((item) => String(item.ean) === String(eanBuscado))
      );

      if (produtoExato) {
        return extrairMelhorOferta(produtoExato);
      }
    }
  }

  produtos = await buscarPorNome(termoBusca);

  const melhorProduto = escolherMelhorProduto(termoBusca, produtos, eanBuscado);

  if (!melhorProduto) return null;

  return extrairMelhorOferta(melhorProduto);
}

app.get("/buscar", async (req, res) => {
  const produto = req.query.q;
  const ean = req.query.ean;

  if (!produto && !ean) {
    return res.json({ erro: "Produto ou EAN não informado" });
  }

  try {
    const resultado = await buscarSavegnagoVTEX(produto || ean, ean);

    return res.json({
      produto: produto || ean,
      mercado: "Savegnago",
      total: resultado ? 1 : 0,
      produtos: resultado ? [resultado] : [],
      fonte: "savegnago-vtex"
    });
  } catch (erro) {
    console.error("Erro /buscar:", erro.message);

    return res.json({
      erro: true,
      mensagem: erro.message
    });
  }
});

app.post("/prices/batch", async (req, res) => {
  console.log("POST /prices/batch RECEBIDO");
  console.log("Body recebido:", req.body);

  try {
    const produto = req.body.products?.[0];

    if (!produto || (!produto.nome && !produto.name && !produto.ean)) {
      return res.json([]);
    }

    const termoBusca = produto.nome || produto.name || produto.ean;
    const eanBuscado = produto.ean;

    const resultado = await buscarSavegnagoVTEX(termoBusca, eanBuscado);

    console.log("Termo buscado:", termoBusca);
    console.log("EAN buscado:", eanBuscado);
    console.log("Resultado VTEX:", resultado);

    return res.json([
      {
        ean: produto.ean,
        supermarketId: "savegnago",
        price: resultado?.price || null,
        available: resultado?.available || false,
        promo: false,
        lastUpdate: new Date().toISOString(),
        source: "savegnago-vtex",
        productName: resultado?.productName || termoBusca,
        matchedEan: resultado?.ean || null,
        itemId: resultado?.itemId || null,
        image: resultado?.image || null,
        url: resultado?.url || null
      }
    ]);
  } catch (erro) {
    console.error("Erro /prices/batch:", erro.message);

    return res.json([
      {
        ean: req.body.products?.[0]?.ean || null,
        supermarketId: "savegnago",
        price: null,
        available: false,
        promo: false,
        lastUpdate: new Date().toISOString(),
        source: "savegnago-vtex",
        productName: req.body.products?.[0]?.nome || null
      }
    ]);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando 🚀");
});
