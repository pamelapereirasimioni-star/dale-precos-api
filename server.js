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

    const busca = `${produto} savegnago preço`;
    const url = `https://www.google.com/search?q=${encodeURIComponent(busca)}`;

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(3000);

    const resultados = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));

      return links
        .map((link) => ({
          titulo: link.innerText,
          url: link.href
        }))
        .filter((item) =>
          item.titulo &&
          item.titulo.length > 10 &&
          item.url.includes("http")
        )
        .slice(0, 5);
    });

    await browser.close();

    res.json({
      produto,
      busca,
      resultados,
      fonte: "google-real"
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
