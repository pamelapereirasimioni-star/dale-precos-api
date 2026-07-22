require("dotenv").config();

const express = require("express");
const cors = require("cors");

const {
  limparNomeBusca
} = require("./utils/texto");

const {
  buscarProduto: buscarSavegnago
} = require("./supermercados/savegnago");

const {
  buscarProduto: buscarJauServe
} = require("./supermercados/jauserve");

const {
  buscarProduto: buscarTonin
} = require("./supermercados/tonin");

const app = express();

/*
 * CONFIGURAÇÕES
 */

const PORT =
  Number(process.env.PORT) || 3000;

const LIMITE_PRODUTOS_LOTE =
  Number(
    process.env.LIMITE_PRODUTOS_LOTE
  ) || 100;

const CONCORRENCIA_PRODUTOS =
  Number(
    process.env.CONCORRENCIA_PRODUTOS
  ) || 3;

const CACHE_TTL_MS =
  Number(process.env.CACHE_TTL_MS) ||
  10 * 60 * 1000;

const TONIN_ENABLED =
  String(
    process.env.TONIN_ENABLED || "false"
  ).toLowerCase() === "true";

/*
 * MIDDLEWARES
 */

app.use(cors());
app.options("*", cors());

app.use(
  express.json({
    limit: "5mb"
  })
);

/*
 * CACHE EM MEMÓRIA
 */

const cacheConsultas = new Map();

function gerarChaveCache(
  termoBusca,
  eanBuscado
) {
  return [
    limparNomeBusca(termoBusca || ""),
    String(eanBuscado || "").trim()
  ].join("|");
}

function obterDoCache(chave) {
  const registro =
    cacheConsultas.get(chave);

  if (!registro) {
    return null;
  }

  const expirou =
    Date.now() - registro.criadoEm >
    CACHE_TTL_MS;

  if (expirou) {
    cacheConsultas.delete(chave);
    return null;
  }

  return registro.resultados;
}

function salvarNoCache(
  chave,
  resultados
) {
  cacheConsultas.set(chave, {
    criadoEm: Date.now(),
    resultados
  });
}

function limparCacheExpirado() {
  const agora = Date.now();

  for (
    const [chave, registro]
    of cacheConsultas.entries()
  ) {
    const expirou =
      agora - registro.criadoEm >
      CACHE_TTL_MS;

    if (expirou) {
      cacheConsultas.delete(chave);
    }
  }
}

const intervaloLimpezaCache =
  setInterval(
    limparCacheExpirado,
    5 * 60 * 1000
  );

intervaloLimpezaCache.unref();

/*
 * SUPERMERCADOS
 */

function obterSupermercadosAtivos() {
  const supermercados = [
    {
      id: "savegnago",
      buscarProduto: buscarSavegnago
    },
    {
      id: "jauserve",
      buscarProduto: buscarJauServe
    }
  ];

  if (TONIN_ENABLED) {
    supermercados.push({
      id: "tonin",
      buscarProduto: buscarTonin
    });
  }

  return supermercados;
}

/*
 * NORMALIZAÇÃO DOS PRODUTOS RECEBIDOS
 */

function normalizarProdutoRecebido(
  produto,
  indice
) {
  if (
    !produto ||
    typeof produto !== "object"
  ) {
    return null;
  }

  const nome =
    produto.nome ||
    produto.name ||
    produto.productName ||
    "";

  const ean =
    produto.ean ||
    produto.barcode ||
    produto.codigoBarras ||
    "";

  const termoBusca =
    String(nome || ean)
      .replace(/\s+/g, " ")
      .trim();

  if (!termoBusca) {
    return null;
  }

  return {
    indice,
    id:
      produto.id ||
      produto.productId ||
      null,

    nome:
      String(nome || "")
        .replace(/\s+/g, " ")
        .trim(),

    termoBusca,

    ean:
      ean
        ? String(ean).trim()
        : null,

    quantidade:
      Number(produto.quantidade) ||
      Number(produto.quantity) ||
      1,

    original: produto
  };
}

/*
 * CONSULTA NOS SUPERMERCADOS
 */

async function buscarEmTodosMercados(
  termoBusca,
  eanBuscado
) {
  const chaveCache =
    gerarChaveCache(
      termoBusca,
      eanBuscado
    );

  const cache =
    obterDoCache(chaveCache);

  if (cache) {
    console.log(
      `CACHE: ${termoBusca}`
    );

    return cache;
  }

  const supermercados =
    obterSupermercadosAtivos();

  const consultas =
    supermercados.map(
      async (supermercado) => {
        try {
          const resultado =
            await supermercado.buscarProduto(
              termoBusca,
              eanBuscado
            );

          return {
            supermercado:
              supermercado.id,

            resultado
          };
        } catch (erro) {
          console.error(
            `Erro no supermercado ${supermercado.id}:`,
            erro.message
          );

          return {
            supermercado:
              supermercado.id,

            resultado: null
          };
        }
      }
    );

  const respostas =
    await Promise.all(consultas);

  const resultados = respostas
    .filter(
      (resposta) =>
        resposta.resultado
    )
    .map(
      (resposta) =>
        resposta.resultado
    );

  /*
   * Só guardamos no cache quando algum
   * supermercado encontrou o produto.
   */
  if (resultados.length > 0) {
    salvarNoCache(
      chaveCache,
      resultados
    );
  }

  return resultados;
}

/*
 * FORMATAÇÃO PARA O LOVABLE
 */

function formatarResultadoBatch(
  produtoRecebido,
  resultado
) {
  const price =
    Number(resultado.price);

  const listPrice =
    Number(resultado.listPrice);

  return {
    /*
     * EAN original enviado pelo Lovable.
     */
    ean:
      produtoRecebido.ean ||
      resultado.ean ||
      null,

    /*
     * Identificação opcional do produto
     * dentro do catálogo do Lovable.
     */
    productId:
      produtoRecebido.id,

    supermarketId:
      resultado.supermarketId,

    price:
      Number.isFinite(price) &&
      price > 0
        ? price
        : null,

    available:
      resultado.available === true,

    promo:
      Number.isFinite(listPrice) &&
      Number.isFinite(price) &&
      listPrice > price,

    lastUpdate:
      resultado.lastUpdate ||
      new Date().toISOString(),

    source:
      resultado.supermarketId,

    productName:
      resultado.productName ||
      produtoRecebido.termoBusca,

    searchedProductName:
      produtoRecebido.nome ||
      produtoRecebido.termoBusca,

    matchedEan:
      resultado.ean ||
      null,

    itemId:
      resultado.itemId ||
      null,

    sellerId:
      resultado.sellerId ||
      null,

    listPrice:
      Number.isFinite(listPrice) &&
      listPrice > 0
        ? listPrice
        : null,

    image:
      resultado.image ||
      null,

    url:
      resultado.url ||
      null,

    quantity:
      produtoRecebido.quantidade
  };
}

/*
 * CONTROLE DE CONCORRÊNCIA
 *
 * Evita abrir dezenas de pesquisas ao
 * mesmo tempo e sobrecarregar o Jaú Serve,
 * o computador ou o Railway.
 */

async function processarComLimite(
  itens,
  limite,
  processador
) {
  const resultados =
    new Array(itens.length);

  let proximoIndice = 0;

  async function trabalhador() {
    while (true) {
      const indiceAtual =
        proximoIndice;

      proximoIndice += 1;

      if (
        indiceAtual >= itens.length
      ) {
        return;
      }

      try {
        resultados[indiceAtual] =
          await processador(
            itens[indiceAtual],
            indiceAtual
          );
      } catch (erro) {
        console.error(
          `Erro ao processar item ${indiceAtual}:`,
          erro.message
        );

        resultados[indiceAtual] = [];
      }
    }
  }

  const totalTrabalhadores =
    Math.min(
      Math.max(1, limite),
      itens.length
    );

  const trabalhadores =
    Array.from(
      {
        length:
          totalTrabalhadores
      },
      () => trabalhador()
    );

  await Promise.all(
    trabalhadores
  );

  return resultados;
}

/*
 * ROTAS
 */

app.get("/", (req, res) => {
  res.send(
    "Servidor DALE online 🚀"
  );
});

app.get("/health", (req, res) => {
  return res.json({
    online: true,
    service: "dale-precos-api",
    supermarkets:
      obterSupermercadosAtivos()
        .map(
          (supermercado) =>
            supermercado.id
        ),

    cacheEntries:
      cacheConsultas.size,

    date:
      new Date().toISOString()
  });
});

/*
 * TESTE DE UM PRODUTO
 */

app.get(
  "/buscar",
  async (req, res) => {
    const produto =
      req.query.q;

    const ean =
      req.query.ean;

    if (!produto && !ean) {
      return res.status(400).json({
        erro:
          "Produto ou EAN não informado"
      });
    }

    const termoBusca =
      String(produto || ean)
        .replace(/\s+/g, " ")
        .trim();

    try {
      const produtos =
        await buscarEmTodosMercados(
          termoBusca,
          ean
        );

      return res.json({
        produto:
          termoBusca,

        ean:
          ean || null,

        total:
          produtos.length,

        produtos,

        fonte:
          "multi-mercados"
      });
    } catch (erro) {
      console.error(
        "Erro /buscar:",
        erro.message
      );

      return res
        .status(500)
        .json({
          erro: true,
          mensagem:
            erro.message
        });
    }
  }
);

/*
 * BUSCA DE VÁRIOS PRODUTOS
 */

app.post(
  "/prices/batch",
  async (req, res) => {
    const inicio =
      Date.now();

    console.log(
      "POST /prices/batch RECEBIDO"
    );

    try {
      const produtosRecebidos =
        Array.isArray(
          req.body.products
        )
          ? req.body.products
          : [];

      if (
        produtosRecebidos.length === 0
      ) {
        return res.status(400).json({
          erro:
            "Nenhum produto foi informado.",

          exemplo: {
            products: [
              {
                nome:
                  "Feijão Preto Empório São João 1kg",

                ean:
                  "7896086422217"
              }
            ]
          }
        });
      }

      if (
        produtosRecebidos.length >
        LIMITE_PRODUTOS_LOTE
      ) {
        return res.status(400).json({
          erro:
            "Quantidade de produtos acima do limite.",

          quantidadeRecebida:
            produtosRecebidos.length,

          limite:
            LIMITE_PRODUTOS_LOTE
        });
      }

      const produtosNormalizados =
        produtosRecebidos
          .map(
            normalizarProdutoRecebido
          )
          .filter(Boolean);

      if (
        produtosNormalizados.length === 0
      ) {
        return res.status(400).json({
          erro:
            "Nenhum produto válido foi informado."
        });
      }

      console.log(
        `Produtos recebidos: ${produtosNormalizados.length}`
      );

      const resultadosPorProduto =
        await processarComLimite(
          produtosNormalizados,
          CONCORRENCIA_PRODUTOS,

          async (
            produto,
            indice
          ) => {
            console.log(
              `[${indice + 1}/${produtosNormalizados.length}] Buscando:`,
              produto.termoBusca,
              produto.ean
                ? `| EAN: ${produto.ean}`
                : ""
            );

            const resultados =
              await buscarEmTodosMercados(
                produto.termoBusca,
                produto.ean
              );

            return resultados.map(
              (resultado) =>
                formatarResultadoBatch(
                  produto,
                  resultado
                )
            );
          }
        );

      const resultados =
        resultadosPorProduto.flat();

      const duracaoMs =
        Date.now() - inicio;

      console.log(
        "POST /prices/batch FINALIZADO"
      );

      console.log(
        "Produtos pesquisados:",
        produtosNormalizados.length
      );

      console.log(
        "Preços encontrados:",
        resultados.length
      );

      console.log(
        "Tempo total:",
        `${duracaoMs} ms`
      );

      /*
       * Mantemos um ARRAY puro porque esse
       * era o formato que seu Lovable e seu
       * n8n já esperavam anteriormente.
       */
      return res.json(
        resultados
      );
    } catch (erro) {
      console.error(
        "Erro /prices/batch:",
        erro
      );

      return res
        .status(500)
        .json([]);
    }
  }
);

/*
 * LIMPEZA MANUAL DO CACHE
 */

app.delete(
  "/cache",
  (req, res) => {
    const quantidade =
      cacheConsultas.size;

    cacheConsultas.clear();

    return res.json({
      sucesso: true,
      removidos:
        quantidade
    });
  }
);

/*
 * INICIALIZAÇÃO
 */

app.listen(
  PORT,
  () => {
    console.log(
      `Servidor rodando na porta ${PORT} 🚀`
    );

    console.log(
      "Supermercados ativos:",
      obterSupermercadosAtivos()
        .map(
          (supermercado) =>
            supermercado.id
        )
        .join(", ")
    );

    console.log(
      "Limite por lote:",
      LIMITE_PRODUTOS_LOTE
    );

    console.log(
      "Concorrência:",
      CONCORRENCIA_PRODUTOS
    );

    console.log(
      "Tonin ativo:",
      TONIN_ENABLED
    );
  }
);