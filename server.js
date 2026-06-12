const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright-core");

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

  try {

    const browser = await chromium.launch({
      headless: true,
      executablePath: "/usr/bin/chromium-browser",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--single-process"
      ]
    });

    const page = await browser.newPage();

    const url = `https://www.google.com/search?q=${encodeURIComponent(produto)}+savegnago`;

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    const titulo = await page.title();

    await browser.close();

    res.json({
      produto,
      buscaRealizada: true,
      tituloGoogle: titulo,
      fonte: "google-real"
    });

  } catch (erro) {

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
