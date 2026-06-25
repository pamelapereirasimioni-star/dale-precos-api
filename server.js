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

function calcularPontuacao(termoBusca, produto) {
  const buscado = normalizarTexto(termoBusca);
  const nome = normalizarTexto(produto.productName || produto.productTitle || "");

  let pontos = 0;

  const palavras = buscado.split(" ").filter((p) => p.length > 2);

  for (const palavra of palavras) {
    if (nome.includes(palavra)) pontos += 3;
  }

  const pesoBuscado = buscado.match(/\d+\s?(kg|g)/);
  const pesoProduto = nome.match(/\d+\s?(kg|g)/);

  if (pesoBuscado && pesoProduto) {
    const pesoB = pesoBuscado[0].replace(/\s/g, "");
    const pesoP = pesoProduto[0].replace(/\s/g, "");

    if (pesoB === pesoP) pontos += 30;
    else pontos -= 30;
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

function escolherMelhorProduto(termoBusca, produtos) {
  if (!Array.isArray(produtos) || produtos.length === 0) return null;

  const ordenados = produtos
    .map((produto) => ({
      produto,
      pontuacao: calcularPontuacao(termoBusca, produto)
    }))
    .sort((a, b) => b.pontuacao - a.pontuacao);

  return ordenados[0].produto;
}

async function buscarSavegnagoVTEX(termoBusca) {
  const termo = String(termoBusca || "").trim();

  if (!termo) return null;

  const url = `https://www.savegnago.com.br/api/catalog_system/pub/products/search/${encodeURIComponent(termo)}?_from=0&_to=20`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "User-Agent": "DALE-Precos/1.0"
    }
  });

  if (!response.ok) {
    console.log("Erro VTEX:", response.status);
    return null;
  }

  const produtos = await response.json();

  const melhorProduto = escolherMelhorProduto(termo, produtos);

  if (!melhorProduto) return null;

  return extrairMelhorOferta(melhorProduto);
}

app.get("/buscar", async (req, res) => {
  const produto = req.query.q;

  if (!produto) {
    return res.json({ erro: "Produto não informado" });
  }

  try {
    const resultado = await buscarSavegnagoVTEX(produto);

    return res.json({
      produto,
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

    const resultado = await buscarSavegnagoVTEX(termoBusca);

    console.log("Termo buscado:", termoBusca);
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
