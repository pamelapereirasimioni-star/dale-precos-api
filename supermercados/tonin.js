const crypto = require("crypto");

const { limparNomeBusca } = require("../utils/texto");
const { validarCorrespondencia } = require("../core/validador");
const { calcularPontuacao } = require("../core/score");
const { escolherMelhorProduto } = require("../core/escolhedor");
const { criarProduto } = require("../core/produto");

const API_BASE =
  process.env.TONIN_API_BASE ||
  "https://services.vipcommerce.com.br/api-admin/v1";

const ORG = process.env.TONIN_ORG || "346";
const FILIAL = process.env.TONIN_FILIAL || "1";

const CENTRO_DISTRIBUICAO_PADRAO =
  process.env.TONIN_CENTRO_DISTRIBUICAO || "3";

const SITE_BASE =
  process.env.TONIN_SITE_BASE ||
  "https://www.supertonin.com.br";

const TONIN_DOMAIN_KEY =
  process.env.TONIN_DOMAIN_KEY ||
  "supertonin.com.br";

const TONIN_BEARER_TOKEN =
  process.env.TONIN_BEARER_TOKEN || "";

const TONIN_LOJA_AUTH_JWT =
  process.env.TONIN_LOJA_AUTH_JWT || "";

const SESSION =
  process.env.TONIN_SESSION ||
  process.env.TONIN_SESSAO_ID ||
  crypto.randomUUID();

const GOOGLE_MAPS_API_KEY =
  process.env.GOOGLE_MAPS_API_KEY || "";

const BRASIL_API_BASE =
  process.env.BRASIL_API_BASE ||
  "https://brasilapi.com.br/api/cep/v2";

const CACHE_LOJAS_TTL_MS = 10 * 60 * 1000;
const CACHE_CEP_TTL_MS = 30 * 60 * 1000;

let cacheLojasTonin = null;
let cacheLojasToninEm = 0;

const cacheResolucaoCep = new Map();

function normalizarCep(cep) {
  const digits = String(cep || "").replace(/\D/g, "");
  return digits.length === 8 ? digits : "";
}

function normalizarTexto(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function prepararTermosBusca(termoBusca) {
  const original = String(termoBusca || "")
    .replace(/\s+/g, " ")
    .trim();

  const termoLimpo = limparNomeBusca(original);

  const semQuantidade = original
    .replace(
      /\b\d+(?:[.,]\d+)?\s*(kg|g|mg|ml|l|un|und|unidade|unidades)\b/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();

  return [
    ...new Set(
      [original, termoLimpo, semQuantidade].filter(Boolean)
    )
  ];
}

function criarHeaders(token) {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "pt-BR,pt;q=0.9",
    OrganizationId: ORG,
    domainkey: TONIN_DOMAIN_KEY,
    "sessao-id": SESSION,
    Origin: SITE_BASE,
    Referer: `${SITE_BASE}/`,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/150.0.0.0 Safari/537.36"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function obterTokensParaTeste() {
  return [
    TONIN_BEARER_TOKEN,
    TONIN_LOJA_AUTH_JWT,
    ""
  ].filter(
    (token, indice, lista) =>
      lista.indexOf(token) === indice
  );
}

async function requisitarJsonTonin(url) {
  const tokens = obterTokensParaTeste();

  for (const token of tokens) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: criarHeaders(token),
        signal: AbortSignal.timeout(30000)
      });

      const texto = await response.text();

      if (!response.ok) {
        continue;
      }

      try {
        return JSON.parse(texto);
      } catch {
        continue;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function montarUrlRetiradas() {
  return (
    `${API_BASE}/org/${ORG}` +
    `/filial/${FILIAL}` +
    "/loja/centros_distribuicoes/retiradas"
  );
}

function localizarArrayLojas(dados) {
  if (!dados) return [];
  if (Array.isArray(dados)) return dados;
  if (Array.isArray(dados.data)) return dados.data;
  return [];
}

function normalizarLojaTonin(loja) {
  const latitude = Number(
    loja?.coordenada_geografica?.latitude
  );

  const longitude = Number(
    loja?.coordenada_geografica?.longitude
  );

  const id = String(loja?.id ?? "").trim();

  if (
    !id ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }

  return {
    id,
    nome: String(
      loja?.nome_site ||
      loja?.nome ||
      `Tonin CD ${id}`
    ).trim(),
    ativo: loja?.ativo !== false,
    latitude,
    longitude,
    endereco: {
      cep: String(loja?.endereco?.cep || ""),
      logradouro: String(
        loja?.endereco?.logradouro || ""
      ),
      numero: String(loja?.endereco?.numero || ""),
      bairro: String(loja?.endereco?.bairro || ""),
      cidade: String(loja?.endereco?.cidade || ""),
      estado: String(loja?.endereco?.estado || "")
    }
  };
}

async function obterLojasTonin() {
  const agora = Date.now();

  if (
    Array.isArray(cacheLojasTonin) &&
    cacheLojasTonin.length > 0 &&
    agora - cacheLojasToninEm < CACHE_LOJAS_TTL_MS
  ) {
    return cacheLojasTonin;
  }

  const dados = await requisitarJsonTonin(
    montarUrlRetiradas()
  );

  const lojas = localizarArrayLojas(dados)
    .map(normalizarLojaTonin)
    .filter(Boolean)
    .filter((loja) => loja.ativo);

  if (!lojas.length) {
    return [];
  }

  cacheLojasTonin = lojas;
  cacheLojasToninEm = agora;

  return lojas;
}

async function obterEnderecoDoCep(cep) {
  try {
    const response = await fetch(
      `${BRASIL_API_BASE}/${encodeURIComponent(cep)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(15000)
      }
    );

    if (!response.ok) {
      return null;
    }

    const dados = await response.json();

    const logradouro = String(
      dados?.street || ""
    ).trim();

    const bairro = String(
      dados?.neighborhood || ""
    ).trim();

    const cidade = String(
      dados?.city || ""
    ).trim();

    const estado = String(
      dados?.state || ""
    ).trim();

    if (!cidade || !estado) {
      return null;
    }

    return {
      cep,
      logradouro,
      bairro,
      cidade,
      estado
    };
  } catch {
    return null;
  }
}

function montarEnderecoParaGoogle(endereco) {
  return [
    endereco?.logradouro,
    endereco?.bairro,
    endereco?.cidade,
    endereco?.estado,
    endereco?.cep,
    "Brasil"
  ]
    .filter(Boolean)
    .join(", ");
}

async function geocodificarEndereco(enderecoCompleto) {
  if (!GOOGLE_MAPS_API_KEY) {
    console.error(
      "Tonin: GOOGLE_MAPS_API_KEY não configurada no .env."
    );
    return null;
  }

  try {
    const url = new URL(
      "https://maps.googleapis.com/maps/api/geocode/json"
    );

    url.searchParams.set("address", enderecoCompleto);
    url.searchParams.set("region", "br");
    url.searchParams.set("language", "pt-BR");
    url.searchParams.set("key", GOOGLE_MAPS_API_KEY);

    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      return null;
    }

    const dados = await response.json();

    if (
      dados?.status !== "OK" ||
      !Array.isArray(dados?.results) ||
      !dados.results.length
    ) {
      console.warn(
        "Tonin: Google Geocoding não retornou resultado válido.",
        {
          status: dados?.status || null,
          endereco: enderecoCompleto
        }
      );
      return null;
    }

    const resultado = dados.results[0];
    const latitude = Number(
      resultado?.geometry?.location?.lat
    );
    const longitude = Number(
      resultado?.geometry?.location?.lng
    );

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return null;
    }

    return {
      latitude,
      longitude,
      enderecoFormatado:
        resultado?.formatted_address ||
        enderecoCompleto,
      tipoLocalizacao:
        resultado?.geometry?.location_type ||
        null
    };
  } catch {
    return null;
  }
}

function calcularDistanciaKm(
  latitudeA,
  longitudeA,
  latitudeB,
  longitudeB
) {
  const raioTerraKm = 6371;
  const paraRadianos = (graus) =>
    (graus * Math.PI) / 180;

  const deltaLatitude = paraRadianos(
    latitudeB - latitudeA
  );

  const deltaLongitude = paraRadianos(
    longitudeB - longitudeA
  );

  const latA = paraRadianos(latitudeA);
  const latB = paraRadianos(latitudeB);

  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latA) *
      Math.cos(latB) *
      Math.sin(deltaLongitude / 2) ** 2;

  const c = 2 * Math.atan2(
    Math.sqrt(a),
    Math.sqrt(1 - a)
  );

  return raioTerraKm * c;
}

function escolherLojaMaisProxima(
  latitude,
  longitude,
  lojas
) {
  const candidatas = lojas
    .map((loja) => ({
      ...loja,
      distanciaKm: calcularDistanciaKm(
        latitude,
        longitude,
        loja.latitude,
        loja.longitude
      )
    }))
    .filter((loja) =>
      Number.isFinite(loja.distanciaKm)
    )
    .sort(
      (a, b) => a.distanciaKm - b.distanciaKm
    );

  return candidatas[0] || null;
}

async function resolverCentroDistribuicaoPorCep(cep) {
  const cepNormalizado = normalizarCep(cep);

  if (!cepNormalizado) {
    return {
      cd: CENTRO_DISTRIBUICAO_PADRAO,
      origem: "padrao-env-sem-cep",
      loja: null,
      cep: "",
      distanciaKm: null,
      enderecoGeocodificado: null,
      tipoLocalizacao: null
    };
  }

  const cache = cacheResolucaoCep.get(
    cepNormalizado
  );

  if (
    cache &&
    Date.now() - cache.criadoEm < CACHE_CEP_TTL_MS
  ) {
    return cache.valor;
  }

  const endereco = await obterEnderecoDoCep(
    cepNormalizado
  );

  if (!endereco) {
    console.warn(
      "Tonin: não foi possível obter o endereço do CEP.",
      { cep: cepNormalizado }
    );
    return null;
  }

  const enderecoCompleto =
    montarEnderecoParaGoogle(endereco);

  const geocodificacao = await geocodificarEndereco(
    enderecoCompleto
  );

  if (!geocodificacao) {
    console.warn(
      "Tonin: não foi possível geocodificar o CEP no Google.",
      {
        cep: cepNormalizado,
        endereco: enderecoCompleto
      }
    );
    return null;
  }

  const lojas = await obterLojasTonin();

  if (!lojas.length) {
    console.warn(
      "Tonin: endpoint de retiradas não retornou lojas válidas."
    );
    return null;
  }

  const loja = escolherLojaMaisProxima(
    geocodificacao.latitude,
    geocodificacao.longitude,
    lojas
  );

  if (!loja) {
    return null;
  }

  const resolucao = {
    cd: loja.id,
    origem: "google-geocoding+retiradas",
    loja: loja.nome,
    cep: cepNormalizado,
    distanciaKm: Number(
      loja.distanciaKm.toFixed(3)
    ),
    enderecoGeocodificado:
      geocodificacao.enderecoFormatado,
    tipoLocalizacao:
      geocodificacao.tipoLocalizacao
  };

  cacheResolucaoCep.set(
    cepNormalizado,
    {
      criadoEm: Date.now(),
      valor: resolucao
    }
  );

  return resolucao;
}

function montarUrlBusca(
  termo,
  centroDistribuicao,
  pagina = 1
) {
  return (
    `${API_BASE}/org/${ORG}` +
    `/filial/${FILIAL}` +
    `/centro_distribuicao/${centroDistribuicao}` +
    `/loja/buscas/produtos/termo/${encodeURIComponent(termo)}` +
    `?page=${pagina}` +
    `&session=${encodeURIComponent(SESSION)}`
  );
}

async function requisitarProdutos(
  termo,
  centroDistribuicao
) {
  const url = montarUrlBusca(
    termo,
    centroDistribuicao
  );

  return requisitarJsonTonin(url);
}

function localizarArrayProdutos(dados) {
  if (!dados) return [];
  if (Array.isArray(dados)) return dados;
  if (Array.isArray(dados.data)) return dados.data;
  if (Array.isArray(dados.produtos)) return dados.produtos;
  if (Array.isArray(dados.items)) return dados.items;
  if (Array.isArray(dados?.data?.produtos)) {
    return dados.data.produtos;
  }
  return [];
}

function extrairEan(produto) {
  return String(
    produto?.codigo_barras ||
    produto?.ean ||
    produto?.gtin ||
    ""
  ).replace(/\D/g, "");
}

function extrairNome(produto) {
  return String(
    produto?.descricao ||
    produto?.nome ||
    produto?.productName ||
    ""
  ).trim();
}

function extrairPreco(produto) {
  if (
    produto?.em_oferta === true &&
    produto?.oferta?.preco_oferta != null
  ) {
    return Number(
      produto.oferta.preco_oferta
    ) || null;
  }

  return Number(produto?.preco) || null;
}

function extrairListPrice(produto) {
  if (
    produto?.em_oferta === true &&
    produto?.oferta?.preco_antigo != null
  ) {
    return Number(
      produto.oferta.preco_antigo
    ) || null;
  }

  return Number(produto?.preco) || null;
}

function extrairImagem(produto) {
  const imagem = produto?.imagem;
  if (!imagem) return null;

  if (/^https?:\/\//i.test(imagem)) {
    return imagem;
  }

  return `${SITE_BASE}/${String(imagem).replace(/^\/+/, "")}`;
}

function extrairUrl(produto) {
  if (produto?.link) return produto.link;

  const id = produto?.produto_id;
  if (!id) return null;

  const nome = extrairNome(produto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `${SITE_BASE}/produto/${id}/${nome}`;
}

function normalizarProdutoTonin(produto) {
  return {
    ...produto,
    _ean: extrairEan(produto),
    _nome: extrairNome(produto)
  };
}

function extrairMelhorOferta(
  produto,
  centroDistribuicao
) {
  if (!produto) return null;

  const ean = extrairEan(produto);
  const nome = extrairNome(produto);
  const preco = extrairPreco(produto);
  const listPrice = extrairListPrice(produto);

  if (!ean || !nome || preco == null) {
    return null;
  }

  return criarProduto({
    supermarketId: "tonin",
    productName: nome,
    ean,
    itemId: String(
      produto?.produto_id ||
      produto?.id ||
      ""
    ),
    sellerId: `tonin-cd-${centroDistribuicao}`,
    price: preco,
    listPrice,
    available: produto?.disponivel === true,
    image: extrairImagem(produto),
    url: extrairUrl(produto)
  });
}

async function buscarProduto(
  termoBusca,
  eanBuscado,
  cep
) {
  const eanNormalizado = String(
    eanBuscado || ""
  ).replace(/\D/g, "");

  const resolucao =
    await resolverCentroDistribuicaoPorCep(cep);

  if (!resolucao?.cd) {
    console.warn(
      "Tonin: não foi possível determinar com segurança o CD para o CEP; retornando indisponível.",
      {
        cep: normalizarCep(cep) || null,
        termoBusca,
        eanBuscado: eanNormalizado || null
      }
    );
    return null;
  }

  const centroDistribuicao = resolucao.cd;

  console.log(
    "Tonin: contexto regional resolvido.",
    {
      cep: resolucao.cep || null,
      centroDistribuicao,
      origem: resolucao.origem,
      loja: resolucao.loja,
      distanciaKm: resolucao.distanciaKm,
      enderecoGeocodificado:
        resolucao.enderecoGeocodificado,
      tipoLocalizacao:
        resolucao.tipoLocalizacao
    }
  );

  const termos = prepararTermosBusca(termoBusca);

  let todosProdutos = [];

  for (const termo of termos) {
    const dados = await requisitarProdutos(
      termo,
      centroDistribuicao
    );

    const produtos = localizarArrayProdutos(dados)
      .map(normalizarProdutoTonin);

    todosProdutos = [
      ...todosProdutos,
      ...produtos
    ];
  }

  const mapa = new Map();

  for (const produto of todosProdutos) {
    const chave =
      String(produto?.produto_id || "") +
      "|" +
      produto._ean;

    if (!mapa.has(chave)) {
      mapa.set(chave, produto);
    }
  }

  const produtos = Array.from(mapa.values());

  // Se houver EAN buscado, só aceitamos o MESMO EAN.
  if (eanNormalizado) {
    const exato = produtos.find(
      (produto) =>
        produto._ean === eanNormalizado
    );

    if (!exato) {
      console.log(
        "Tonin: EAN exato não encontrado neste CD; retornando indisponível.",
        {
          eanBuscado: eanNormalizado,
          termoBusca,
          centroDistribuicao
        }
      );
      return null;
    }

    if (exato?.disponivel !== true) {
      console.log(
        "Tonin: EAN exato encontrado, porém indisponível neste CD.",
        {
          eanBuscado: eanNormalizado,
          produto_id: exato?.produto_id,
          nome: exato._nome,
          centroDistribuicao
        }
      );
      return null;
    }

    console.log(
      "Tonin: EAN exato confirmado no CD.",
      {
        eanBuscado: eanNormalizado,
        produto_id: exato?.produto_id,
        nome: exato._nome,
        preco: extrairPreco(exato),
        centroDistribuicao
      }
    );

    return extrairMelhorOferta(
      exato,
      centroDistribuicao
    );
  }

  // Correspondência aproximada só quando NÃO houver EAN.
  const candidatosValidos = produtos.filter(
    (produto) =>
      produto?._nome &&
      validarCorrespondencia(
        termoBusca,
        produto
      )
  );

  const melhor = escolherMelhorProduto(
    candidatosValidos,
    calcularPontuacao,
    termoBusca,
    null
  );

  if (!melhor) return null;

  return extrairMelhorOferta(
    melhor,
    centroDistribuicao
  );
}

module.exports = {
  buscarProduto
};
