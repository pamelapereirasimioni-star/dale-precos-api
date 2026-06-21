const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Servidor DALE online 🚀");
});

function converterPreco(precoTexto) {
  if (!precoTexto) return null;

  return Number(
    precoTexto
      .replace("R$", "")
      .replace(".", "")
      .replace(",", ".")
      .trim()
  );
}

async function buscarSavegnago(produto) {
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      timeout: 30000,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
        "--disable-extensions"
      ]
    });

    const page = await browser.newPage();

    const termo = String(produto || "").trim();
    const url = `https://www.savegnago.com.br/${encodeURIComponent(termo)}?_q=${encodeURIComponent(termo)}&map=ft`;

    await page.goto(url, {
      waitUntil: "load",
      timeout: 30000
    });

    await page.waitForTimeout(2000);

    const produtos = await page.evaluate(() => {
      const textoPagina = document.body.innerText || "";

      const linhas = textoPagina
        .split("\n")
        .map((linha) => linha.trim())
        .filter(Boolean);

      const bloqueados = [
        "buscar",
        "volume",
        "faixas de preço",
        "nosso cartão",
        "relevância",
        "categorias",
        "comprar",
        "filtros",
        "promoções",
        "lista de",
        "retire em",
        "minha conta",
        "departamento",
        "marca",
        "preço",
        "ofertas",
        "frete grátis",
        "cupom",
        "sem sugestões",
        "tipo de produto",
        "patrocinado",
        "sacola",
        "login",
        "cadastro"
      ];

      const lista = [];

      for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i];
        const textoLower = linha.toLowerCase();

        if (linha.includes("R$")) continue;
        if (linha.length < 8) continue;
        if (bloqueados.some((p) => textoLower.includes(p))) continue;

        for (let j = i + 1; j <= i + 8 && j < linhas.length; j++) {
          const precoMatch = linhas[j].match(/R\$\s?\d{1,3}(?:\.\d{3})*,\d{2}/);

          if (precoMatch) {
            lista.push({
              nome: linha,
              precoTexto: precoMatch[0]
            });
            break;
          }
        }
      }

      const semDuplicados = [];
      const vistos = new Set();

      for (const item of lista) {
        const chave = `${item.nome}-${item.precoTexto}`;

        if (!vistos.has(chave)) {
          vistos.add(chave);
          semDuplicados.push(item);
        }
      }

      return semDuplicados.slice(0, 15);
    });

    await browser.close();

    return produtos.map((item) => ({
      nome: item.nome,
      precoTexto: item.precoTexto,
      preco: converterPreco(item.precoTexto)
    }));

  } catch (erro) {
    if (browser) await browser.close();
    console.error("Erro Savegnago:", erro.message);
    return [];
  }
}

app.get("/buscar", async (req, res) => {
  const produto = req.query.q;

  if (!produto) {
    return res.json({ erro: "Produto não informado" });
  }

  const produtos = await buscarSavegnago(produto);

  res.json({
    produto,
    mercado: "Savegnago",
    total: produtos.length,
    produtos,
    fonte: "savegnago-real"
  });
});

app.post("/prices/batch", async (req, res) => {
  console.log("POST /prices/batch RECEBIDO");
  console.log("Body recebido:", req.body);

  return res.json([
    {
      ean: "7893500012672",
      supermarketId: "savegnago",
      price: 9.99,
      available: true,
      promo: false,
      lastUpdate: new Date().toISOString(),
      source: "teste",
      productName: "Produto teste Savegnago"
    }
  ]);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando 🚀");
});
