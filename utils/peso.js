const { normalizarTexto } = require("./texto");

/**
 * Extrai peso ou volume e converte para uma unidade padrão.
 *
 * Peso:
 * g  -> gramas
 * kg -> gramas
 *
 * Volume:
 * ml -> mililitros
 * l  -> mililitros
 *
 * Exemplos:
 * 500 g  -> 500
 * 1 kg   -> 1000
 * 750 g  -> 750
 * 1 l    -> 1000
 * 2 l    -> 2000
 * 900 ml -> 900
 */
function extrairPeso(texto) {
  const normalizado = normalizarTexto(texto);

  const regex = /(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i;

  const match = normalizado.match(regex);

  if (!match) {
    return null;
  }

  let valor = parseFloat(
    match[1].replace(",", ".")
  );

  const unidade = match[2].toLowerCase();

  switch (unidade) {
    case "kg":
      valor *= 1000;
      break;

    case "g":
      break;

    case "l":
      valor *= 1000;
      break;

    case "ml":
      break;

    default:
      return null;
  }

  return Math.round(valor);
}

/**
 * Apenas para exibição.
 *
 * Exemplo:
 * 1000 -> 1 kg
 * 500 -> 500 g
 */
function formatarPeso(valor) {
  if (valor == null) {
    return null;
  }

  if (valor >= 1000) {
    return `${valor / 1000} kg`;
  }

  return `${valor} g`;
}

/**
 * Compara dois pesos usando tolerância percentual.
 *
 * Exemplo:
 * 1000 x 1000 -> true
 * 995 x 1000 -> true
 * 900 x 1000 -> false
 */
function pesosIguais(
  peso1,
  peso2,
  tolerancia = 0.02
) {
  if (
    peso1 == null ||
    peso2 == null
  ) {
    return false;
  }

  const diferenca = Math.abs(
    peso1 - peso2
  );

  return (
    diferenca <=
    Math.max(5, peso1 * tolerancia)
  );
}

module.exports = {
  extrairPeso,
  formatarPeso,
  pesosIguais
};