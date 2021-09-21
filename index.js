const shell = require("shelljs");
const fs = require("fs");
const scraper = require("./scraper");

(async() => {
    // intailiser le scraper
    await scraper.initialize();

    // recuperer tout les link des produits 
    //let results_links = await scraper.getResults();


    // recuperer tout les produits a partir des liens  
    let results = await scraper.getInfos();
})();