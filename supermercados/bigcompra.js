const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SECRET_KEY = String(process.env.SUPABASE_SECRET_KEY || "").trim();

function hojeEmSaoPaulo() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const mapa = {};

  for (const parte of partes) {
    if (parte.type !== "literal") {
      mapa[parte.type] = parte.value;
    }
  }

  return `${mapa.year}-${mapa.month}-${mapa.day}`;
}

function cabecalhosSupabase() {
  return {
    apikey: SUPABASE_SECRET_KEY,
    Accept: "application/json"
  };
}

async function consultarSupabase(caminho) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error(
      "Big Compra: SUPABASE_URL ou SUPABASE_SECRET_KEY não configurado."
    );
  }

  const resposta = await fetch(
    `${SUPABASE_URL}/rest/v1/${caminho}`,
    {
      method: "GET",
      headers: cabecalhosSupabase()
    }
  );

  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(() => "");

    throw new Error(
      `Big Compra: erro Supabase ${resposta.status}${
        detalhe ? ` - ${detalhe}` : ""
      }`
    );
  }

  return resposta.json();
}

function numeroPositivo(valor) {
  const numero = Number(valor);

  return Number.isFinite(numero) && numero > 0
    ? numero
    : null;
}

function precoComparavel(oferta) {
  if (!oferta || typeof oferta !== "object") {
    return null;
  }

  if (oferta.tipo_oferta === "combo") {
    const unitario = numeroPositivo(
      oferta.preco_unitario_equivalente
    );

    if (unitario) {
      return unitario;
    }

    const quantidade = numeroPositivo(
      oferta.quantidade_combo
    );
    const totalCombo = numeroPositivo(
      oferta.preco_combo
    );

    if (quantidade && totalCombo) {
      return Number((totalCombo / quantidade).toFixed(2));
    }
  }

  return numeroPositivo(oferta.preco_oferta);
}

function criarRotuloOferta(oferta, preco) {
  if (!oferta) {
    return null;
  }

  if (oferta.tipo_oferta === "combo") {
    const quantidade = numeroPositivo(
      oferta.quantidade_combo
    );
    const total = numeroPositivo(oferta.preco_combo);

    if (quantidade && total) {
      return `Combo 10zão • leve ${quantidade} por R$ ${total
        .toFixed(2)
        .replace(".", ",")}`;
    }

    return "Combo 10zão";
  }

  if (oferta.tipo_oferta === "vantagens") {
    return "Preço Big Compra Vantagens";
  }

  if (preco) {
    return "Oferta Big Compra";
  }

  return null;
}

function escolherMelhorOferta(ofertas) {
  if (!Array.isArray(ofertas) || ofertas.length === 0) {
    return null;
  }

  const candidatas = ofertas
    .map((oferta) => ({
      oferta,
      preco: precoComparavel(oferta)
    }))
    .filter(
      (item) =>
        Number.isFinite(item.preco) &&
        item.preco > 0
    )
    .sort((a, b) => a.preco - b.preco);

  return candidatas[0] || null;
}

async function buscarProduto(termoBusca, eanBuscado) {
  const ean = String(eanBuscado || "").trim();

  // No Big Compra, só aceitamos correspondência exata por EAN.
  if (!ean) {
    return null;
  }

  const produtos = await consultarSupabase(
    `bigcompra_produtos?select=id,ean,nome,marca,variante,embalagem,nome_bigcompra,status&ean=eq.${encodeURIComponent(
      ean
    )}&status=eq.validado&limit=1`
  );

  if (!Array.isArray(produtos) || produtos.length === 0) {
    return null;
  }

  const produto = produtos[0];
  const hoje = hojeEmSaoPaulo();

  const ofertas = await consultarSupabase(
    `bigcompra_ofertas?select=id,produto_id,ean,tipo_oferta,preco_normal,preco_oferta,quantidade_combo,preco_combo,preco_unitario_equivalente,limite_quantidade,limite_tipo,inicio_validade,fim_validade,cidade,estado,fonte,fonte_url,descricao_original,observacoes,created_at&ean=eq.${encodeURIComponent(
      ean
    )}&inicio_validade=lte.${hoje}&fim_validade=gte.${hoje}&order=created_at.desc&limit=20`
  );

  const melhor = escolherMelhorOferta(ofertas);

  if (!melhor) {
    return null;
  }

  const oferta = melhor.oferta;
  const price = melhor.preco;
  const listPrice = numeroPositivo(oferta.preco_normal);

  return {
    supermarketId: "bigcompra",
    productName:
      produto.nome_bigcompra ||
      produto.nome ||
      termoBusca ||
      ean,
    ean: produto.ean || ean,
    price,
    listPrice,
    available: true,
    itemId: oferta.id ? String(oferta.id) : null,
    sellerId: "bigcompra-ribeirao-preto",
    image: null,
    url: oferta.fonte_url || null,
    lastUpdate: new Date().toISOString(),

    offerType: oferta.tipo_oferta || null,
    offerLabel: criarRotuloOferta(oferta, price),
    comboQuantity:
      numeroPositivo(oferta.quantidade_combo),
    comboPrice:
      numeroPositivo(oferta.preco_combo),
    unitEquivalentPrice:
      oferta.tipo_oferta === "combo"
        ? price
        : null,
    limitQuantity:
      numeroPositivo(oferta.limite_quantidade),
    limitType: oferta.limite_tipo || null,
    validFrom: oferta.inicio_validade || null,
    validUntil: oferta.fim_validade || null,
    offerSource: oferta.fonte || null,
    city: oferta.cidade || "Ribeirão Preto",
    state: oferta.estado || "SP"
  };
}

module.exports = {
  buscarProduto
};
