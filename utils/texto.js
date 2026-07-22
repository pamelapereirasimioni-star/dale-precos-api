/**
 * Remove acentos, caracteres especiais e padroniza espaços.
 */
function normalizarTexto(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['"`´]/g, "")
    .replace(/[(){}\[\]]/g, " ")
    .replace(/[.,;:+\-_/\\]/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Remove palavras que não ajudam a identificar
 * o produto.
 */
function limparNomeBusca(nome) {
  let texto = normalizarTexto(nome);

  const remover = [
    "embalagem",
    "pacote",
    "pacotes",
    "garrafa",
    "garrafa pet",
    "pet",
    "caixa",
    "caixinha",
    "uht",
    "longa vida",
    "especial",
    "especiais",
    "tradicional",
    "unidade",
    "unidades",
    "pct",
    "cx",
    "tipo"
  ];

  for (const palavra of remover) {
    const regex = new RegExp(`\\b${palavra}\\b`, "g");
    texto = texto.replace(regex, " ");
  }

  /*
   * Remove "tipo 1", "tipo 2" etc.
   */
  texto = texto.replace(
    /\btipo\s+\d+\b/g,
    " "
  );

  /*
   * Padroniza algumas expressões.
   */
  texto = texto
    .replace(/\bcoca cola\b/g, "coca-cola")
    .replace(/\bcoca cola zero\b/g, "coca-cola zero")
    .replace(/\bsemi desnatado\b/g, "semidesnatado")
    .replace(/\bzero acucar\b/g, "zero açúcar")
    .replace(/\bsem acucar\b/g, "zero açúcar")
    .replace(/\bpatéko\b/g, "pateko");

  return texto
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Divide o texto em palavras úteis.
 */
function quebrarPalavras(texto) {
  return limparNomeBusca(texto)
    .split(" ")
    .map((palavra) => palavra.trim())
    .filter((palavra) => palavra.length > 1);
}

/**
 * Remove palavras repetidas.
 */
function removerDuplicadas(texto) {
  return [...new Set(quebrarPalavras(texto))]
    .join(" ")
    .trim();
}

/**
 * Verifica se uma expressão existe como palavra inteira.
 */
function contemExpressao(texto, expressao) {
  const t = ` ${normalizarTexto(texto)} `;
  const e = ` ${normalizarTexto(expressao)} `;

  return t.includes(e);
}

module.exports = {
  normalizarTexto,
  limparNomeBusca,
  quebrarPalavras,
  removerDuplicadas,
  contemExpressao
};