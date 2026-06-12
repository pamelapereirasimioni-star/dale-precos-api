const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

function gerarPreco(produto, mercado) {
  const base = produto.length + mercado.length;
  return Number(((base % 20) + 5 + Math.random() * 3).toFixed(2));
}

app.get("/", (req, res) => {
  res.send("Servidor DALE online 🚀");
});

app.get("/buscar", async (req, res) => {
  const produto = req.query.q || "produto";

  const mercados = [
    {
      nome: "Savegnago",
      preco: gerarPreco(produto, "Savegnago"),
      disponivel: true,
      fonte: "simulado"
    },
    {
      nome: "Tonin",
      preco: gerarPreco(produto, "Tonin"),
      disponivel: true,
      fonte: "simulado"
    },
    {
      nome: "Big Compra",
      preco: gerarPreco(produto, "Big Compra"),
      disponivel: true,
      fonte: "simulado"
    }
  ];

  res.json({
    produto,
    mercados
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});
