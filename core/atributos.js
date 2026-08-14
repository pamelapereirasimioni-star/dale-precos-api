function normalizarTexto(valor) {
  return String(valor || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contemTermo(texto, termo) {
  const t = ` ${normalizarTexto(texto)} `;
  const alvo = ` ${normalizarTexto(termo)} `;
  return t.includes(alvo);
}

function extrairPeso(texto) {
  const t = normalizarTexto(texto);

  const match = t.match(
    /(\d+(?:[.,]\d+)?)\s*(kg|g|mg|ml|l)\b/
  );

  if (!match) {
    return null;
  }

  const quantidade = Number(
    String(match[1]).replace(",", ".")
  );

  if (!Number.isFinite(quantidade)) {
    return null;
  }

  const unidade = match[2];

  switch (unidade) {
    case "kg":
      return quantidade * 1000;
    case "g":
      return quantidade;
    case "mg":
      return quantidade / 1000;
    case "l":
      return quantidade * 1000;
    case "ml":
      return quantidade;
    default:
      return null;
  }
}

/**
 * Detecta quantidade de unidades/multipack.
 *
 * Exemplos:
 * 3x90g           -> 3
 * 3 x 90g         -> 3
 * 6 unidades      -> 6
 * pack 4          -> 4
 * leve 6 pague 5  -> 6
 * 500ml com 6     -> 6
 */
function extrairQuantidadeUnidades(texto) {
  const t = normalizarTexto(texto);

  let match = t.match(
    /\b(\d{1,2})\s*x\s*\d+(?:[.,]\d+)?\s*(?:kg|g|mg|ml|l)\b/
  );

  if (match) {
    return Number(match[1]);
  }

  match = t.match(
    /\b(\d{1,2})\s*(?:unidades|unidade|unds|und|un)\b/
  );

  if (match) {
    return Number(match[1]);
  }

  match = t.match(
    /\b(?:pack|pacote|kit)\s*(?:com\s*)?(\d{1,2})\b/
  );

  if (match) {
    return Number(match[1]);
  }

  match = t.match(
    /\bleve\s*(\d{1,2})\b/
  );

  if (match) {
    return Number(match[1]);
  }

  /*
   * Exemplos:
   * "Detergente Ypê Clear 500ml com 6"
   * "500ml c/ 6"
   */
  match = t.match(
    /\b\d+(?:[.,]\d+)?\s*(?:kg|g|mg|ml|l)\s*(?:com|c)\s*(\d{1,2})\b/
  );

  if (match) {
    return Number(match[1]);
  }

  /*
   * Exemplos:
   * "com 6 unidades"
   * "com 6"
   */
  match = t.match(
    /\bcom\s*(\d{1,2})(?:\s*(?:unidades|unidade|unds|und|un))?\b/
  );

  if (match) {
    return Number(match[1]);
  }

  return 1;
}

const MARCAS = [
  // Leites e laticínios
  ["piracanjuba", "piracanjuba"],
  ["italac", "italac"],
  ["itambe", "itambe"],
  ["lider", "lider"],
  ["mococa", "mococa"],
  ["hercules", "hercules"],
  ["parmalat", "parmalat"],
  ["jussara", "jussara"],
  ["nilza", "nilza"],
  ["letti", "letti"],
  ["leti", "leti"],

  // Arroz, feijão, açúcar e mercearia
  ["prato fino", "prato fino"],
  ["tio joao", "tio joao"],
  ["camil", "camil"],
  ["broto legal", "broto legal"],
  ["emporio sao joao", "emporio sao joao"],
  ["serrazul", "serrazul"],
  ["serra azul", "serrazul"],
  ["4r", "4r"],
  ["solito", "solito"],
  ["denadai", "denadai"],
  ["ubirama", "ubirama"],
  ["vasconcelos", "vasconcelos"],
  ["carunchao", "carunchao"],
  ["pateko", "pateko"],
  ["zorzo", "zorzo"],
  ["caravelas", "caravelas"],
  ["uniao", "uniao"],
  ["guarani", "guarani"],
  ["native", "native"],
  ["santa isabel", "santa isabel"],
  ["7 povos", "7 povos"],

  // Cafés
  ["3 coracoes", "3 coracoes"],
  ["tres coracoes", "3 coracoes"],
  ["la sante", "la sante"],
  ["lasante", "la sante"],
  ["melitta", "melitta"],
  ["caboclo", "caboclo"],
  ["pilao", "pilao"],
  ["cafe pele", "pele"],
  ["pele", "pele"],
  ["brasileiro", "brasileiro"],
  ["fort", "fort"],
  ["lor", "lor"],

  // Refrigerantes
  ["coca cola", "coca cola"],
  ["coca-cola", "coca cola"],
  ["guarana antarctica", "guarana antarctica"],
  ["antarctica", "antarctica"],
  ["pepsi", "pepsi"],
  ["sprite", "sprite"],
  ["fanta", "fanta"],
  ["itubaina", "itubaina"],

  // Limpeza
  ["triex", "triex"],
  ["ype", "ype"],
  ["limpol", "limpol"],
  ["minuano", "minuano"],
  ["omo", "omo"],
  ["tixan", "tixan"],
  ["surf", "surf"],
  ["brilhante", "brilhante"],
  ["ala", "ala"],
  ["urca", "urca"],

  // Higiene
  ["colgate", "colgate"],
  ["oral b", "oral b"],
  ["oral-b", "oral b"],
  ["closeup", "closeup"],
  ["close up", "closeup"],
  ["sensodyne", "sensodyne"],
  ["sorriso", "sorriso"],

  // Papel higiênico
  ["neve", "neve"],
  ["personal", "personal"],
  ["mili", "mili"],
  ["duetto", "duetto"],
  ["familiar", "familiar"],
  ["cotton", "cotton"],

  ["renata", "renata"],
  ["liza", "liza"],
  ["aviacao", "aviacao"]
];

function detectarMarca(texto) {
  const t = normalizarTexto(texto);

  for (const [alias, canonica] of MARCAS) {
    if (contemTermo(t, alias)) {
      return canonica;
    }
  }

  return null;
}

function detectarCategoria(texto) {
  const t = normalizarTexto(texto);

  if (contemTermo(t, "papel higienico")) {
    return "papel higienico";
  }

  if (contemTermo(t, "creme dental")) {
    return "creme dental";
  }

  if (
    contemTermo(t, "sabao em po") ||
    (t.includes("lava roupas") && contemTermo(t, "po"))
  ) {
    return "sabao em po";
  }

  if (
    contemTermo(t, "detergente") ||
    t.includes("lava loucas")
  ) {
    return "detergente";
  }

  if (
    contemTermo(t, "refrigerante") ||
    t.includes("coca cola") ||
    contemTermo(t, "pepsi") ||
    contemTermo(t, "sprite") ||
    contemTermo(t, "fanta") ||
    t.includes("guarana antarctica")
  ) {
    return "refrigerante";
  }

  if (contemTermo(t, "leite")) return "leite";
  if (contemTermo(t, "oleo")) return "oleo";
  if (contemTermo(t, "feijao")) return "feijao";
  if (contemTermo(t, "arroz")) return "arroz";
  if (contemTermo(t, "cafe")) return "cafe";
  if (contemTermo(t, "macarrao")) return "macarrao";
  if (contemTermo(t, "acucar")) return "acucar";
  if (contemTermo(t, "manteiga")) return "manteiga";
  if (contemTermo(t, "requeijao")) return "requeijao";

  return null;
}

function adicionarFlag(flags, flag) {
  if (!flags.includes(flag)) {
    flags.push(flag);
  }
}

function detectarFlags(texto) {
  const t = normalizarTexto(texto);
  const flags = [];

  if (
    t.includes("semidesnatado") ||
    t.includes("semi desnatado")
  ) {
    adicionarFlag(flags, "semidesnatado");
  } else if (contemTermo(t, "desnatado")) {
    adicionarFlag(flags, "desnatado");
  } else if (contemTermo(t, "integral")) {
    adicionarFlag(flags, "integral");
  }

  if (
    t.includes("zero lactose") ||
    t.includes("sem lactose")
  ) {
    adicionarFlag(flags, "zero lactose");
  }

  if (t.includes("com lactose")) {
    adicionarFlag(flags, "com lactose");
  }

  if (
    contemTermo(t, "protein") ||
    contemTermo(t, "proteina")
  ) {
    adicionarFlag(flags, "protein");
  }

  if (contemTermo(t, "a2")) {
    adicionarFlag(flags, "a2");
  }

  for (const tipo of [
    "carioca",
    "preto",
    "branco",
    "rajado",
    "fradinho"
  ]) {
    if (contemTermo(t, tipo)) {
      adicionarFlag(flags, tipo);
    }
  }

  if (contemTermo(t, "parboilizado")) {
    adicionarFlag(flags, "parboilizado");
  }

  if (/\btipo\s*1\b/.test(t)) {
    adicionarFlag(flags, "tipo 1");
  }

  if (/\btipo\s*2\b/.test(t)) {
    adicionarFlag(flags, "tipo 2");
  }

  for (const tipo of [
    "refinado",
    "cristal",
    "demerara",
    "mascavo",
    "organico"
  ]) {
    if (contemTermo(t, tipo)) {
      adicionarFlag(flags, tipo);
    }
  }

  for (const tipo of ["girassol", "soja"]) {
    if (contemTermo(t, tipo)) {
      adicionarFlag(flags, tipo);
    }
  }

  for (const formato of [
    "espaguete",
    "penne",
    "parafuso"
  ]) {
    if (contemTermo(t, formato)) {
      adicionarFlag(flags, formato);
    }
  }

  if (contemTermo(t, "diet")) adicionarFlag(flags, "diet");
  if (contemTermo(t, "light")) adicionarFlag(flags, "light");

  if (
    contemTermo(t, "zero") &&
    !t.includes("zero lactose")
  ) {
    adicionarFlag(flags, "zero");
  }

  if (t.includes("sem sal")) adicionarFlag(flags, "sem sal");
  if (t.includes("com sal")) adicionarFlag(flags, "com sal");

  if (contemTermo(t, "soluvel")) adicionarFlag(flags, "soluvel");
  if (contemTermo(t, "descafeinado")) adicionarFlag(flags, "descafeinado");
  if (contemTermo(t, "tradicional")) adicionarFlag(flags, "tradicional");

  if (
    t.includes("extra forte") ||
    t.includes("extraforte")
  ) {
    adicionarFlag(flags, "extra forte");
  }

  if (t.includes("extra virgem")) {
    adicionarFlag(flags, "extra virgem");
  }

  return flags;
}

function detectarVariante(texto) {
  const t = normalizarTexto(texto);

  const variantes = [
    ["anti tartaro", "anti tartaro"],
    ["antitartaro", "anti tartaro"],
    ["advanced fresh", "advanced fresh"],
    ["whitening", "whitening"],
    ["branqueador", "whitening"],
    ["tripla acao", "tripla acao"],
    ["total 12", "total 12"],
    ["titanium", "titanium"],
    ["menta", "menta"],
    ["hortela", "menta"],
    ["coco", "coco"],
    ["clear", "clear"],
    ["maca", "maca"],
    ["neutro", "neutro"],
    ["limao", "limao"],
    ["tradicional", "tradicional"],
    ["extra forte", "extra forte"],
    ["extraforte", "extra forte"]
  ];

  for (const [alias, canonica] of variantes) {
    if (contemTermo(t, alias)) {
      return canonica;
    }
  }

  return null;
}

function detectarAtributos(texto) {
  const flags = detectarFlags(texto);

  return {
    categoria: detectarCategoria(texto),
    tipo: flags[0] || null,
    marca: detectarMarca(texto),
    peso: extrairPeso(texto),
    quantidadeUnidades: extrairQuantidadeUnidades(texto),
    variante: detectarVariante(texto),
    flags
  };
}

module.exports = {
  detectarAtributos,
  detectarMarca,
  detectarCategoria,
  detectarFlags,
  detectarVariante,
  extrairPeso,
  extrairQuantidadeUnidades,
  normalizarTexto
};
