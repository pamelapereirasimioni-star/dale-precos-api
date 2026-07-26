const { chromium } = require("playwright");
const cheerio = require("cheerio");

const { calcularPontuacao } = require("../core/score");
const { escolherMelhorProduto } = require("../core/escolhedor");
const { criarProduto } = require("../core/produto");

const BASE_URL = "https://www.jauserve.com.br";

const HOME_URL =
  `${BASE_URL}/on/demandware.store/` +
  `Sites-JauServe-Site/pt_BR/Home-Show`;

const SUGGESTIONS_URL =
  `${BASE_URL}/on/demandware.store/` +
  `Sites-JauServe-Site/pt_BR/SearchServices-GetSuggestions`;

const CIDADE =
  process.env.JAUSERVE_CIDADE || "Ribeirão Preto";

let browser = null;
let contexto = null;
let pagina = null;
let sessaoPreparada = false;

let filaPesquisas = Promise.resolve();

function executarExclusivo(tarefa) {
  const execucao = filaPesquisas.then(tarefa, tarefa);

  filaPesquisas = execucao.catch(() => {});

  return execucao;
}

function prepararTermosBusca(termoBusca) {
  const original = String(termoBusca || "")
    .replace(/\s+/g, " ")
    .trim();

  const semQuantidade = original
    .replace(
      /\b\d+(?:[.,]\d+)?\s*(kg|g|mg|ml|l|un|und|unidade|unidades)\b/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();

  return [...new Set([original, semQuantidade].filter(Boolean))];
}

async function fecharSessao() {
  sessaoPreparada = false;

  if (pagina) {
    await pagina.close().catch(() => {});
  }

  if (contexto) {
    await contexto.close().catch(() => {});
  }

  if (browser) {
    await browser.close().catch(() => {});
  }

  pagina = null;
  contexto = null;
  browser = null;
}

async function iniciarSessao() {
  if (
    browser &&
    browser.isConnected() &&
    contexto &&
    pagina &&
    !pagina.isClosed()
  ) {
    return;
  }

  await fecharSessao();

  console.log("========== DEBUG PLAYWRIGHT JAÚ SERVE ==========");
  console.log("Versão do Node:", process.version);
  console.log("PLAYWRIGHT_BROWSERS_PATH:", process.env.PLAYWRIGHT_BROWSERS_PATH || "não definida");
  console.log("HOME:", process.env.HOME || "não definido");
  console.log("Chromium executablePath esperado:", chromium.executablePath());
  console.log("================================================");

  browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-sandbox"
    ]
  });

  contexto = await browser.newContext({
    locale: "pt-BR",

    viewport: {
      width: 1366,
      height: 900
    },

    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/150.0.0.0 Safari/537.36",

    extraHTTPHeaders: {
      Accept:
        "text/html,application/xhtml+xml,application/xml;" +
        "q=0.9,image/avif,image/webp,*/*;q=0.8",

      "Accept-Language":
        "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
    }
  });

  pagina = await contexto.newPage();

  pagina.setDefaultTimeout(20000);
  pagina.setDefaultNavigationTimeout(60000);

  pagina.on("pageerror", (erro) => {
    console.log(
      "Erro da página Jaú Serve:",
      erro.message
    );
  });

  sessaoPreparada = false;
}

async function abrirHome() {
  await iniciarSessao();

  for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
    try {
      await pagina.goto(HOME_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      return;
    } catch (erro) {
      console.log(
        `Jaú Serve: erro ao abrir o site, tentativa ${tentativa}:`,
        erro.message
      );

      if (tentativa === 2) {
        throw erro;
      }

      await fecharSessao();
      await iniciarSessao();
    }
  }
}

async function abrirPopupLoja() {
  await pagina.waitForTimeout(1500);

  const popup = pagina.locator("#popUpCep").first();

  const existe = await popup
    .count()
    .then((total) => total > 0)
    .catch(() => false);

  if (!existe) {
    throw new Error("Popup #popUpCep não foi encontrado");
  }

  await pagina.evaluate(() => {
    if (window.jQuery) {
      window.jQuery(document).trigger("app:openCepModal");
      window.jQuery("#popUpCep").modal("show");
    }
  });

  await pagina.waitForTimeout(1500);
}

async function carregarCidades() {
  const seletorCidade = pagina
    .locator("#popUpCep #storesCities")
    .first();

  await seletorCidade.waitFor({
    state: "attached",
    timeout: 20000
  });

  await pagina.waitForFunction(
    (cidade) => {
      const select = document.querySelector(
        "#popUpCep #storesCities"
      );

      if (!select) {
        return false;
      }

      return Array.from(select.options).some(
        (opcao) =>
          String(opcao.textContent || "")
            .replace(/\s+/g, " ")
            .trim() === cidade
      );
    },
    CIDADE,
    {
      timeout: 20000
    }
  );

  return seletorCidade;
}

async function selecionarCidade() {
  const seletorCidade = await carregarCidades();

  await seletorCidade.selectOption({
    label: CIDADE
  });

  console.log(
    `Jaú Serve: cidade selecionada — ${CIDADE}.`
  );

  const radiosLojas = pagina.locator(
    '#popUpCep [name="popUpCep__storeInput"]'
  );

  await radiosLojas.first().waitFor({
    state: "attached",
    timeout: 20000
  });

  const total = await radiosLojas.count();

  if (total === 0) {
    throw new Error(
      `Nenhuma loja encontrada em ${CIDADE}`
    );
  }

  console.log(
    `Jaú Serve: ${total} loja(s) encontrada(s).`
  );

  return radiosLojas;
}

async function registrarPrimeiraLoja(radiosLojas) {
  const primeiraLoja = radiosLojas.first();

  const valor = await primeiraLoja.getAttribute("value");
  const dataUrl = await primeiraLoja.getAttribute("data-url");

  if (!valor) {
    throw new Error(
      "O valor da primeira loja não foi encontrado"
    );
  }

  if (!dataUrl) {
    throw new Error(
      "O endereço data-url da primeira loja não foi encontrado"
    );
  }

  console.log(
    "Jaú Serve: registrando a primeira loja. Valor:",
    valor
  );

  const resultado = await pagina.evaluate(
    async ({ valorLoja, enderecoLoja }) => {
      try {
        const urlLoja = new URL(
          enderecoLoja,
          window.location.origin
        );

        urlLoja.searchParams.set(
          "postcode",
          valorLoja
        );

        const respostaLoja = await fetch(
          urlLoja.toString(),
          {
            method: "GET",
            credentials: "include",
            headers: {
              Accept: "application/json, text/javascript, */*; q=0.01",
              "X-Requested-With": "XMLHttpRequest"
            }
          }
        );

        const textoLoja = await respostaLoja.text();

        let dadosLoja = null;

        try {
          dadosLoja = JSON.parse(textoLoja);
        } catch {
          dadosLoja = {
            resposta: textoLoja
          };
        }

        const urlMetodo =
          window.Urls?.selectShippingMethods;

        if (!urlMetodo) {
          return {
            ok: false,
            etapa: "metodo",
            mensagem:
              "window.Urls.selectShippingMethods não foi encontrado",
            statusLoja: respostaLoja.status,
            dadosLoja
          };
        }

        const respostaMetodo = await fetch(
          new URL(
            urlMetodo,
            window.location.origin
          ).toString(),
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded; charset=UTF-8",

              Accept:
                "application/json, text/javascript, */*; q=0.01",

              "X-Requested-With":
                "XMLHttpRequest"
            },

            body: new URLSearchParams({
              methodID: "7024"
            }).toString()
          }
        );

        const textoMetodo =
          await respostaMetodo.text();

        return {
          ok:
            respostaLoja.ok &&
            respostaMetodo.ok,

          statusLoja:
            respostaLoja.status,

          statusMetodo:
            respostaMetodo.status,

          dadosLoja,

          respostaMetodo:
            textoMetodo
        };
      } catch (erro) {
        return {
          ok: false,
          mensagem: erro.message
        };
      }
    },
    {
      valorLoja: valor,
      enderecoLoja: dataUrl
    }
  );

  console.log(
    "Jaú Serve: resultado da configuração:",
    resultado
  );

  if (!resultado.ok) {
    throw new Error(
      `Não foi possível registrar a loja: ${
        resultado.mensagem ||
        JSON.stringify(resultado)
      }`
    );
  }

  await pagina.reload({
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await pagina.waitForTimeout(2500);

  sessaoPreparada = true;

  console.log(
    "Jaú Serve: loja e retirada configuradas com sucesso."
  );
}

async function configurarLoja() {
  if (sessaoPreparada) {
    return;
  }

  await abrirPopupLoja();

  const radiosLojas =
    await selecionarCidade();

  await registrarPrimeiraLoja(
    radiosLojas
  );
}

async function prepararSessao() {
  await abrirHome();

  if (!sessaoPreparada) {
    await configurarLoja();
  }
}

async function consultarSugestoes(termo) {
  await prepararSessao();

  const resultado = await pagina.evaluate(
    async ({ endpoint, termoBusca }) => {
      try {
        const url = new URL(endpoint);

        url.searchParams.set(
          "q",
          termoBusca
        );

        const resposta = await fetch(
          url.toString(),
          {
            method: "GET",

            credentials: "include",

            headers: {
              Accept:
                "text/html, */*; q=0.01",

              "X-Requested-With":
                "XMLHttpRequest"
            }
          }
        );

        return {
          ok: resposta.ok,
          status: resposta.status,
          url: resposta.url,
          html: await resposta.text()
        };
      } catch (erro) {
        return {
          ok: false,
          status: 0,
          url: "",
          html: "",
          erro: erro.message
        };
      }
    },
    {
      endpoint: SUGGESTIONS_URL,
      termoBusca: termo
    }
  );

  console.log(
    "Jaú Serve endpoint:",
    resultado.status,
    resultado.url
  );

  console.log(
    "Jaú Serve tamanho do HTML:",
    resultado.html?.length || 0
  );

  console.log(
    "Jaú Serve contém grid-tile:",
    Boolean(
      resultado.html?.includes(
        "grid-tile"
      )
    )
  );

  if (!resultado.ok) {
    console.log(
      "Falha no endpoint do Jaú Serve:",
      resultado.erro ||
      resultado.status
    );

    return "";
  }

  return resultado.html;
}

function converterPreco(texto) {
  const valor = Number(
    String(texto || "")
      .replace("R$", "")
      .replace(/\s+/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
  );

  return Number.isFinite(valor)
    ? valor
    : null;
}

function extrairProdutos(html) {
  if (!html) {
    return [];
  }

  const $ = cheerio.load(html);
  const produtos = [];

  $(".grid-tile").each((_, elemento) => {
    const card = $(elemento);

    const ean =
      card.attr("data-pid") ||
      card
        .find(".product-tile")
        .attr("data-itemid") ||
      null;

    const nomeLink = card
      .find(".pdp-link a")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();

    const nomeImagem = card
      .find("img.tile-image")
      .first()
      .attr("alt")
      ?.replace(/\s+/g, " ")
      .trim();

    const productName =
      nomeLink ||
      nomeImagem ||
      "";

    const priceContent = card
      .find(".price .sales .value")
      .first()
      .attr("content");

    const priceText = card
      .find(".price .sales .value")
      .first()
      .text();

    let price = Number(priceContent);

    if (
      !Number.isFinite(price) ||
      price <= 0
    ) {
      price = converterPreco(
        priceText
      );
    }

    const listPriceContent = card
      .find(".strike-through .value")
      .first()
      .attr("content");

    const listPriceText = card
      .find(".strike-through .value")
      .first()
      .text();

    let listPrice =
      Number(listPriceContent);

    if (
      !Number.isFinite(listPrice) ||
      listPrice <= 0
    ) {
      listPrice = converterPreco(
        listPriceText
      );
    }

    const image =
      card
        .find("img.tile-image")
        .first()
        .attr("src") ||
      null;

    const href =
      card
        .find("a.tile-image-container")
        .first()
        .attr("href") ||
      card
        .find(".pdp-link a")
        .first()
        .attr("href") ||
      null;

    if (
      !productName ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      return;
    }

    produtos.push({
      productName,
      productTitle: productName,

      items: [
        {
          ean,
          itemId: ean,

          images: [
            {
              imageUrl: image
            }
          ],

          sellers: [
            {
              sellerId: "jauserve",
              sellerDefault: true,

              commertialOffer: {
                Price: price,

                ListPrice:
                  Number.isFinite(
                    listPrice
                  ) &&
                  listPrice > 0
                    ? listPrice
                    : price,

                IsAvailable: true
              }
            }
          ]
        }
      ],

      link: href
        ? new URL(
            href,
            BASE_URL
          ).toString()
        : null
    });
  });

  return produtos;
}

function removerDuplicados(produtos) {
  const identificadores =
    new Set();

  return produtos.filter(
    (produto) => {
      const ean = String(
        produto.items?.[0]?.ean ||
        ""
      );

      const identificador =
        ean ||
        String(
          produto.productName || ""
        )
          .toLowerCase()
          .trim();

      if (
        identificadores.has(
          identificador
        )
      ) {
        return false;
      }

      identificadores.add(
        identificador
      );

      return true;
    }
  );
}

async function pesquisarNoSite(termo) {
  try {
    const html =
      await consultarSugestoes(termo);

    const produtos =
      extrairProdutos(html);

    console.log(
      "Jaú Serve termo:",
      termo
    );

    console.log(
      "Produtos encontrados no Jaú Serve:",
      produtos.map(
        (produto) =>
          produto.productName
      )
    );

    return produtos;
  } catch (erro) {
    console.error(
      "Erro na pesquisa do Jaú Serve:",
      erro.message
    );

    if (
      erro.message.includes(
        "ERR_CONNECTION_CLOSED"
      ) ||
      erro.message.includes(
        "Target page"
      ) ||
      erro.message.includes(
        "has been closed"
      )
    ) {
      await fecharSessao();
    }

    return [];
  }
}

async function buscarProdutoInterno(
  termoBusca,
  eanBuscado
) {
  const termos =
    prepararTermosBusca(
      termoBusca
    );

  let produtos = [];

  for (const termo of termos) {
    const encontrados =
      await pesquisarNoSite(
        termo
      );

    produtos.push(
      ...encontrados
    );

    if (
      encontrados.length > 0
    ) {
      break;
    }
  }

  produtos =
    removerDuplicados(produtos);

  if (produtos.length === 0) {
    console.log("========== DEBUG JAÚ SERVE: SEM PRODUTOS ==========");
    console.log("Termo buscado:", termoBusca);
    console.log("EAN buscado:", eanBuscado || null);
    console.log("Termos tentados:", termos);
    console.log("====================================================");
    return null;
  }

  console.log("========== DEBUG JAÚ SERVE: PRODUTOS EXTRAÍDOS ==========");
  console.log("Termo buscado:", termoBusca);
  console.log("EAN buscado:", eanBuscado || null);
  console.log("Quantidade de produtos após remover duplicados:", produtos.length);
  console.dir(produtos, { depth: 8 });
  console.log("=========================================================");

  const melhor =
    escolherMelhorProduto(
      produtos,
      calcularPontuacao,
      termoBusca,
      eanBuscado
    );

  if (!melhor) {
    console.log("========== DEBUG JAÚ SERVE: MELHOR NÃO ESCOLHIDO ==========");
    console.log("Termo buscado:", termoBusca);
    console.log("EAN buscado:", eanBuscado || null);
    console.log("Quantidade de candidatos:", produtos.length);
    console.dir(produtos, { depth: 8 });
    console.log("============================================================");
    return null;
  }

  console.log("========== DEBUG JAÚ SERVE: MELHOR PRODUTO ==========");
  console.dir(melhor, { depth: 10 });
  console.log("=====================================================");

  const item =
    melhor.items?.[0];

  const seller =
    item?.sellers?.find(
      (registro) =>
        registro.sellerDefault
    ) ||
    item?.sellers?.[0];

  const oferta =
    seller?.commertialOffer;

  console.log("========== DEBUG JAÚ SERVE: ESTRUTURA FINAL ==========");
  console.log("Item encontrado:", Boolean(item));
  console.dir(item, { depth: 8 });
  console.log("Seller encontrado:", Boolean(seller));
  console.dir(seller, { depth: 8 });
  console.log("Oferta encontrada:", Boolean(oferta));
  console.dir(oferta, { depth: 8 });
  console.log("=======================================================");

  if (
    !item ||
    !seller ||
    !oferta
  ) {
    console.log("Jaú Serve: retorno nulo porque item, seller ou oferta não foi encontrado.");
    return null;
  }

  const produtoCriado = criarProduto({
    supermarketId: "jauserve",
    productName:
      melhor.productName,

    ean: item.ean,
    itemId: item.itemId,

    sellerId:
      seller.sellerId,

    price:
      oferta.Price,

    listPrice:
      oferta.ListPrice,

    available:
      oferta.IsAvailable === true,

    image:
      item.images?.[0]
        ?.imageUrl ||
      null,

    url:
      melhor.link
  });

  console.log("========== DEBUG JAÚ SERVE: PRODUTO CRIADO ==========");
  console.dir(produtoCriado, { depth: 8 });
  console.log("======================================================");

  return produtoCriado;
}

async function buscarProduto(
  termoBusca,
  eanBuscado
) {
  return executarExclusivo(
    () =>
      buscarProdutoInterno(
        termoBusca,
        eanBuscado
      )
  );
}

async function encerrar() {
  await fecharSessao();
}

process.once(
  "SIGINT",
  async () => {
    await encerrar();
    process.exit(0);
  }
);

process.once(
  "SIGTERM",
  async () => {
    await encerrar();
    process.exit(0);
  }
);

module.exports = {
  buscarProduto,
  encerrar
};
