const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "Servidor DALE funcionando"
  });
});

app.post("/buscar", async (req, res) => {
  try {
    const { produto } = req.body;

    res.json({
      produto,
      mercados: [
        {
          nome: "Big Compra",
          preco: 12.99
        },
        {
          nome: "Savegnago",
          preco: 13.49
        }
      ]
    });

  } catch (error) {
    res.status(500).json({
      erro: "Erro interno"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});
