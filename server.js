const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();

app.use(cors());

app.get("/", (req, res) => {
  res.send("Servidor DALE online 🚀");
});

app.get("/buscar", async (req, res) => {
  const produto = req.query.q;

  if (!produto) {
    return res.json({
      erro: "Produto não informado"
    });
  }

  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    });

    const page = await browser.newPage();

    const url = `https://www.savegnago.com.br/${encodeURIComponent(produto)}?_q=${encodeURIComponent(produto)}&map=ft`;

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });

    await page.waitForTimeout(8000);

    const produtos = await page.evaluate(() => {
      const lista = [];
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
        "sem sugestões"
      ];

      for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i];
        const textoLower = linha.toLowerCase();

        const pareceProduto =
          linha.length > 10 &&
          !linha.includes("R$") &&
          !bloqueados.some((p) => textoLower.includes(p));

        if (!pareceProduto) continue;

        for (let j = i + 1; j <= i + 10 && j < linhas.length; j++) {
          const precoMatch = linhas[j].match(/R\$\s?\d{1,3}(?:\.\d{3})*,\d{2}/);

          if (precoMatch) {
            lista.push({
              nome: linha,
              preco: precoMatch[0]
            });
            break;
          }
        }
      }

      const semDuplicados = [];
      const vistos = new Set();

      for (const item of lista) {
        const chave = `${item.nome}-${item.preco}`;

        if (!vistos.has(chave)) {
          vistos.add(chave);
          semDuplicados.push(item);
        }
      }

      return semDuplicados.slice(0, 15);
    });

    await browser.close();

    res.json({
      produto,
      mercado: "Savegnago",
      total: produtos.length,
      produtos,
      fonte: "savegnago-real"
    });

  } catch (erro) {
    if (browser) {
      await browser.close();
    }

    res.json({
      erro: true,
      mensagem: erro.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando 🚀");
});
