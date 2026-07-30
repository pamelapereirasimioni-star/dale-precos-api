/*
 * JAÚ SERVE — PERFORMANCE + CONTROLE DE MEMÓRIA
 *
 * Objetivos desta versão:
 * 1. Manter apenas um Chromium ativo por vez.
 * 2. Serializar todas as pesquisas do Jaú Serve.
 * 3. Bloquear imagens, fontes e mídia no navegador.
 * 4. Usar BrowserContext.request nas consultas de produtos, evitando
 *    executar fetch dentro da página para cada item.
 * 5. Reciclar o Chromium após algumas pesquisas para impedir crescimento
 *    progressivo de memória na instância de 512 MB do Render.
 * 6. Fechar automaticamente a sessão após período de inatividade.
 * 7. Evitar logs gigantes com HTML e objetos completos.
 */

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
}

const { chromium } = require("playwright");
const cheerio = require("cheerio");

const { calcularPontuacao } = require("../core/score");
const { escolherMelhorProduto } = require("../core/escolhedor");
const { criarProduto } = require("../core/produto");

const BASE_URL = "https://www.jauserve.com.br";

const HOME_URL =
  `${BASE_URL}/on/demandware.store/` +
  "Sites-JauServe-Site/pt_BR/Home-Show";

const SUGGESTIONS_URL =
  `${BASE_URL}/on/demandware.store/` +
  "Sites-JauServe-Site/pt_BR/SearchServices-GetSuggestions";

const CIDADE = process.env.JAUSERVE_CIDADE || "Ribeirão Preto";

/*
 * Em uma instância de 512 MB, reciclar o navegador frequentemente é mais
 * seguro. O valor padrão 2 permite reaproveitamento dentro do lote sem
 * manter o Chromium crescendo durante listas grandes.
 */
const MAX_PESQUISAS_POR_SESSAO = Math.max(
  1,
  Number(process.env.JAUSERVE_MAX_PESQUISAS_SESSAO || 2)
);

const TEMPO_FECHAMENTO_OCIOSO_MS = Math.max(
  5000,
  Number(process.env.JAUSERVE_IDLE_TIMEOUT_MS || 30000)
);

const TIMEOUT_NAVEGACAO_MS = Math.max(
  15000,
  Number(process.env.JAUSERVE_NAVIGATION_TIMEOUT_MS || 45000)
);

const TIMEOUT_REQUISICAO_MS = Math.max(
  8000,
  Number(process.env.JAUSERVE_REQUEST_TIMEOUT_MS || 20000)
);

let browser = null;
let contexto = null;
let pagina = null;
let sessaoPreparada = false;
let pesquisasNaSessao = 0;
let temporizadorOcioso = null;
let fechandoSessao = null;

/*
 * Garante uma única pesquisa do Jaú Serve por vez. Isso evita que múltiplos
 * produtos tentem usar a mesma página/contexto simultaneamente e reduz o pico
 * de memória do Chromium.
 */
let filaPesquisas = Promise.resolve();

function executarExclusivo(tarefa) {
  const execucao = filaPesquisas.then(tarefa, tarefa);
  filaPesquisas = execucao.catch(() => {});
  return execucao;
}

function normalizarInteiro(valor, fallback) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.trunc(numero) : fallback;
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

function cancelarFechamentoOcioso() {
  if (temporizadorOcioso) {
    clearTimeout(temporizadorOcioso);
    temporizadorOcioso = null;
  }
}

function agendarFechamentoOcioso() {
  cancelarFechamentoOcioso();

  temporizadorOcioso = setTimeout(() => {
    executarExclusivo(async () => {
      console.log(
        `Jaú Serve: sessão ociosa por ${TEMPO_FECHAMENTO_OCIOSO_MS} ms; fechando Chromium.`
      );
      await fecharSessao("ociosidade");
    }).catch((erro) => {
      console.error(
        "Jaú Serve: falha ao fechar sessão ociosa:",
        erro.message
      );
    });
  }, TEMPO_FECHAMENTO_OCIOSO_MS);

  temporizadorOcioso.unref?.();
}

function sessaoEstaValida() {
  return Boolean(
    sessaoPreparada &&
      browser &&
      browser.isConnected() &&
      contexto &&
      pagina &&
      !pagina.isClosed()
  );
}

async function fecharSessao(motivo = "solicitação") {
  cancelarFechamentoOcioso();

  if (fechandoSessao) {
    await fechandoSessao;
    return;
  }

  fechandoSessao = (async () => {
    sessaoPreparada = false;
    pesquisasNaSessao = 0;

    const paginaAtual = pagina;
    const contextoAtual = contexto;
    const browserAtual = browser;

    pagina = null;
    contexto = null;
    browser = null;

    if (paginaAtual && !paginaAtual.isClosed()) {
      await paginaAtual.close({ runBeforeUnload: false }).catch(() => {});
    }

    if (contextoAtual) {
      await contextoAtual.close().catch(() => {});
    }

    if (browserAtual) {
      await browserAtual.close().catch(() => {});
    }

    console.log(`Jaú Serve: sessão encerrada (${motivo}).`);
  })();

  try {
    await fechandoSessao;
  } finally {
    fechandoSessao = null;
  }
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

  await fecharSessao("reinicialização preventiva");

  const executablePath = chromium.executablePath();

  console.log("Jaú Serve: iniciando Chromium otimizado.");
  console.log("Jaú Serve: executável Chromium:", executablePath);

  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-breakpad",
      "--disable-component-extensions-with-background-pages",
      "--disable-default-apps",
      "--disable-features=Translate,BackForwardCache,MediaRouter,OptimizationHints",
      "--disable-hang-monitor",
      "--disable-ipc-flooding-protection",
      "--disable-popup-blocking",
      "--disable-prompt-on-repost",
      "--disable-renderer-backgrounding",
      "--disable-sync",
      "--hide-scrollbars",
      "--metrics-recording-only",
      "--mute-audio",
      "--no-first-run",
      "--no-default-browser-check",
      "--password-store=basic",
      "--use-mock-keychain"
    ]
  });

  browser.once("disconnected", () => {
    sessaoPreparada = false;
    browser = null;
    contexto = null;
    pagina = null;
    pesquisasNaSessao = 0;
    console.log("Jaú Serve: Chromium foi desconectado.");
  });

  contexto = await browser.newContext({
    locale: "pt-BR",
    serviceWorkers: "block",
    viewport: {
      width: 1280,
      height: 720
    },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/150.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      Accept:
        "text/html,application/xhtml+xml,application/xml;" +
        "q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
    }
  });

  /*
   * Imagens, fontes e mídia não são necessárias para selecionar a loja nem
   * consultar o HTML de sugestões. Bloqueá-las reduz tempo e RAM.
   */
  await contexto.route("**/*", async (route) => {
    const tipo = route.request().resourceType();

    if (["image", "font", "media"].includes(tipo)) {
      await route.abort().catch(() => {});
      return;
    }

    await route.continue().catch(() => {});
  });

  pagina = await contexto.newPage();
  pagina.setDefaultTimeout(15000);
  pagina.setDefaultNavigationTimeout(TIMEOUT_NAVEGACAO_MS);

  pagina.on("pageerror", (erro) => {
    console.log("Jaú Serve: erro interno da página:", erro.message);
  });

  pagina.on("crash", () => {
    sessaoPreparada = false;
    console.error("Jaú Serve: a página do Chromium sofreu crash.");
  });

  sessaoPreparada = false;
  pesquisasNaSessao = 0;
}

async function abrirHome() {
  await iniciarSessao();

  for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
    try {
      await pagina.goto(HOME_URL, {
        waitUntil: "domcontentloaded",
        timeout: TIMEOUT_NAVEGACAO_MS
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

      await fecharSessao("falha ao abrir a home");
      await iniciarSessao();
    }
  }
}

async function abrirPopupLoja() {
  const popup = pagina.locator("#popUpCep").first();

  await popup.waitFor({
    state: "attached",
    timeout: 15000
  });

  await pagina.evaluate(() => {
    if (window.jQuery) {
      window.jQuery(document).trigger("app:openCepModal");
      window.jQuery("#popUpCep").modal("show");
    }
  });
}

async function carregarCidades() {
  const seletorCidade = pagina
    .locator("#popUpCep #storesCities")
    .first();

  await seletorCidade.waitFor({
    state: "attached",
    timeout: 15000
  });

  await pagina.waitForFunction(
    (cidade) => {
      const select = document.querySelector("#popUpCep #storesCities");

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
    { timeout: 15000 }
  );

  return seletorCidade;
}

async function selecionarCidade() {
  const seletorCidade = await carregarCidades();

  await seletorCidade.selectOption({ label: CIDADE });

  const radiosLojas = pagina.locator(
    '#popUpCep [name="popUpCep__storeInput"]'
  );

  await radiosLojas.first().waitFor({
    state: "attached",
    timeout: 15000
  });

  const total = await radiosLojas.count();

  if (total === 0) {
    throw new Error(`Nenhuma loja encontrada em ${CIDADE}`);
  }

  console.log(
    `Jaú Serve: cidade ${CIDADE}; ${total} loja(s) encontrada(s).`
  );

  return radiosLojas;
}

async function registrarPrimeiraLoja(radiosLojas) {
  const primeiraLoja = radiosLojas.first();
  const valor = await primeiraLoja.getAttribute("value");
  const dataUrl = await primeiraLoja.getAttribute("data-url");

  if (!valor) {
    throw new Error("O valor da primeira loja não foi encontrado");
  }

  if (!dataUrl) {
    throw new Error("O endereço data-url da primeira loja não foi encontrado");
  }

  const resultado = await pagina.evaluate(
    async ({ valorLoja, enderecoLoja }) => {
      try {
        const urlLoja = new URL(enderecoLoja, window.location.origin);
        urlLoja.searchParams.set("postcode", valorLoja);

        const respostaLoja = await fetch(urlLoja.toString(), {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest"
          }
        });

        /*
         * O corpo completo desta resposta não é mantido. Antes ele era
         * armazenado e impresso, aumentando desnecessariamente memória e logs.
         */
        await respostaLoja.text();

        const urlMetodo = window.Urls?.selectShippingMethods;

        if (!urlMetodo) {
          return {
            ok: false,
            etapa: "metodo",
            mensagem: "window.Urls.selectShippingMethods não foi encontrado",
            statusLoja: respostaLoja.status
          };
        }

        const respostaMetodo = await fetch(
          new URL(urlMetodo, window.location.origin).toString(),
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded; charset=UTF-8",
              Accept: "application/json, text/javascript, */*; q=0.01",
              "X-Requested-With": "XMLHttpRequest"
            },
            body: new URLSearchParams({ methodID: "7024" }).toString()
          }
        );

        await respostaMetodo.text();

        return {
          ok: respostaLoja.ok && respostaMetodo.ok,
          statusLoja: respostaLoja.status,
          statusMetodo: respostaMetodo.status
        };
      } catch (erro) {
        return {
          ok: false,
          mensagem: erro?.message || String(erro)
        };
      }
    },
    {
      valorLoja: valor,
      enderecoLoja: dataUrl
    }
  );

  if (!resultado.ok) {
    throw new Error(
      `Não foi possível registrar a loja: ${
        resultado.mensagem || JSON.stringify(resultado)
      }`
    );
  }

  /*
   * Os cookies já foram gravados no contexto pelas requisições acima.
   * Não fazemos pagina.reload(), que era o maior gargalo de tempo.
   */
  sessaoPreparada = true;

  console.log(
    "Jaú Serve: loja e retirada configuradas sem recarregar a página.",
    {
      statusLoja: resultado.statusLoja,
      statusMetodo: resultado.statusMetodo
    }
  );
}

async function configurarLoja() {
  if (sessaoPreparada) {
    return;
  }

  await abrirPopupLoja();
  const radiosLojas = await selecionarCidade();
  await registrarPrimeiraLoja(radiosLojas);
}

async function prepararSessao() {
  cancelarFechamentoOcioso();

  if (sessaoEstaValida()) {
    return;
  }

  await abrirHome();

  if (!sessaoPreparada) {
    await configurarLoja();
  }
}

async function consultarSugestoes(termo) {
  await prepararSessao();

  /*
   * BrowserContext.request compartilha os cookies com o contexto do navegador.
   * Assim, a consulta utiliza a loja selecionada sem executar JavaScript na
   * página para cada produto, reduzindo consumo e tempo.
   */
  const resposta = await contexto.request.get(SUGGESTIONS_URL, {
    params: { q: termo },
    timeout: TIMEOUT_REQUISICAO_MS,
    headers: {
      Accept: "text/html, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      Referer: HOME_URL
    }
  });

  const status = resposta.status();
  const html = await resposta.text();

  console.log(
    `Jaú Serve: endpoint ${status}; HTML ${html.length} bytes; termo: ${termo}`
  );

  if (!resposta.ok()) {
    console.log("Jaú Serve: endpoint de sugestões retornou falha:", status);
    return "";
  }

  return html;
}

function converterPreco(texto) {
  const valor = Number(
    String(texto || "")
      .replace("R$", "")
      .replace(/\s+/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
  );

  return Number.isFinite(valor) ? valor : null;
}

function extrairProdutos(html) {
  if (!html) {
    return [];
  }

  const $ = cheerio.load(html, null, false);
  const produtos = [];

  $(".grid-tile").each((_, elemento) => {
    const card = $(elemento);

    const ean =
      card.attr("data-pid") ||
      card.find(".product-tile").attr("data-itemid") ||
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

    const productName = nomeLink || nomeImagem || "";

    const elementoPreco = card.find(".price .sales .value").first();
    const priceContent = elementoPreco.attr("content");
    const priceText = elementoPreco.text();

    let price = Number(priceContent);

    if (!Number.isFinite(price) || price <= 0) {
      price = converterPreco(priceText);
    }

    const elementoPrecoLista = card
      .find(".strike-through .value")
      .first();

    const listPriceContent = elementoPrecoLista.attr("content");
    const listPriceText = elementoPrecoLista.text();

    let listPrice = Number(listPriceContent);

    if (!Number.isFinite(listPrice) || listPrice <= 0) {
      listPrice = converterPreco(listPriceText);
    }

    const image = card.find("img.tile-image").first().attr("src") || null;

    const href =
      card.find("a.tile-image-container").first().attr("href") ||
      card.find(".pdp-link a").first().attr("href") ||
      null;

    if (!productName || !Number.isFinite(price) || price <= 0) {
      return;
    }

    produtos.push({
      productName,
      productTitle: productName,
      items: [
        {
          ean,
          itemId: ean,
          images: [{ imageUrl: image }],
          sellers: [
            {
              sellerId: "jauserve",
              sellerDefault: true,
              commertialOffer: {
                Price: price,
                ListPrice:
                  Number.isFinite(listPrice) && listPrice > 0
                    ? listPrice
                    : price,
                IsAvailable: true
              }
            }
          ]
        }
      ],
      link: href ? new URL(href, BASE_URL).toString() : null
    });
  });

  return produtos;
}

function removerDuplicados(produtos) {
  const identificadores = new Set();

  return produtos.filter((produto) => {
    const ean = String(produto.items?.[0]?.ean || "");
    const identificador =
      ean || String(produto.productName || "").toLowerCase().trim();

    if (!identificador || identificadores.has(identificador)) {
      return false;
    }

    identificadores.add(identificador);
    return true;
  });
}

async function pesquisarNoSite(termo) {
  try {
    const html = await consultarSugestoes(termo);
    const produtos = extrairProdutos(html);

    console.log(
      `Jaú Serve: ${produtos.length} produto(s) extraído(s) para o termo.`
    );

    return produtos;
  } catch (erro) {
    console.error("Erro na pesquisa do Jaú Serve:", erro.message);

    const mensagem = String(erro?.message || "");

    if (
      mensagem.includes("ERR_CONNECTION_CLOSED") ||
      mensagem.includes("Target page") ||
      mensagem.includes("has been closed") ||
      mensagem.includes("Browser has been closed") ||
      mensagem.includes("browserContext.request")
    ) {
      await fecharSessao("erro de conexão");
    }

    return [];
  }
}

async function limparCacheDoNavegador() {
  if (!contexto || !pagina || pagina.isClosed()) {
    return;
  }

  let sessaoCdp = null;

  try {
    sessaoCdp = await contexto.newCDPSession(pagina);
    await sessaoCdp.send("Network.enable");
    await sessaoCdp.send("Network.clearBrowserCache");
  } catch {
    // Limpeza de cache é complementar; a pesquisa não deve falhar por isso.
  } finally {
    await sessaoCdp?.detach().catch(() => {});
  }
}

async function aplicarPoliticaDeMemoria() {
  pesquisasNaSessao += 1;

  if (pesquisasNaSessao >= MAX_PESQUISAS_POR_SESSAO) {
    console.log(
      `Jaú Serve: limite de ${MAX_PESQUISAS_POR_SESSAO} pesquisa(s) atingido; reciclando Chromium.`
    );
    await fecharSessao("limite de pesquisas");
    return;
  }

  await limparCacheDoNavegador();
  agendarFechamentoOcioso();
}

async function buscarProdutoInterno(termoBusca, eanBuscado) {
  cancelarFechamentoOcioso();

  const termos = prepararTermosBusca(termoBusca);
  let produtos = [];

  try {
    for (const termo of termos) {
      const encontrados = await pesquisarNoSite(termo);
      produtos.push(...encontrados);

      if (encontrados.length > 0) {
        break;
      }
    }

    produtos = removerDuplicados(produtos);

    if (produtos.length === 0) {
      console.log("Jaú Serve: nenhum produto encontrado.", {
        termoBusca,
        eanBuscado: eanBuscado || null,
        termosTentados: termos.length
      });
      return null;
    }

    const melhor = escolherMelhorProduto(
      produtos,
      calcularPontuacao,
      termoBusca,
      eanBuscado
    );

    if (!melhor) {
      console.log("Jaú Serve: nenhum candidato atingiu o score mínimo.", {
        termoBusca,
        candidatos: produtos.length
      });
      return null;
    }

    const item = melhor.items?.[0];
    const seller =
      item?.sellers?.find((registro) => registro.sellerDefault) ||
      item?.sellers?.[0];
    const oferta = seller?.commertialOffer;

    if (!item || !seller || !oferta) {
      console.log(
        "Jaú Serve: estrutura incompleta no produto selecionado."
      );
      return null;
    }

    const produtoCriado = criarProduto({
      supermarketId: "jauserve",
      productName: melhor.productName,
      ean: item.ean,
      itemId: item.itemId,
      sellerId: seller.sellerId,
      price: oferta.Price,
      listPrice: oferta.ListPrice,
      available: oferta.IsAvailable === true,
      image: item.images?.[0]?.imageUrl || null,
      url: melhor.link
    });

    console.log("Jaú Serve: produto selecionado:", {
      productName: produtoCriado?.productName,
      ean: produtoCriado?.ean,
      price: produtoCriado?.price,
      available: produtoCriado?.available
    });

    return produtoCriado;
  } finally {
    /*
     * Executado mesmo quando o produto não é encontrado ou ocorre erro.
     * É a principal proteção contra crescimento contínuo de memória.
     */
    await aplicarPoliticaDeMemoria();
  }
}

async function buscarProduto(termoBusca, eanBuscado) {
  return executarExclusivo(() =>
    buscarProdutoInterno(termoBusca, eanBuscado)
  );
}

async function encerrar() {
  await executarExclusivo(() => fecharSessao("encerramento do serviço"));
}

process.once("SIGINT", async () => {
  await encerrar();
  process.exit(0);
});

process.once("SIGTERM", async () => {
  await encerrar();
  process.exit(0);
});

module.exports = {
  buscarProduto,
  encerrar
};
