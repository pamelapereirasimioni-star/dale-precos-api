require("dotenv").config();

const express = require("express");
const cors = require("cors");

const { limparNomeBusca } = require("./utils/texto");

const {
  buscarProduto: buscarSavegnago
} = require("./supermercados/savegnago");

const {
  buscarProduto: buscarJauServe,
  encerrar: encerrarJauServe
} = require("./supermercados/jauserve");

const {
  buscarProduto: buscarTonin
} = require("./supermercados/tonin");

const app = express();

/*
 * CONFIGURAÇÕES
 */

const PORT = Number(process.env.PORT) || 3000;

const LIMITE_PRODUTOS_LOTE =
  Number(process.env.LIMITE_PRODUTOS_LOTE) || 100;

/*
 * Para uma instância de 512 MB, o padrão seguro é 1.
 * O valor ainda pode ser alterado no Render pela variável
 * CONCORRENCIA_PRODUTOS, mas nunca será inferior a 1.
 */
const CONCORRENCIA_PRODUTOS = Math.max(
  1,
  Number(process.env.CONCORRENCIA_PRODUTOS) || 1
);

const CACHE_TTL_MS =
  Number(process.env.CACHE_TTL_MS) ||
  5 * 60 * 1000;

const CACHE_MAX_ENTRIES = Math.max(
  10,
  Number(process.env.CACHE_MAX_ENTRIES) || 100
);

const TONIN_ENABLED =
  String(
    process.env.TONIN_ENABLED || "false"
  ).toLowerCase() === "true";

const LOG_DETALHADO =
  String(
    process.env.LOG_DETALHADO || "false"
  ).toLowerCase() === "true";

/*
 * MIDDLEWARES
 */

app.use(cors());
app.options("*", cors());

app.use(
  express.json({
    limit: "1mb"
  })
);

/*
 * UTILITÁRIOS
 */

function paraMB(valor) {
  return `${Math.round(valor / 1024 / 1024)} MB`;
}

function registrarMemoria(prefixo) {
  const memoria = process.memoryUsage();

  console.log(`${prefixo} | MEMÓRIA:`, {
    rss: paraMB(memoria.rss),
    heapUsed: paraMB(memoria.heapUsed),
    external: paraMB(memoria.external)
  });
}

function logDetalhado(...argumentos) {
  if (LOG_DETALHADO) {
    console.log(...argumentos);
  }
}

function normalizarCep(cep) {
  const somenteDigitos =
    String(cep || "").replace(/\D/g, "");

  return somenteDigitos.length === 8
    ? somenteDigitos
    : null;
}


function criarIdentificadorConsulta(
  termoBusca,
  eanBuscado
) {
  return eanBuscado
    ? `${termoBusca} | EAN: ${eanBuscado}`
    : termoBusca;
}

/*
 * FILA GLOBAL
 *
 * Impede que duas buscas pesadas sejam executadas
 * simultaneamente na mesma instância de 512 MB.
 */

let filaRequisicoesPesadas = Promise.resolve();

function executarRequisicaoPesada(tarefa) {
  const execucao =
    filaRequisicoesPesadas.then(tarefa, tarefa);

  filaRequisicoesPesadas =
    execucao.catch(() => {});

  return execucao;
}

/*
 * CACHE EM MEMÓRIA COM LIMITE
 */

const cacheConsultas = new Map();

function gerarChaveCache(
  termoBusca,
  eanBuscado,
  cep
) {
  return [
    limparNomeBusca(termoBusca || ""),
    String(eanBuscado || "").trim(),
    String(cep || "").trim()
  ].join("|");
}

function removerEntradaMaisAntigaCache() {
  const primeiraChave =
    cacheConsultas.keys().next().value;

  if (primeiraChave !== undefined) {
    cacheConsultas.delete(primeiraChave);
  }
}

function obterDoCache(chave) {
  const registro = cacheConsultas.get(chave);

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

  /*
   * Atualiza a posição para comportamento LRU simples.
   */
  cacheConsultas.delete(chave);
  cacheConsultas.set(chave, registro);

  return registro.resultados;
}

function salvarNoCache(
  chave,
  resultados
) {
  if (
    !Array.isArray(resultados) ||
    resultados.length === 0
  ) {
    return;
  }

  if (cacheConsultas.has(chave)) {
    cacheConsultas.delete(chave);
  }

  while (
    cacheConsultas.size >=
    CACHE_MAX_ENTRIES
  ) {
    removerEntradaMaisAntigaCache();
  }

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
    if (
      agora - registro.criadoEm >
      CACHE_TTL_MS
    ) {
      cacheConsultas.delete(chave);
    }
  }
}

const intervaloLimpezaCache = setInterval(
  limparCacheExpirado,
  2 * 60 * 1000
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
 * NORMALIZAÇÃO DOS PRODUTOS
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

  const quantidadeInformada =
    Number(produto.quantidade) ||
    Number(produto.quantity) ||
    1;

  /*
   * Não guardamos o objeto original inteiro.
   * Isso evita manter a requisição completa duplicada na memória.
   */
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
      Number.isFinite(quantidadeInformada) &&
      quantidadeInformada > 0
        ? quantidadeInformada
        : 1
  };
}

/*
 * CONSULTA NOS SUPERMERCADOS
 *
 * As consultas são sequenciais por padrão.
 * Isso evita manter dois navegadores pesados ativos
 * simultaneamente na instância de 512 MB.
 */

async function buscarEmTodosMercados(
  termoBusca,
  eanBuscado,
  cep
) {
  const identificador =
    criarIdentificadorConsulta(
      termoBusca,
      eanBuscado
    );

  const inicioConsulta = Date.now();

  const chaveCache =
    gerarChaveCache(
      termoBusca,
      eanBuscado,
      cep
    );

  const cache = obterDoCache(chaveCache);

  if (cache) {
    console.log(
      `CACHE ENCONTRADO: ${identificador} (${cache.length} resultado(s))`
    );

    return cache;
  }

  const supermercados =
    obterSupermercadosAtivos();

  const resultados = [];

  console.log(
    `BUSCA INICIADA: ${identificador}`
  );

  for (const supermercado of supermercados) {
    const inicioSupermercado = Date.now();

    try {
      const resultado =
        await supermercado.buscarProduto(
          termoBusca,
          eanBuscado,
          cep
        );

      const duracao =
        Date.now() - inicioSupermercado;

      console.log(
        `[${supermercado.id}] finalizado em ${duracao} ms | encontrado: ${Boolean(resultado)}`
      );

      if (resultado) {
        resultados.push(resultado);

        logDetalhado(
          `[${supermercado.id}]`,
          {
            productName:
              resultado.productName,
            ean:
              resultado.ean,
            price:
              resultado.price
          }
        );
      }
    } catch (erro) {
      console.error(
        `[${supermercado.id}] erro:`,
        erro?.message || String(erro)
      );
    }
  }

  if (resultados.length > 0) {
    salvarNoCache(
      chaveCache,
      resultados
    );
  }

  console.log(
    `BUSCA FINALIZADA: ${identificador} | resultados: ${resultados.length} | tempo: ${Date.now() - inicioConsulta} ms`
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
  const price = Number(resultado.price);
  const listPrice =
    Number(resultado.listPrice);

  return {
    ean:
      produtoRecebido.ean ||
      resultado.ean ||
      null,

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
 * PROCESSAMENTO COM LIMITE
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
      const indiceAtual = proximoIndice;
      proximoIndice += 1;

      if (indiceAtual >= itens.length) {
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
          `Erro no item ${indiceAtual + 1}:`,
          erro?.message || String(erro)
        );

        resultados[indiceAtual] = [];
      }
    }
  }

  const totalTrabalhadores = Math.min(
    Math.max(1, limite),
    itens.length
  );

  const trabalhadores = [];

  for (
    let indice = 0;
    indice < totalTrabalhadores;
    indice += 1
  ) {
    trabalhadores.push(trabalhador());
  }

  await Promise.all(trabalhadores);

  return resultados;
}

/*
 * LIMPEZA DO PLAYWRIGHT
 */

async function liberarRecursosPesados(
  motivo
) {
  try {
    await encerrarJauServe();

    console.log(
      `Jaú Serve encerrado: ${motivo}`
    );
  } catch (erro) {
    console.error(
      "Erro ao encerrar Jaú Serve:",
      erro?.message || String(erro)
    );
  }
}

/*
 * ROTAS
 */

app.get("/", (req, res) => {
  res.send("Servidor DALE online 🚀");
});

app.get("/health", (req, res) => {
  const memoria = process.memoryUsage();

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

    memory: {
      rss: paraMB(memoria.rss),
      heapUsed:
        paraMB(memoria.heapUsed)
    },

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
    const produto = req.query.q;
    const ean = req.query.ean;
    const cep = normalizarCep(req.query.cep);

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

    return executarRequisicaoPesada(
      async () => {
        const inicio = Date.now();

        try {
          const produtos =
            await buscarEmTodosMercados(
              termoBusca,
              ean,
              cep
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
            erro?.message || String(erro)
          );

          return res
            .status(500)
            .json({
              erro: true,
              mensagem:
                erro?.message ||
                String(erro)
            });
        } finally {
          console.log(
            `GET /buscar finalizado em ${Date.now() - inicio} ms`
          );

          await liberarRecursosPesados(
            "fim de /buscar"
          );
        }
      }
    );
  }
);

/*
 * BUSCA DE VÁRIOS PRODUTOS
 */

app.post(
  "/prices/batch",
  async (req, res) => {
    const inicio = Date.now();

    const identificadorRequisicao =
      `${inicio}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    return executarRequisicaoPesada(
      async () => {
        console.log(
          `##################################################`
        );
        console.log(
          `[BATCH ${identificadorRequisicao}] recebido`
        );

        registrarMemoria(
          `[BATCH ${identificadorRequisicao}] início`
        );

        try {
          const cep =
            normalizarCep(
              req.body?.cep ||
              req.body?.postalCode
            );

          console.log(
            `[BATCH ${identificadorRequisicao}] CEP:`,
            cep || "não informado"
          );

          const produtosRecebidos =
            Array.isArray(
              req.body?.products
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
                cep: "14096350",
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

          const produtosNormalizados = [];

          for (
            let indice = 0;
            indice < produtosRecebidos.length;
            indice += 1
          ) {
            const produtoNormalizado =
              normalizarProdutoRecebido(
                produtosRecebidos[indice],
                indice
              );

            if (produtoNormalizado) {
              produtosNormalizados.push(
                produtoNormalizado
              );
            }
          }

          if (
            produtosNormalizados.length === 0
          ) {
            return res.status(400).json({
              erro:
                "Nenhum produto válido foi informado."
            });
          }

          console.log(
            `[BATCH ${identificadorRequisicao}] produtos: ${produtosNormalizados.length} | concorrência: ${CONCORRENCIA_PRODUTOS}`
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
                  `[BATCH ${identificadorRequisicao}] ${indice + 1}/${produtosNormalizados.length}: ${produto.termoBusca}`
                );

                const encontrados =
                  await buscarEmTodosMercados(
                    produto.termoBusca,
                    produto.ean,
                    cep
                  );

                const formatados = [];

                for (
                  const resultado
                  of encontrados
                ) {
                  formatados.push(
                    formatarResultadoBatch(
                      produto,
                      resultado
                    )
                  );
                }

                console.log(
                  `[BATCH ${identificadorRequisicao}] item ${indice + 1} concluído em ${Date.now() - inicioProduto} ms`
                );

                return formatados;
              }
            );

          /*
           * Monta o array final em uma única passagem,
           * evitando Array.flat(), que cria outra cópia
           * completa dos resultados.
           */
          const resultados = [];

          for (
            const lista
            of resultadosPorProduto
          ) {
            if (!Array.isArray(lista)) {
              continue;
            }

            for (
              const resultado
              of lista
            ) {
              resultados.push(resultado);
            }
          }

          console.log(
            `[BATCH ${identificadorRequisicao}] finalizado | produtos: ${produtosNormalizados.length} | preços: ${resultados.length} | tempo: ${Date.now() - inicio} ms`
          );

          registrarMemoria(
            `[BATCH ${identificadorRequisicao}] antes da resposta`
          );

          return res.json(resultados);
        } catch (erro) {
          console.error(
            `[BATCH ${identificadorRequisicao}] erro:`,
            erro?.message || String(erro)
          );

          if (res.headersSent) {
            return;
          }

          return res
            .status(500)
            .json([]);
        } finally {
          await liberarRecursosPesados(
            `fim do batch ${identificadorRequisicao}`
          );

          registrarMemoria(
            `[BATCH ${identificadorRequisicao}] após limpeza`
          );

          console.log(
            "##################################################"
          );
        }
      }
    );
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
      removidos: quantidade
    });
  }
);

/*
 * ERROS DO PROCESSO
 */

process.on(
  "uncaughtException",
  (erro) => {
    console.error(
      "UNCAUGHT EXCEPTION:",
      erro
    );

    registrarMemoria(
      "UNCAUGHT EXCEPTION"
    );
  }
);

process.on(
  "unhandledRejection",
  (motivo) => {
    console.error(
      "UNHANDLED REJECTION:",
      motivo
    );

    registrarMemoria(
      "UNHANDLED REJECTION"
    );
  }
);

async function encerrarAplicacao(
  sinal
) {
  console.log(
    `Processo recebeu ${sinal}.`
  );

  clearInterval(
    intervaloLimpezaCache
  );

  cacheConsultas.clear();

  await liberarRecursosPesados(
    sinal
  );
}

process.once(
  "SIGTERM",
  () => {
    encerrarAplicacao("SIGTERM")
      .finally(() => process.exit(0));
  }
);

process.once(
  "SIGINT",
  () => {
    encerrarAplicacao("SIGINT")
      .finally(() => process.exit(0));
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
      "Concorrência de produtos:",
      CONCORRENCIA_PRODUTOS
    );

    console.log(
      "Cache máximo:",
      CACHE_MAX_ENTRIES
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
