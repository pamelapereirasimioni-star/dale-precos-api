const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Servidor DALE online 🚀");
});

app.get("/buscar", async (req, res) => {
  const produto = req.query.q;

  res.json({
    produto,
    mercados: [
      {
        nome: "Savegnago",
        preco: 12.99
      },
      {
        nome: "Tonin",
        preco: 13.49
      }
    ]
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});
