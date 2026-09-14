const { chromium } = require('playwright');
const { criarProduto } = require('../core/produto');
const fs = require('fs');
const path = require('path');

// ============================================================
// CONFIGURAÇÃO
// ============================================================

const CDP_URL = 'http://127.0.0.1:9222';

const MAX_CANDIDATOS_PDP = 8;
const ESPERA_APOS_NAVEGACAO_MS = 1800;



// ============================================================
// UTILIDADES
// ============================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/(\d)\s*litros?\b/g, '$1l')
    .replace(/(\d)\s*l\b/g, '$1l')
    .replace(/(\d)\s*kg\b/g, '$1kg')
    .replace(/(\d)\s*g\b/g, '$1g')
    .replace(/(\d)\s*ml\b/g, '$1ml')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function corrigirMojibake(texto) {
  const s = String(texto || '');
  if (!/[ÃÂ]/.test(s)) return s;
  try {
    const corrigido = Buffer.from(s, 'latin1').toString('utf8');
    return corrigido.includes('�') ? s : corrigido;
  } catch {
    return s;
  }
}

function palavras(texto) {
  const ignorar = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'e', 'em', 'para', 'por']);
  return normalizar(texto)
    .split(' ')
    .filter(p => p.length >= 2 && !ignorar.has(p));
}

function extrairMedidas(texto) {
  return normalizar(texto).match(/\b\d+(?:[.,]\d+)?(?:ml|l|g|kg)\b/g) || [];
}

function ehKit(texto) {
  const t = normalizar(texto);
  return /\bkit\b/.test(t) || /\b\d+\s*(un|unidade|unidades)\b/.test(t);
}

const CARACTERISTICAS = [
  'integral',
  'desnatado',
  'semidesnatado',
  'zero lactose',
  'sem lactose',
  'po',
  'instantaneo',
  'vegetal',
  'a2a2',
  'forti',
  'vitaminado',
];

function calcularScore(nomeDale, nomeCarrefour) {
  const daleNormalizado = normalizar(nomeDale);
  const carrefourNormalizado = normalizar(nomeCarrefour);
  const palavrasDale = palavras(nomeDale);
  const palavrasCarrefour = palavras(nomeCarrefour);
  let score = 0;
  const motivos = [];

  for (const palavra of palavrasDale) {
    if (palavrasCarrefour.includes(palavra)) {
      score += 10;
      motivos.push(`+10 palavra: ${palavra}`);
    }
  }

  const termosFortes = ['piracanjuba', 'ninho', 'carrefour', 'italac', 'itambe', 'xando', 'notco'];

  for (const termo of termosFortes) {
    const daleTem = daleNormalizado.includes(termo);
    const carrefourTem = carrefourNormalizado.includes(termo);

    if (daleTem && carrefourTem) {
      score += 30;
      motivos.push(`+30 marca/termo: ${termo}`);
    }

    if (daleTem && !carrefourTem) {
      score -= 50;
      motivos.push(`-50 marca ausente: ${termo}`);
    }
  }

  const medidasDale = extrairMedidas(nomeDale);
  const medidasCarrefour = extrairMedidas(nomeCarrefour);

  if (medidasDale.length) {
    const principal = medidasDale[0];
    if (medidasCarrefour.includes(principal)) {
      score += 35;
      motivos.push(`+35 medida igual: ${principal}`);
    } else if (medidasCarrefour.length) {
      score -= 40;
      motivos.push(`-40 medida diferente: ${medidasCarrefour.join(', ')}`);
    }
  }

  for (const caracteristica of CARACTERISTICAS) {
    const daleTem = daleNormalizado.includes(normalizar(caracteristica));
    const carrefourTem = carrefourNormalizado.includes(normalizar(caracteristica));

    if (daleTem && carrefourTem) {
      score += 20;
      motivos.push(`+20 característica: ${caracteristica}`);
    }
    if (!daleTem && carrefourTem) {
      score -= 15;
      motivos.push(`-15 característica extra: ${caracteristica}`);
    }
    if (daleTem && !carrefourTem) {
      score -= 25;
      motivos.push(`-25 característica ausente: ${caracteristica}`);
    }
  }

  if (ehKit(nomeDale) === ehKit(nomeCarrefour)) {
    score += 15;
    motivos.push('+15 tipo unitário/kit compatível');
  } else {
    score -= 80;
    motivos.push('-80 incompatibilidade kit/unidade');
  }

  if (daleNormalizado === carrefourNormalizado) {
    score += 100;
    motivos.push('+100 nome normalizado idêntico');
  }

  return { score, motivos };
}

// ============================================================
// DECODIFICADOR REMIX
// ============================================================

function decodificarRemixTexto(texto) {
  const d = JSON.parse(String(texto).trim());
  if (!Array.isArray(d)) throw new Error('Resposta Remix não é um array.');

  const memo = new Map();

  function R(i) {
    if (i === -1 || i === -2) return undefined;
    if (i === -3) return NaN;
    if (i === -4) return Infinity;
    if (i === -5) return -Infinity;
    if (typeof i !== 'number' || i < 0 || i >= d.length) return i;
    if (memo.has(i)) return memo.get(i);

    const v = d[i];
    if (v === null || typeof v !== 'object') return v;

    if (Array.isArray(v)) {
      const arr = [];
      memo.set(i, arr);
      for (const item of v) arr.push(R(item));
      return arr;
    }

    const obj = {};
    memo.set(i, obj);

    for (const [chaveOriginal, valorIndice] of Object.entries(v)) {
      const indiceChave = Number(chaveOriginal.replace(/^_/, ''));
      const chaveReal = d[indiceChave];
      if (typeof chaveReal === 'string') obj[chaveReal] = R(valorIndice);
    }

    return obj;
  }

  return R(0);
}

function procurarTodos(obj, teste, resultados = [], visitados = new Set()) {
  if (!obj || typeof obj !== 'object') return resultados;
  if (visitados.has(obj)) return resultados;
  visitados.add(obj);

  if (teste(obj)) resultados.push(obj);

  for (const valor of Object.values(obj)) {
    if (valor && typeof valor === 'object') {
      procurarTodos(valor, teste, resultados, visitados);
    }
  }

  return resultados;
}

function encontrarPrimeiro(obj, teste) {
  const resultados = procurarTodos(obj, teste);
  return resultados[0] || null;
}

function encontrarSellerCarrefour(produto) {
  return encontrarPrimeiro(
    produto,
    obj => typeof obj.sellerName === 'string' && obj.sellerName.toLowerCase().includes('carrefour')
  );
}

function extrairPreco(seller) {
  const oferta = seller?.commertialOffer || seller?.commercialOffer || {};
  return oferta.calculatedSpotPrice ?? oferta.spotPrice ?? oferta.price ?? oferta.Price ?? null;
}

function extrairEstoque(seller) {
  const oferta = seller?.commertialOffer || seller?.commercialOffer || {};
  return oferta.availableQuantity ?? oferta.AvailableQuantity ?? null;
}

function extrairGtin(raiz) {
  const candidatos = procurarTodos(
    raiz,
    obj =>
      (typeof obj.gtin === 'string' && /^\d{8,14}$/.test(obj.gtin)) ||
      (typeof obj.ean === 'string' && /^\d{8,14}$/.test(obj.ean))
  );

  for (const obj of candidatos) {
    if (typeof obj.gtin === 'string' && /^\d{8,14}$/.test(obj.gtin)) return obj.gtin;
    if (typeof obj.ean === 'string' && /^\d{8,14}$/.test(obj.ean)) return obj.ean;
  }

  return null;
}

function extrairProdutoPdp(raiz) {
  return encontrarPrimeiro(
    raiz,
    obj => typeof obj.productName === 'string' && (obj.productId || obj.productReference)
  );
}

function extrairLinkProduto(produto) {
  const possiveis = [
    produto.link,
    produto.href,
    produto.url,
    produto.productUrl,
  ].filter(v => typeof v === 'string' && v.length > 0);

  return possiveis[0] || null;
}

function absolutizarUrl(link) {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return link;
  return `https://mercado.carrefour.com.br${link.startsWith('/') ? '' : '/'}${link}`;
}

// ============================================================
// CAPTURA DE TODAS AS RESPOSTAS .DATA DURANTE NAVEGAÇÃO
// ============================================================

async function navegarEColetar(page, url, filtro, esperaMs = 2500) {
  const capturas = [];
  const pendentes = new Set();

  const handler = response => {
    const responseUrl = response.url();
    if (!filtro(responseUrl, response)) return;

    const tarefa = (async () => {
      try {
        const texto = await response.text();
        capturas.push({
          url: responseUrl,
          status: response.status(),
          texto,
        });
      } catch {
        // Algumas respostas podem não permitir leitura do corpo.
      }
    })();

    pendentes.add(tarefa);
    tarefa.finally(() => pendentes.delete(tarefa));
  };

  page.on('response', handler);

  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await sleep(esperaMs);
    await Promise.allSettled([...pendentes]);
    return capturas;
  } finally {
    page.off('response', handler);
  }
}

function extrairProdutosDasCapturas(capturas) {
  const produtos = [];

  for (const captura of capturas) {
    try {
      const raiz = decodificarRemixTexto(captura.texto);
      const encontrados = procurarTodos(
        raiz,
        obj => typeof obj.productName === 'string' && obj.productReference
      );
      produtos.push(...encontrados);
    } catch {
      // Nem toda resposta .data possui o mesmo payload Remix.
    }
  }

  return produtos;
}

// ============================================================
// LEITURA DO PDP RENDERIZADO NO PRÓPRIO CHROME
// ============================================================

async function lerPdpRenderizado(page) {
  return await page.evaluate(() => {
    function achatarJsonLd(valor, saida = []) {
      if (!valor) return saida;
      if (Array.isArray(valor)) {
        for (const item of valor) achatarJsonLd(item, saida);
        return saida;
      }
      if (typeof valor === 'object') {
        saida.push(valor);
        if (valor['@graph']) achatarJsonLd(valor['@graph'], saida);
      }
      return saida;
    }

    const jsonLd = [];

    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent || '');
        achatarJsonLd(parsed, jsonLd);
      } catch {
        // ignora JSON-LD inválido
      }
    }

    const produto = jsonLd.find(obj => {
      const tipo = obj?.['@type'];
      return tipo === 'Product' || (Array.isArray(tipo) && tipo.includes('Product'));
    }) || null;

    const offers = Array.isArray(produto?.offers)
      ? produto.offers[0]
      : (produto?.offers || null);

    const textoPagina = document.body?.innerText || '';

    const indisponivelPorTexto = /não possui estoque|nao possui estoque|indisponível|indisponivel/i.test(textoPagina);
    const disponibilidadeSchema = String(offers?.availability || produto?.availability || '');
    const indisponivelPorSchema = /OutOfStock|Discontinued/i.test(disponibilidadeSchema);
    const disponivelPorSchema = /InStock/i.test(disponibilidadeSchema);

    let estoqueStatus = null;
    if (indisponivelPorTexto || indisponivelPorSchema) estoqueStatus = 0;
    else if (disponivelPorSchema) estoqueStatus = 1;

    const gtin =
      produto?.gtin14 ||
      produto?.gtin13 ||
      produto?.gtin12 ||
      produto?.gtin8 ||
      produto?.gtin ||
      produto?.sku ||
      null;

    const preco =
      offers?.price ??
      offers?.lowPrice ??
      null;

    return {
      productName: produto?.name || null,
      gtin: gtin != null ? String(gtin) : null,
      preco: preco != null ? Number(preco) : null,
      estoque: estoqueStatus,
      availability: disponibilidadeSchema || null,
      url: location.href,
      textoIndisponivel: indisponivelPorTexto,
    };
  });
}


// ============================================================
// MÓDULO OFICIAL CARREFOUR
// ============================================================

const BASE_URL = 'https://mercado.carrefour.com.br';

// Mapeamentos confirmados por EAN. Depois isso pode ir para Supabase.
const PRODUTOS_CONHECIDOS = new Map([
  ['7898215151708', {
    itemId: '8253',
    productReference: '3371689',
    url: `${BASE_URL}/produto/leite-integral-piracanjuba-1-litro-8253`,
  }],
]);

function montarTermosBusca(nome) {
  const limpo = String(nome || '').trim();
  const partes = palavras(limpo);
  const termos = new Set();
  if (limpo) termos.add(limpo);
  if (partes.length >= 2) termos.add(partes.join(' '));
  const medidas = extrairMedidas(limpo);
  const medida = medidas[0];
  const fortes = ['piracanjuba','ninho','carrefour','italac','itambe','xando','notco'];
  const marca = fortes.find(m => normalizar(limpo).includes(m));
  if (marca && medida) termos.add(`${marca} ${medida}`);
  if (marca) termos.add(`${partes[0] || ''} ${marca} ${medida || ''}`.replace(/\s+/g,' ').trim());
  return [...termos].filter(Boolean).slice(0, 4);
}

async function obterPaginaCarrefour() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  if (!context) throw new Error('Nenhum contexto do Chrome encontrado.');
  let page = context.pages().find(p => p.url().includes('mercado.carrefour.com.br'));
  if (!page) {
    page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  return { browser, context, page };
}

function formatarResultado({ ean, nome, pdp, conhecido = null }) {
  const match = String(pdp?.gtin || '') === String(ean || '');
  if (!match) return null;
  const disponivel = pdp.estoque === 1;
  return {
    supermercado: 'carrefour',
    encontrado: true,
    disponivel,
    ean: String(ean),
    nome: corrigirMojibake(pdp.productName || nome || ''),
    preco: disponivel && pdp.preco != null ? Number(pdp.preco) : null,
    precoExibido: pdp.preco != null ? Number(pdp.preco) : null,
    itemId: conhecido?.itemId || null,
    productReference: conhecido?.productReference || null,
    url: pdp.url || conhecido?.url || null,
    seller: 'Carrefour',
    estoque: pdp.estoque,
    matchEan: true,
  };
}

async function consultarPdpDireto(page, ean, nome, conhecido) {
  await page.goto(conhecido.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2200);
  const pdp = await lerPdpRenderizado(page);
  return formatarResultado({ ean, nome, pdp, conhecido });
}

async function buscarCandidatos(page, produtoDale) {
  const todos = [];
  const termos = montarTermosBusca(produtoDale.nome);
  for (const termo of termos) {
    const urlPagina = `${BASE_URL}/busca/${encodeURIComponent(termo)}`;
    try {
      const capturas = await navegarEColetar(
        page,
        urlPagina,
        responseUrl => responseUrl.includes('mercado.carrefour.com.br/busca/') && responseUrl.includes('.data') && !responseUrl.includes('/busca.data?'),
        2600
      );
      const produtos = extrairProdutosDasCapturas(capturas);
      for (const produto of produtos) todos.push({ ...produto, termoOrigem: termo });
    } catch {}
  }
  const unicos = [];
  const vistos = new Set();
  for (const produto of todos) {
    const chave = `${produto.productId || '-'}|${produto.productReference || '-'}|${produto.productName || '-'}`;
    if (!vistos.has(chave)) { vistos.add(chave); unicos.push(produto); }
  }
  return unicos.map(produto => {
    const nome = corrigirMojibake(produto.productName);
    const { score } = calcularScore(produtoDale.nome, nome);
    return { produto, nome, score };
  }).sort((a,b) => b.score - a.score);
}

async function validarRanking(page, produtoDale, ranking) {
  const limite = Math.min(MAX_CANDIDATOS_PDP, ranking.length);
  for (let i = 0; i < limite; i++) {
    const item = ranking[i];
    const link = extrairLinkProduto(item.produto);
    if (!link) continue;
    try {
      const url = absolutizarUrl(link);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2200);
      const pdp = await lerPdpRenderizado(page);
      const resultado = formatarResultado({ ean: produtoDale.ean, nome: produtoDale.nome, pdp });
      if (resultado) {
        resultado.productReference = item.produto.productReference || null;
        resultado.itemId = item.produto.itemId || item.produto.items?.[0]?.itemId || null;
        return resultado;
      }
    } catch {}
  }
  return null;
}

async function buscarCarrefourDetalhado(produto) {
  if (!produto || !produto.ean || !produto.nome) {
    throw new Error('Carrefour: informe { ean, nome }.');
  }
  const produtoDale = { ean: String(produto.ean).trim(), nome: String(produto.nome).trim(), cep: produto.cep || null };
  const { page } = await obterPaginaCarrefour();

  // 1. Produto já mapeado: PDP direto, sem depender da busca.
  const conhecido = PRODUTOS_CONHECIDOS.get(produtoDale.ean);
  if (conhecido) {
    try {
      const direto = await consultarPdpDireto(page, produtoDale.ean, produtoDale.nome, conhecido);
      if (direto) return direto;
    } catch {}
  }

  // 2. Produto novo: busca candidatos e só aceita EAN exato no PDP.
  const ranking = await buscarCandidatos(page, produtoDale);
  const encontrado = await validarRanking(page, produtoDale, ranking);
  if (encontrado) return encontrado;

  return {
    supermercado: 'carrefour',
    encontrado: false,
    disponivel: false,
    ean: produtoDale.ean,
    nome: produtoDale.nome,
    preco: null,
    precoExibido: null,
    itemId: null,
    productReference: null,
    url: null,
    seller: null,
    estoque: null,
    matchEan: false,
  };
}

async function buscarProduto(termoBusca, eanBuscado, cep) {
  const termo = String(termoBusca || '').trim();
  const ean = String(eanBuscado || '').replace(/\D/g, '');

  if (!termo || !ean) {
    console.log('Carrefour: termo de busca ou EAN ausente.');
    return null;
  }

  try {
    const resultado = await buscarCarrefourDetalhado({
      nome: termo,
      ean,
      cep: cep || null,
    });

    if (!resultado || !resultado.encontrado || !resultado.matchEan) {
      console.log('Carrefour: EAN exato não confirmado.', { termoBusca: termo, eanBuscado: ean });
      return null;
    }

    if (!resultado.disponivel || typeof resultado.preco !== 'number' || resultado.preco <= 0) {
      console.log('Carrefour: produto exato encontrado, porém indisponível para a região atual.', {
        ean,
        produto: resultado.nome,
        precoExibido: resultado.precoExibido,
      });
      return null;
    }

    return criarProduto({
      supermarketId: 'carrefour',
      productName: resultado.nome,
      ean: resultado.ean,
      itemId: resultado.itemId,
      sellerId: resultado.seller || 'Carrefour',
      price: resultado.preco,
      listPrice: resultado.precoExibido ?? resultado.preco,
      available: true,
      image: null,
      url: resultado.url || null,
    });
  } catch (erro) {
    console.log('Carrefour - erro na busca:', erro.message);
    return null;
  }
}

module.exports = {
  buscarProduto,
  buscarCarrefour: buscarCarrefourDetalhado,
  PRODUTOS_CONHECIDOS,
};
