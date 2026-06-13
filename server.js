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
    return res.json({ erro: "Produto não informado" });
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
      waitUntil: "networkidle",
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    const texto = await page.evaluate(() => document.body.innerText);

    await browser.close();

    res.json({
      produto,
      mercado: "Savegnago",
      url,
      textoCapturado: texto.slice(0, 3000),
      fonte: "savegnago-real"
    });

  } catch (erro) {
    if (browser) await browser.close();

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
