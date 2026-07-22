function criarProduto({
    supermarketId,
    productName,
    ean,
    itemId,
    price,
    listPrice,
    available,
    image,
    url,
    sellerId
}) {
    return {
        supermarketId,
        productName,
        ean,
        itemId,
        sellerId,
        price,
        listPrice,
        available,
        image,
        url,
        lastUpdate: new Date().toISOString()
    };
}

module.exports = {
    criarProduto
};