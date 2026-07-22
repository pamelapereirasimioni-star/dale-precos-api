const { normalizarTexto } = require("../utils/texto");

function classificarProduto(texto) {
    const t = normalizarTexto(texto);

    const dados = {
        categoria: null,
        subtipo: null,
        marca: null,
        peso: null,
        atributos: []
    };

    // =====================
    // CATEGORIAS
    // =====================

    if (t.includes("leite")) dados.categoria = "leite";
    else if (t.includes("creme de leite")) dados.categoria = "creme_leite";
    else if (t.includes("requeijao")) dados.categoria = "requeijao";
    else if (t.includes("manteiga")) dados.categoria = "manteiga";
    else if (t.includes("arroz")) dados.categoria = "arroz";
    else if (t.includes("feijao")) dados.categoria = "feijao";
    else if (t.includes("macarrao")) dados.categoria = "macarrao";
    else if (t.includes("oleo")) dados.categoria = "oleo";
    else if (t.includes("acucar")) dados.categoria = "acucar";
    else if (t.includes("cafe")) dados.categoria = "cafe";
    else if (t.includes("refrigerante")) dados.categoria = "refrigerante";

    // =====================
    // SUBTIPOS
    // =====================

    if (t.includes("arboreo")) dados.subtipo = "arboreo";
    if (t.includes("integral")) dados.subtipo = "integral";
    if (t.includes("desnatado")) dados.subtipo = "desnatado";
    if (t.includes("semidesnatado")) dados.subtipo = "semidesnatado";
    if (t.includes("zero lactose")) dados.subtipo = "zero_lactose";
    if (t.includes("tipo 1")) dados.subtipo = "tipo1";

    // =====================
    // MARCAS
    // =====================

    const marcas = [
        "piracanjuba",
        "italac",
        "camil",
        "tio joao",
        "renata",
        "pilao",
        "liza",
        "uniao",
        "aviacao",
        "coca cola"
    ];

    for (const marca of marcas) {
        if (t.includes(marca)) {
            dados.marca = marca;
            break;
        }
    }

    return dados;
}

module.exports = {
    classificarProduto
};