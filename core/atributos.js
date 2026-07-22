const { normalizarTexto } = require("../utils/texto");
const { extrairPeso } = require("../utils/peso");

/**
 * Verifica se o texto contém uma expressão completa.
 *
 * Isso evita confusões como:
 * "sal" dentro de outra palavra ou
 * "l" dentro de "leite".
 */
function contemExpressao(texto, expressao) {
  const textoNormalizado = ` ${normalizarTexto(texto)} `;
  const expressaoNormalizada = ` ${normalizarTexto(expressao)} `;

  return textoNormalizado.includes(expressaoNormalizada);
}

/**
 * Detecta a categoria principal do produto.
 */
function detectarCategoria(texto) {
  const categorias = [
    {
      nome: "leite",
      termos: [
        "leite",
        "bebida lactea"
      ]
    },
    {
      nome: "oleo",
      termos: [
        "oleo"
      ]
    },
    {
      nome: "feijao",
      termos: [
        "feijao"
      ]
    },
    {
      nome: "arroz",
      termos: [
        "arroz"
      ]
    },
    {
      nome: "refrigerante",
      termos: [
        "refrigerante",
        "coca cola",
        "coca-cola",
        "guarana",
        "soda"
      ]
    },
    {
      nome: "macarrao",
      termos: [
        "macarrao",
        "massa alimenticia"
      ]
    },
    {
      nome: "acucar",
      termos: [
        "acucar"
      ]
    },
    {
      nome: "manteiga",
      termos: [
        "manteiga"
      ]
    },
    {
      nome: "margarina",
      termos: [
        "margarina"
      ]
    },
    {
      nome: "requeijao",
      termos: [
        "requeijao"
      ]
    },
    {
      nome: "cafe",
      termos: [
        "cafe"
      ]
    },
    {
      nome: "farinha",
      termos: [
        "farinha"
      ]
    },
    {
      nome: "biscoito",
      termos: [
        "biscoito",
        "bolacha"
      ]
    },
    {
      nome: "achocolatado",
      termos: [
        "achocolatado"
      ]
    },
    {
      nome: "molho",
      termos: [
        "molho"
      ]
    },
    {
      nome: "extrato de tomate",
      termos: [
        "extrato de tomate"
      ]
    },
    {
      nome: "creme de leite",
      termos: [
        "creme de leite"
      ]
    },
    {
      nome: "leite condensado",
      termos: [
        "leite condensado"
      ]
    }
  ];

  /*
   * Categorias mais específicas precisam ser verificadas
   * antes das categorias genéricas.
   */
  const categoriasEspecificas = [
    {
      nome: "leite condensado",
      termos: ["leite condensado"]
    },
    {
      nome: "creme de leite",
      termos: ["creme de leite"]
    },
    {
      nome: "extrato de tomate",
      termos: ["extrato de tomate"]
    },
    ...categorias
  ];

  for (const categoria of categoriasEspecificas) {
    const encontrou = categoria.termos.some((termo) =>
      contemExpressao(texto, termo)
    );

    if (encontrou) {
      return categoria.nome;
    }
  }

  return null;
}

/**
 * Detecta a marca e devolve sempre o nome padronizado.
 *
 * Exemplo:
 * "coca-cola" e "coca cola" viram "coca cola".
 */
function detectarMarca(texto) {
  const marcas = [
    {
      nome: "piracanjuba",
      termos: ["piracanjuba"]
    },
    {
      nome: "italac",
      termos: ["italac"]
    },
    {
      nome: "camil",
      termos: ["camil"]
    },
    {
      nome: "tio joao",
      termos: ["tio joao"]
    },
    {
      nome: "pilao",
      termos: ["pilao"]
    },
    {
      nome: "renata",
      termos: ["renata"]
    },
    {
      nome: "liza",
      termos: ["liza"]
    },
    {
      nome: "uniao",
      termos: ["uniao"]
    },
    {
      nome: "aviacao",
      termos: ["aviacao"]
    },
    {
      nome: "coca cola",
      termos: [
        "coca cola",
        "coca-cola"
      ]
    },
    {
      nome: "pateko",
      termos: [
        "pateko",
        "patéko"
      ]
    },
    {
      nome: "vapza",
      termos: ["vapza"]
    },
    {
      nome: "broto legal",
      termos: ["broto legal"]
    },
    {
      nome: "emporio sao joao",
      termos: ["emporio sao joao"]
    },
    {
      nome: "solito",
      termos: ["solito"]
    },
    {
      nome: "denadai",
      termos: ["denadai"]
    },
    {
      nome: "serralat",
      termos: ["serralat"]
    },
    {
      nome: "xando",
      termos: ["xando"]
    },
    {
      nome: "itambe",
      termos: ["itambe"]
    },
    {
      nome: "parmalat",
      termos: ["parmalat"]
    },
    {
      nome: "jussara",
      termos: ["jussara"]
    },
    {
      nome: "ninho",
      termos: ["ninho"]
    },
    {
      nome: "nestle",
      termos: ["nestle"]
    },
    {
      nome: "moca",
      termos: ["moca"]
    },
    {
      nome: "moça",
      termos: ["moça"]
    },
    {
      nome: "itambe",
      termos: ["itambe"]
    },
    {
      nome: "qualy",
      termos: ["qualy"]
    },
    {
      nome: "delicia",
      termos: ["delicia"]
    },
    {
      nome: "primor",
      termos: ["primor"]
    },
    {
      nome: "dona benta",
      termos: ["dona benta"]
    },
    {
      nome: "yoki",
      termos: ["yoki"]
    },
    {
      nome: "predilecta",
      termos: ["predilecta"]
    },
    {
      nome: "quero",
      termos: ["quero"]
    },
    {
      nome: "heinz",
      termos: ["heinz"]
    },
    {
      nome: "bauducco",
      termos: ["bauducco"]
    },
    {
      nome: "piraque",
      termos: ["piraque"]
    },
    {
      nome: "trakinas",
      termos: ["trakinas"]
    },
    {
      nome: "toddy",
      termos: ["toddy"]
    },
    {
      nome: "nescau",
      termos: ["nescau"]
    }
  ];

  /*
   * Marcas compostas devem ser verificadas primeiro.
   */
  const marcasOrdenadas = [...marcas].sort(
    (a, b) => b.nome.length - a.nome.length
  );

  for (const marca of marcasOrdenadas) {
    const encontrou = marca.termos.some((termo) =>
      contemExpressao(texto, termo)
    );

    if (encontrou) {
      return normalizarTexto(marca.nome);
    }
  }

  return null;
}

/**
 * Detecta características importantes do produto.
 *
 * As flags são padronizadas para evitar duplicidade:
 * "semi desnatado" e "semidesnatado"
 * sempre viram "semidesnatado".
 */
function detectarFlags(texto) {
  const gruposFlags = [
    {
      nome: "integral",
      termos: ["integral"]
    },
    {
      nome: "semidesnatado",
      termos: [
        "semidesnatado",
        "semi desnatado"
      ]
    },
    {
      nome: "desnatado",
      termos: ["desnatado"]
    },
    {
      nome: "zero lactose",
      termos: [
        "zero lactose",
        "sem lactose"
      ]
    },
    {
      nome: "com lactose",
      termos: [
        "com lactose"
      ]
    },
    {
      nome: "protein",
      termos: [
        "protein",
        "proteina",
        "proteico"
      ]
    },
    {
      nome: "a2",
      termos: [
        "a2"
      ]
    },
    {
      nome: "girassol",
      termos: [
        "girassol"
      ]
    },
    {
      nome: "soja",
      termos: [
        "soja"
      ]
    },
    {
      nome: "carioca",
      termos: [
        "carioca"
      ]
    },
    {
      nome: "preto",
      termos: [
        "preto"
      ]
    },
    {
      nome: "branco",
      termos: [
        "branco"
      ]
    },
    {
      nome: "rajado",
      termos: [
        "rajado"
      ]
    },
    {
      nome: "fradinho",
      termos: [
        "fradinho"
      ]
    },
    {
      nome: "parboilizado",
      termos: [
        "parboilizado"
      ]
    },
    {
      nome: "tipo 1",
      termos: [
        "tipo 1",
        "tipo i"
      ]
    },
    {
      nome: "tipo 2",
      termos: [
        "tipo 2",
        "tipo ii"
      ]
    },
    {
      nome: "espaguete",
      termos: [
        "espaguete",
        "spaghetti"
      ]
    },
    {
      nome: "penne",
      termos: [
        "penne"
      ]
    },
    {
      nome: "parafuso",
      termos: [
        "parafuso",
        "fusilli"
      ]
    },
    {
      nome: "zero",
      termos: [
        "zero"
      ]
    },
    {
      nome: "diet",
      termos: [
        "diet"
      ]
    },
    {
      nome: "light",
      termos: [
        "light"
      ]
    },
    {
      nome: "sem sal",
      termos: [
        "sem sal"
      ]
    },
    {
      nome: "com sal",
      termos: [
        "com sal"
      ]
    },
    {
      nome: "tradicional",
      termos: [
        "tradicional"
      ]
    },
    {
      nome: "extra virgem",
      termos: [
        "extra virgem"
      ]
    },
    {
      nome: "soluvel",
      termos: [
        "soluvel"
      ]
    },
    {
      nome: "descafeinado",
      termos: [
        "descafeinado"
      ]
    }
  ];

  const flags = [];

  for (const grupo of gruposFlags) {
    const encontrou = grupo.termos.some((termo) =>
      contemExpressao(texto, termo)
    );

    if (encontrou && !flags.includes(grupo.nome)) {
      flags.push(grupo.nome);
    }
  }

  /*
   * Se existe "zero lactose", não adicionamos a flag
   * genérica "zero", pois seria redundante.
   */
  if (
    flags.includes("zero lactose") &&
    flags.includes("zero")
  ) {
    flags.splice(flags.indexOf("zero"), 1);
  }

  return flags;
}

/**
 * Detecta todos os atributos importantes do texto.
 */
function detectarAtributos(texto) {
  const textoNormalizado = normalizarTexto(texto);

  return {
    categoria: detectarCategoria(textoNormalizado),
    marca: detectarMarca(textoNormalizado),
    peso: extrairPeso(textoNormalizado),
    flags: detectarFlags(textoNormalizado)
  };
}

module.exports = {
  detectarAtributos,
  detectarCategoria,
  detectarMarca,
  detectarFlags
};