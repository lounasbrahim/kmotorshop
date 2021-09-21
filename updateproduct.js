const fs = require("fs");
const axios = require("axios");
const { resolve } = require("path");
const winston = require("winston");
require("dotenv").config();

const shopify_username = process.env.shopify_username;
const shopify_password = process.env.shopify_password;
const kmotorshop_username = process.env.kmotorshop_username;
const kmotorshop_password = process.env.kmotorshop_password;

var myFormat = winston.format.combine(
    winston.format.timestamp({
        format: "YYYY-MM-DD HH:mm:ss",
    }),
    winston.format.json()
);

const logger = winston.createLogger({
    level: "info",
    format: myFormat,
    transports: [
        new winston.transports.File({ filename: "error.log", level: "error" }),
        new winston.transports.File({ filename: "infos.log" }),
    ],
});

if (process.env.NODE_ENV !== "production") {
    logger.add(
        new winston.transports.Console({
            format: winston.format.simple(),
        })
    );
}

(async() => {
    let script_conf = await readFileSync("update.json");
    script_conf = JSON.parse(script_conf);

    if (script_conf.all_product_listed) {
        logger.info(`Tout les produits ont été déja listé`);
    } else {
        await listShopifyProducts();
    }

    await updatePriceAndQuantity();

    let script_json_data = {
        all_product_listed: false,
        last_file: 0,
        last_product: 0,
    };
    await writeJsonFile("update.json", script_json_data);
})();

async function listShopifyProducts() {
    shopify_get_url = `https://tpm-ram.myshopify.com/admin/api/2021-07/products.json?fields=id,title,variants&limit=250`;
    let i = 1;
    while (true) {
        let product_response = await getShopifyPageProducts(shopify_get_url);

        let products = await product_response.data.products;

        let next_link = await getNextLink(product_response);

        if (next_link !== "") {
            writeJsonFile(
                `products-shopify/json/product-shopify-${i}.json`,
                products
            );
            shopify_get_url = next_link;

            i++;
        } else {
            break;
        }
    }
}

async function updatePriceAndQuantity() {
    let product_arr = [];
    let location_id = "34779529269";
    let quantity = 0;

    let dirPath = resolve(__dirname, "products-shopify/json");
    let files = fs.readdirSync(dirPath);

    let script_conf = await readFileSync("update.json");
    script_conf = JSON.parse(script_conf);

    let i = script_conf.last_file;

    while (i < files.length) {
        logger.info(`Tout les produits ont été déja listé`);
        "Reading file : ", files[i];
        let prodcuts = await readFileSync(`products-shopify/json/${files[i]}`);
        products = JSON.parse(prodcuts);

        products.map((el) => {
            let product = {
                id: el.variants[0].id,
                price: el.variants[0].price,
                code: el.variants[0].sku,
                inventory_item_id: el.variants[0].inventory_item_id,
            };
            product_arr.push(product);
        });

        let script_conf = (await readFileSync("update.json")).toString();
        script_conf = JSON.parse(script_conf);

        let product_index = script_conf.last_product;

        while (product_index < product_arr.length) {
            logger.info(`iteration produit: ${product_index}`);
            let price = product_arr[product_index].price;
            logger.info(`Ancien Price:  ${product_arr[product_index].price}`);

            let kmotorshop_response = await getKmotorProduct(
                product_arr[product_index]
            );

            if (kmotorshop_response != undefined) {
                if (kmotorshop_response && kmotorshop_response.itemStatus === 200) {
                    kmotorshop_response = JSON.parse(JSON.stringify(kmotorshop_response));

                    price = parseFloat(
                        kmotorshop_response.price.value * 1.4 * 1.2
                    ).toFixed(2);

                    let internalStock = isNaN(
                            parseInt(kmotorshop_response.availableQuantity.internalStock)
                        ) ?
                        0 :
                        parseInt(kmotorshop_response.availableQuantity.internalStock);

                    let supplierStock = isNaN(
                            parseInt(kmotorshop_response.availableQuantity.supplierStock)
                        ) ?
                        0 :
                        parseInt(kmotorshop_response.availableQuantity.supplierStock);

                    quantity = parseInt(internalStock + supplierStock);

                    console.log("quantity: ", quantity);
                }
            }

            await updatePrice(product_arr[product_index].id, price);

            if (quantity > 0 && price == 0.0) {
                quantity = 0;
            }

            logger.info(`Price ${price}`);
            logger.info(`Quanitity: ${quantity}`);

            await updateQuantity(
                location_id,
                product_arr[product_index].inventory_item_id,
                quantity
            );

            let script_json_data = {
                all_product_listed: false,
                last_file: i,
                last_product: product_index + 1,
            };
            writeJsonFile("update.json", script_json_data);

            product_index++;
        }

        let script_json_data = {
            all_product_listed: false,
            last_file: 0,
            last_product: i + 1,
        };

        i++;
    }
}

async function getShopifyPageProducts() {
    logger.info(`Listing Products Page link : ${shopify_get_url}`);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    let product_response = await axios
        .get(shopify_get_url, {
            auth: {
                username: shopify_username,
                password: shopify_password,
            },
        })
        .catch((err) => logger.error(`error : ${err}`));
    return product_response;
}

async function getNextLink(product_response) {
    let next_link_text = await product_response.headers.link
        .split(",")
        .filter((el) => el.includes('rel="next"'));

    if (next_link_text.length != 0) {
        let next_link = await next_link_text[0]
            .substr(
                next_link_text[0].search("<") + 1,
                next_link_text[0].search(">") - 1
            )
            .replace(">", "")
            .trim();
        return next_link;
    } else {
        return "";
    }
}

async function readFileSync(path) {
    let script_conf = fs.readFileSync(path, "utf8", (err) => {
        if (err) {
            logger.error(`Lecture du fichier ${path} a echoué, erreur : ${err}`);
            return;
        }
    });
    return script_conf;
}

async function writeJsonFile(path, json_data) {
    fs.writeFile(path, JSON.stringify(json_data), function(err, result) {
        if (err) logger.error(`error : ${err}`);
    });
}

async function getKmotorProduct(product) {
    let kmotorshop_url = `https://www.kmotorshop.com/rest-api/inventory/v1/item/${product.code}?detail=7`;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    logger.info(`Getting price and quantity for ${product.code}`);
    let kmotorshop_response = await axios
        .get(kmotorshop_url, {
            auth: {
                username: kmotorshop_username,
                password: kmotorshop_password,
            },
        })
        .catch((err) => logger.error("Kmotorshop Error: ", err.response.data));

    if (kmotorshop_response.data == undefined) {
        logger.info(
            `Cet Article n'exsite plus dans KmotorShop ou En Repture de Stock`
        );
    }
    return kmotorshop_response.data;
}

async function updatePrice(product_id, price) {
    const shopify_post_url = `https://302566b802422a29364d1d606e873e7c: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@tpm-ram.myshopify.com/admin/api/2021-07/variants/${product_id}.json`;

    if (!price == 0.0) {
        let product_data = {
            variant: {
                id: product_id,
                price: price,
            },
        };
        await new Promise((resolve) => setTimeout(resolve, 1000));
        let updated_product_response = await axios
            .put(shopify_post_url, product_data, {
                auth: {
                    username: shopify_username,
                    password: shopify_password,
                },
            })
            .catch((err) => console.log(err));
        console.log("Updated product response: ", updated_product_response.data);
    }
}

async function updateQuantity(location_id, inventory_item_id, quantity) {
    let shopify_inventory_url = `https://tpm-ram.myshopify.com/admin/api/2021-07/inventory_levels/set.json`;

    let inventory_data = {
        location_id: location_id,
        inventory_item_id: inventory_item_id,
        available: quantity,
    };
    await new Promise((resolve) => setTimeout(resolve, 1000));

    let inventory_response = await axios
        .post(shopify_inventory_url, inventory_data, {
            auth: {
                username: shopify_username,
                password: shopify_password,
            },
        })
        .catch((err) => console.log(err));

    console.log("inventory response : ", inventory_response.data);
}