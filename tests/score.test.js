const test = require("node:test");
const assert = require("node:assert/strict");
const { calcularPontuacao } = require("../core/score");

function produto(nome, ean = null) {
  return {
    productName: nome,
    items: [{ ean }]
  };
}

function deveVencer(busca, correto, incorreto, mensagem) {
  const scoreCorreto = calcularPontuacao(busca, correto, null);
  const scoreIncorreto = calcularPontuacao(busca, incorreto, null);

  assert.ok(
    scoreCorreto > scoreIncorreto,
    `${mensagem}. correto=${scoreCorreto}, incorreto=${scoreIncorreto}`
  );
}

test("Coca-Cola Zero 350ml vence Coca-Cola normal 350ml", () => {
  deveVencer(
    "REFRIGERANTE SEM AÇÚCAR COCA-COLA LATA 350ml",
    produto("Refrigerante Zero Açúcar Coca-Cola Lata 350ml", "7894900709841"),
    produto("Refrigerante Coca-Cola Original Lata 350ml", "7894900019841"),
    "Coca-Cola Zero deveria vencer"
  );
});

test("Coca-Cola 220ml vence Coca-Cola 350ml", () => {
  deveVencer(
    "REFRIGERANTE COCA-COLA LATA 220ml",
    produto("Refrigerante Coca-Cola Lata 220ml"),
    produto("Refrigerante Coca-Cola Lata 350ml"),
    "220ml deveria vencer 350ml"
  );
});

test("Açúcar União vence outra marca", () => {
  deveVencer(
    "AÇÚCAR REFINADO ESPECIAL UNIÃO PACOTE 1kg",
    produto("Açúcar Refinado União Pacote 1kg"),
    produto("Açúcar Refinado Caravelas Pacote 1kg"),
    "União deveria vencer Caravelas"
  );
});

test("Açúcar Caravelas vence União", () => {
  deveVencer(
    "AÇÚCAR REFINADO CARAVELAS 1kg",
    produto("Açúcar Refinado Caravelas Pacote 1kg"),
    produto("Açúcar Refinado União Pacote 1kg"),
    "Caravelas deveria vencer União"
  );
});

test("Feijão carioca vence feijão preto", () => {
  deveVencer(
    "FEIJÃO CARIOCA TIPO 1 BROTO LEGAL PACOTE 1kg",
    produto("Feijão Carioca Broto Legal Pacote 1kg"),
    produto("Feijão Preto Patéko Pacote 1kg"),
    "Feijão carioca deveria vencer feijão preto"
  );
});

test("Arroz integral 2kg vence arroz branco 5kg", () => {
  deveVencer(
    "ARROZ INTEGRAL TIO JOÃO TIPO 1 2kg",
    produto("Arroz Integral Tio João Tipo 1 2kg"),
    produto("Arroz Branco Tio João Tipo 1 5kg"),
    "Arroz integral 2kg deveria vencer arroz branco 5kg"
  );
});

test("Colgate Tripla Ação aceita palavras extras", () => {
  deveVencer(
    "CREME DENTAL COLGATE TRIPLA AÇÃO 90g",
    produto("Creme Dental Menta Original Tripla Ação Colgate Caixa 90g"),
    produto("Creme Dental Oral-B 3D White 90g"),
    "Colgate deveria vencer Oral-B"
  );
});

test("Leite semidesnatado vence integral", () => {
  deveVencer(
    "LEITE UHT SEMIDESNATADO ITALAC 1L",
    produto("Leite Longa Vida Italac Semi Desnatado com Tampa 1L"),
    produto("Leite Italac Integral com Tampa 1L"),
    "Semidesnatado deveria vencer integral"
  );
});

test("EAN exato recebe prioridade absoluta", () => {
  const ean = "7894900709841";

  const scoreExato = calcularPontuacao(
    "REFRIGERANTE COCA-COLA ZERO 350ml",
    produto("Refrigerante Coca-Cola Zero Lata 350ml", ean),
    ean
  );

  const scoreOutro = calcularPontuacao(
    "REFRIGERANTE COCA-COLA ZERO 350ml",
    produto("Refrigerante Coca-Cola Zero Lata 350ml", "0000000000000"),
    ean
  );

  assert.equal(scoreExato, 10000);
  assert.ok(scoreExato > scoreOutro);
});

test("Arroz Vasconcelos vence Arroz Patéko mesmo com o mesmo peso", () => {
  deveVencer(
    "ARROZ AGULHINHA VASCONCELOS 2kg TIPO 1",
    produto("Arroz Agulhinha Vasconcelos 2kg Tpo 1", "7898949924555"),
    produto("Arroz Patéko Pacote 2kg", "7896086419842"),
    "Vasconcelos deveria vencer Patéko"
  );
});

