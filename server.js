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
 * LOGS DE DIAGNÓSTICO
 */

function criarIdentificadorConsulta(
  termoBusca,
  eanBuscado
) {
  const ean =
    eanBuscado
      ? ` | EAN: ${eanBuscado}`
      : "";

  return `${termoBusca}${ean}`;
}

function registrarMemoria(prefixo) {
  const memoria =
    process.memoryUsage();

  const paraMB = (valor) =>
    `${Math.round(valor / 1024 / 1024)} MB`;

  console.log(
    `${prefixo} | MEMÓRIA:`,
    {
      rss: paraMB(memoria.rss),
      heapTotal: paraMB(memoria.heapTotal),
      heapUsed: paraMB(memoria.heapUsed),
      external: paraMB(memoria.external)
    }
  );
}

/*
 * CONSULTA NOS SUPERMERCADOS
 */

async function buscarEmTodosMercados(
  termoBusca,
  eanBuscado
) {
  const identificador =
    criarIdentificadorConsulta(
      termoBusca,
      eanBuscado
    );

  const inicioConsulta =
    Date.now();

  console.log(
    "=================================================="
  );
  console.log(
    "BUSCA MULTIMERCADOS INICIADA:",
    identificador
  );
  registrarMemoria(
    "INÍCIO DA BUSCA MULTIMERCADOS"
  );

  const chaveCache =
    gerarChaveCache(
      termoBusca,
      eanBuscado
    );

  const cache =
    obterDoCache(chaveCache);

  if (cache) {
    console.log(
      `CACHE ENCONTRADO: ${identificador}`
    );

    console.log(
      "RESULTADOS DO CACHE:",
      cache.length
    );

    console.log(
      "BUSCA MULTIMERCADOS FINALIZADA PELO CACHE"
    );

    console.log(
      "=================================================="
    );

    return cache;
  }

  const supermercados =
    obterSupermercadosAtivos();

  console.log(
    "SUPERMERCADOS ATIVOS:",
    supermercados
      .map(
        (supermercado) =>
          supermercado.id
      )
      .join(", ")
  );

  const consultas =
    supermercados.map(
      async (supermercado) => {
        const inicioSupermercado =
          Date.now();

        console.log(
          "--------------------------------------------------"
        );

        console.log(
          `[${supermercado.id}] INICIANDO BUSCA:`,
          identificador
        );

        registrarMemoria(
          `[${supermercado.id}] ANTES DA BUSCA`
        );

        try {
          const resultado =
            await supermercado.buscarProduto(
              termoBusca,
              eanBuscado
            );

          const duracao =
            Date.now() -
            inicioSupermercado;

          console.log(
            `[${supermercado.id}] BUSCA FINALIZADA EM ${duracao} ms`
          );

          console.log(
            `[${supermercado.id}] RESULTADO ENCONTRADO:`,
            Boolean(resultado)
          );

          if (resultado) {
            console.log(
              `[${supermercado.id}] PRODUTO RETORNADO:`,
              {
                supermarketId:
                  resultado.supermarketId,
                productName:
                  resultado.productName,
                ean:
                  resultado.ean,
                price:
                  resultado.price,
                available:
                  resultado.available
              }
            );
          }

          registrarMemoria(
            `[${supermercado.id}] DEPOIS DA BUSCA`
          );

          console.log(
            "--------------------------------------------------"
          );

          return {
            supermercado:
              supermercado.id,

            resultado
          };
        } catch (erro) {
          const duracao =
            Date.now() -
            inicioSupermercado;

          console.error(
            `[${supermercado.id}] ERRO APÓS ${duracao} ms:`,
            erro
          );

          registrarMemoria(
            `[${supermercado.id}] APÓS ERRO`
          );

          console.log(
            "--------------------------------------------------"
          );

          return {
            supermercado:
              supermercado.id,

            resultado: null,

            erro:
              erro?.message ||
              String(erro)
          };
        }
      }
    );

  console.log(
    "AGUARDANDO TODAS AS CONSULTAS COM Promise.allSettled..."
  );

  const respostas =
    await Promise.allSettled(
      consultas
    );

  console.log(
    "TODAS AS CONSULTAS FORAM ENCERRADAS."
  );

  console.log(
    "RESUMO DAS PROMISES:",
    respostas.map(
      (resposta, indice) => ({
        supermercado:
          supermercados[indice]?.id ||
          `indice-${indice}`,

        status:
          resposta.status,

        motivo:
          resposta.status === "rejected"
            ? resposta.reason?.message ||
              String(resposta.reason)
            : null,

        encontrou:
          resposta.status === "fulfilled"
            ? Boolean(
                resposta.value?.resultado
              )
            : false
      })
    )
  );

  const resultados = respostas
    .filter(
      (resposta) =>
        resposta.status === "fulfilled" &&
        resposta.value?.resultado
    )
    .map(
      (resposta) =>
        resposta.value.resultado
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

    console.log(
      "RESULTADOS SALVOS NO CACHE:",
      resultados.length
    );
  } else {
    console.log(
      "NENHUM RESULTADO FOI SALVO NO CACHE."
    );
  }

  const duracaoConsulta =
    Date.now() -
    inicioConsulta;

  console.log(
    "BUSCA MULTIMERCADOS FINALIZADA:",
    identificador
  );

  console.log(
    "TOTAL DE RESULTADOS:",
    resultados.length
  );

  console.log(
    "TEMPO DA BUSCA MULTIMERCADOS:",
    `${duracaoConsulta} ms`
  );

  registrarMemoria(
    "FIM DA BUSCA MULTIMERCADOS"
  );

  console.log(
    "=================================================="
  );

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
 * o computador ou o Render.
 */

async function processarComLimite(
  itens,
  limite,
  processador
) {
  const resultados =
    new Array(itens.length);

  let proximoIndice = 0;

  async function trabalhador(
    numeroTrabalhador
  ) {
    console.log(
      `[TRABALHADOR ${numeroTrabalhador}] INICIADO`
    );

    while (true) {
      const indiceAtual =
        proximoIndice;

      proximoIndice += 1;

      if (
        indiceAtual >= itens.length
      ) {
        console.log(
          `[TRABALHADOR ${numeroTrabalhador}] FINALIZADO`
        );

        return;
      }

      const inicioItem =
        Date.now();

      console.log(
        `[TRABALHADOR ${numeroTrabalhador}] PROCESSANDO ITEM ${indiceAtual + 1}/${itens.length}`
      );

      try {
        resultados[indiceAtual] =
          await processador(
            itens[indiceAtual],
            indiceAtual
          );

        console.log(
          `[TRABALHADOR ${numeroTrabalhador}] ITEM ${indiceAtual + 1} FINALIZADO EM ${Date.now() - inicioItem} ms`
        );
      } catch (erro) {
        console.error(
          `[TRABALHADOR ${numeroTrabalhador}] ERRO NO ITEM ${indiceAtual + 1}:`,
          erro
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

  console.log(
    "TOTAL DE TRABALHADORES:",
    totalTrabalhadores
  );

  const trabalhadores =
    Array.from(
      {
        length:
          totalTrabalhadores
      },
      (_, indice) =>
        trabalhador(indice + 1)
    );

  await Promise.allSettled(
    trabalhadores
  );

  console.log(
    "TODOS OS TRABALHADORES FORAM ENCERRADOS."
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
    const inicio =
      Date.now();

    const produto =
      req.query.q;

    const ean =
      req.query.ean;

    console.log(
      "=================================================="
    );

    console.log(
      "GET /buscar RECEBIDO:",
      {
        produto:
          produto || null,

        ean:
          ean || null
      }
    );

    if (!produto && !ean) {
      console.log(
        "GET /buscar REJEITADO: produto e EAN ausentes."
      );

      console.log(
        "=================================================="
      );

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

      console.log(
        "GET /buscar RESPONDENDO:",
        {
          termoBusca,
          total:
            produtos.length,
          duracaoMs:
            Date.now() - inicio
        }
      );

      console.log(
        "=================================================="
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
        erro
      );

      console.log(
        "=================================================="
      );

      return res
        .status(500)
        .json({
          erro: true,

          mensagem:
            erro?.message ||
            String(erro)
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

    const identificadorRequisicao =
      `${inicio}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    console.log(
      "##################################################"
    );

    console.log(
      `[BATCH ${identificadorRequisicao}] POST /prices/batch RECEBIDO`
    );

    console.log(
      `[BATCH ${identificadorRequisicao}] HORÁRIO:`,
      new Date().toISOString()
    );

    registrarMemoria(
      `[BATCH ${identificadorRequisicao}] INÍCIO`
    );

    try {
      const produtosRecebidos =
        Array.isArray(
          req.body?.products
        )
          ? req.body.products
          : [];

      console.log(
        `[BATCH ${identificadorRequisicao}] PRODUTOS BRUTOS RECEBIDOS:`,
        produtosRecebidos.length
      );

      if (
        produtosRecebidos.length === 0
      ) {
        console.log(
          `[BATCH ${identificadorRequisicao}] REJEITADO: nenhum produto informado.`
        );

        console.log(
          "##################################################"
        );

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
        console.log(
          `[BATCH ${identificadorRequisicao}] REJEITADO: limite excedido.`
        );

        console.log(
          "##################################################"
        );

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
        console.log(
          `[BATCH ${identificadorRequisicao}] REJEITADO: nenhum produto válido.`
        );

        console.log(
          "##################################################"
        );

        return res.status(400).json({
          erro:
            "Nenhum produto válido foi informado."
        });
      }

      console.log(
        `[BATCH ${identificadorRequisicao}] PRODUTOS NORMALIZADOS:`,
        produtosNormalizados.length
      );

      console.log(
        `[BATCH ${identificadorRequisicao}] CONCORRÊNCIA CONFIGURADA:`,
        CONCORRENCIA_PRODUTOS
      );

      const resultadosPorProduto =
        await processarComLimite(
          produtosNormalizados,
          CONCORRENCIA_PRODUTOS,

          async (
            produto,
            indice
          ) => {
            const inicioProduto =
              Date.now();

            console.log(
              `[BATCH ${identificadorRequisicao}] [${indice + 1}/${produtosNormalizados.length}] INICIANDO PRODUTO:`,
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

            console.log(
              `[BATCH ${identificadorRequisicao}] [${indice + 1}/${produtosNormalizados.length}] SUPERMERCADOS COM RESULTADO:`,
              resultados.length
            );

            const resultadosFormatados =
              resultados.map(
                (resultado) =>
                  formatarResultadoBatch(
                    produto,
                    resultado
                  )
              );

            console.log(
              `[BATCH ${identificadorRequisicao}] [${indice + 1}/${produtosNormalizados.length}] PRODUTO FINALIZADO EM ${Date.now() - inicioProduto} ms`
            );

            return resultadosFormatados;
          }
        );

      console.log(
        `[BATCH ${identificadorRequisicao}] PROCESSAMENTO COM LIMITE FINALIZADO.`
      );

      console.log(
        `[BATCH ${identificadorRequisicao}] RESULTADOS POR PRODUTO:`,
        resultadosPorProduto.map(
          (lista, indice) => ({
            indice:
              indice + 1,

            quantidade:
              Array.isArray(lista)
                ? lista.length
                : 0
          })
        )
      );

      const resultados =
        resultadosPorProduto.flat();

      const duracaoMs =
        Date.now() - inicio;

      console.log(
        `[BATCH ${identificadorRequisicao}] ARRAY FINAL MONTADO.`
      );

      console.log(
        `[BATCH ${identificadorRequisicao}] PRODUTOS PESQUISADOS:`,
        produtosNormalizados.length
      );

      console.log(
        `[BATCH ${identificadorRequisicao}] PREÇOS ENCONTRADOS:`,
        resultados.length
      );

      console.log(
        `[BATCH ${identificadorRequisicao}] TEMPO TOTAL:`,
        `${duracaoMs} ms`
      );

      registrarMemoria(
        `[BATCH ${identificadorRequisicao}] ANTES DO res.json`
      );

      console.log(
        `[BATCH ${identificadorRequisicao}] RETORNANDO AO LOVABLE...`
      );

      /*
       * Mantemos um ARRAY puro porque esse
       * era o formato que seu Lovable e seu
       * n8n já esperavam anteriormente.
       */

      res.once(
        "finish",
        () => {
          console.log(
            `[BATCH ${identificadorRequisicao}] RESPOSTA FINALIZADA PELO EXPRESS. STATUS:`,
            res.statusCode
          );

          console.log(
            `[BATCH ${identificadorRequisicao}] DURAÇÃO COMPLETA:`,
            `${Date.now() - inicio} ms`
          );

          registrarMemoria(
            `[BATCH ${identificadorRequisicao}] APÓS finish`
          );

          console.log(
            "##################################################"
          );
        }
      );

      res.once(
        "close",
        () => {
          console.log(
            `[BATCH ${identificadorRequisicao}] CONEXÃO HTTP FECHADA. headersSent:`,
            res.headersSent
          );
        }
      );

      return res.json(
        resultados
      );
    } catch (erro) {
      console.error(
        `[BATCH ${identificadorRequisicao}] ERRO /prices/batch:`,
        erro
      );

      registrarMemoria(
        `[BATCH ${identificadorRequisicao}] APÓS ERRO`
      );

      console.log(
        "##################################################"
      );

      if (res.headersSent) {
        return;
      }

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
 * DIAGNÓSTICO DO PROCESSO
 */

process.on(
  "uncaughtException",
  (erro) => {
    console.error(
      "========== UNCAUGHT EXCEPTION =========="
    );

    console.error(erro);

    registrarMemoria(
      "UNCAUGHT EXCEPTION"
    );

    console.error(
      "========================================"
    );
  }
);

process.on(
  "unhandledRejection",
  (motivo) => {
    console.error(
      "========== UNHANDLED REJECTION =========="
    );

    console.error(motivo);

    registrarMemoria(
      "UNHANDLED REJECTION"
    );

    console.error(
      "========================================="
    );
  }
);

process.once(
  "SIGTERM",
  () => {
    console.log(
      "========== PROCESSO RECEBEU SIGTERM =========="
    );

    registrarMemoria(
      "SIGTERM"
    );

    console.log(
      "Render ou sistema operacional solicitou o encerramento."
    );

    console.log(
      "=============================================="
    );
  }
);

process.once(
  "SIGINT",
  () => {
    console.log(
      "========== PROCESSO RECEBEU SIGINT =========="
    );

    registrarMemoria(
      "SIGINT"
    );

    console.log(
      "============================================="
    );
  }
);

process.once(
  "exit",
  (codigo) => {
    console.log(
      "========== PROCESSO NODE ENCERRADO =========="
    );

    console.log(
      "Código de saída:",
      codigo
    );

    console.log(
      "============================================"
    );
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

    registrarMemoria(
      "INICIALIZAÇÃO DO SERVIDOR"
    );
  }
);
