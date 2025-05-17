/*********************************************
 * GESTION DES BARRES LATÉRALES
 *********************************************/
const btnFilters = document.getElementById("btn-filters");
const sidebarLeft = document.getElementById("sidebar-left");
const btnCart = document.getElementById("btn-cart");
const sidebarRight = document.getElementById("sidebar-right");
const cardsSection = document.getElementById("cards-section");

let leftOpen = false;
let rightOpen = false;

btnFilters.addEventListener("click", () => {
    // Ne pas exécuter si désactivé
    if (btnFilters.getAttribute('data-disabled') === 'true') {
        return;
    }
    leftOpen = !leftOpen;
    if (leftOpen) {
        sidebarLeft.classList.remove("sidebar-closed");
        sidebarLeft.classList.add("sidebar-open");
        cardsSection.style.marginLeft = "250px";
    } else {
        sidebarLeft.classList.remove("sidebar-open");
        sidebarLeft.classList.add("sidebar-closed");
        cardsSection.style.marginLeft = "0px";
    }
});

btnCart.addEventListener("click", () => {
    // Ne pas exécuter si désactivé
    if (btnCart.getAttribute('data-disabled') === 'true') {
        return;
    }
    rightOpen = !rightOpen;
    if (rightOpen) {
        sidebarRight.classList.remove("sidebar-closed");
        sidebarRight.classList.add("sidebar-open");
        cardsSection.style.marginRight = "250px";
    } else {
        sidebarRight.classList.remove("sidebar-open");
        sidebarRight.classList.add("sidebar-closed");
        cardsSection.style.marginRight = "0px";
    }
});

/*********************************************
 * ZOOM (scaled-image) => toggle unique
 *********************************************/

// Function to reset all scaled images to normal size
function resetImageScale() {
    d3.selectAll("img.scaled-image").classed("scaled-image", false);
    document.querySelectorAll(".scaled-image").forEach(img => {
        img.classList.remove("scaled-image");
    });
    currentlyScaledImg = null;
}
let currentlyScaledImg = null;
// Click global => annuler le zoom si on clique ailleurs
document.addEventListener("click", function(evt) {
    if (currentlyScaledImg && evt.target !== currentlyScaledImg) {
        currentlyScaledImg.classList.remove("scaled-image");
        currentlyScaledImg.style.transform = "";
        currentlyScaledImg.style.position = "";
        currentlyScaledImg.style.zIndex = "";
        currentlyScaledImg.style.transformOrigin = "";
        currentlyScaledImg = null;
    }
});

/*********************************************
 * GESTION DES 3 PREMIÈRES LIGNES (#cart-summary-table)
 *********************************************/
function updateTopFirstImages() {
    const table = document.getElementById("cart-summary-table");
    if (!table) return;
    
    const thead = table.querySelector("thead");
    if (!thead) return;
    const tbody = table.querySelector("tbody");
    if (!tbody) return;

    const headBottom = thead.getBoundingClientRect().bottom;
    const rows = [...tbody.querySelectorAll("tr")];

    const candidates = rows.map(r => {
        const rect = r.getBoundingClientRect();
        return { row: r, top: rect.top };
    }).filter(obj => obj.top >= headBottom);

    candidates.sort((a,b)=> a.top - b.top);

    rows.forEach(r => r.classList.remove("top-first-images"));

    const top3 = candidates.slice(0, 3);
    top3.forEach(o => o.row.classList.add("top-first-images"));
}
const cartSummaryTableContainer = document.getElementById("cart-summary-table-container");
if (cartSummaryTableContainer) {
    cartSummaryTableContainer.addEventListener("scroll", updateTopFirstImages);
    window.addEventListener("resize", updateTopFirstImages);
}

/*********************************************
 * 1) Variables Globales pour cartes
 *********************************************/
const margin = { top: 50, right: 200, bottom: 150, left: 150 };
const width = 800;
const height = 600 - margin.top - margin.bottom;

let allCardsData = [];
const alreadyUsedCountMap = new Map();
const selectedCards = new Set();

let jamaisUtiliseProdNames = [];
let sortiesParProduitTrie = [];

const filterState = {
    searchTerm: "",
    sortSelectValue: "alphabetical-asc",
    largeurMin: 0,
    largeurMax: Infinity,
    hauteurMin: 0,
    hauteurMax: Infinity,
    profondeurMin: 0,
    profondeurMax: Infinity,
    dimension: "largeur",
    dimensionMin: 0,
    dimensionMax: Infinity,
    essentialFilter: "jamais",
    dejaUtiliseRange: 1,
    brushSelection: null,
    currentTab: "tab-les-essentiels",
    selectedSites: new Set(),
    selectedEmplacements: new Set(),
};

let xScale, yScale;
let currentPage = 1;
let rowsPerPage = 10;
let totalPages = 1;
let cartSummaryData = [];
const sortState = { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null };

const clientSelect = document.getElementById('client-select');
const emptyCartButton = d3.select("#empty-cart-button");
const validateCartButton = d3.select("#validate-cart-button");
const backToTopButton = d3.select("#back-to-top");
const cartSummaryModal = document.getElementById("cart-summary-modal");
const cartSummaryCloseModalBtn = document.getElementById("close-cart-summary");
const connectionValidationButton = document.getElementById("connection-validation-button");
const loginSection = document.getElementById("login-section");
const modalLoginButton = document.getElementById("modal-login-button");

const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');

const svg = d3.select("#scatter-plot")
    .append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

/* ==================================================
   CORRELATIONS DES SORTIES : variables globales
   ================================================== */
   let corrCardsData     = [];        // data.json filtré
   let corrPopularityMap = new Map(); // prod_designation → sprod_sur_Stotal
   let corrMatrix        = {};        // cooccurrence.json
   let corrSelectedKey   = null;      // produit cliqué   
   const corrFilterState = { searchTerm: "" }; //pour la recherche avancée


/* ---------- mapping produit → image ---------- */
const prodImageMap = new Map();     // prod_designation → image_url

/* ==============================================================
   PIE CHART — chargement + calcul + rendu + vérifications console
   ============================================================== */

const inventoryData   = {};      // cache inventaire.xlsx   par client
const stockVolumeData = {};      // cache stock_volume.json par client

function getInventory(client){
    if (inventoryData[client]) return Promise.resolve(inventoryData[client]);

    return fetch(`./data/${client}/inventaire.xlsx`)
        .then(r => {
            if (!r.ok) throw new Error(`inventaire.xlsx → HTTP ${r.status}`);
            return r.arrayBuffer();
        })
        .then(buf => {
            const wb   = XLSX.read(buf, { type: "array" });
            const ws   = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
            return (inventoryData[client] = rows);
        });
}

function getStockVolumes(client){
    if (stockVolumeData[client]) return Promise.resolve(stockVolumeData[client]);

    return fetch(`./data/${client}/stock_volume.json`)
        .then(r => {
            if (!r.ok) throw new Error(`stock_volume.json → HTTP ${r.status}`);
            return r.json();
        })
        .then(map => (stockVolumeData[client] = map));
}

function computeSiteVolumes(client){
    return Promise.all([getInventory(client), getStockVolumes(client)]).then(
        ([inv, vol]) => {
            console.groupCollapsed(`📊 Camembert – ${client}`);
            const agg = {};
            inv.forEach(r => {
                const site = r.sit_nom?.trim();
                if (!site) return;

                const qty = +r.Qté_emplacement || 0;
                const v1  = +vol[r.prod_id]     || 0;
                const tot = qty * v1;

                if (!agg[site]) agg[site] = 0;
                agg[site] += tot;
            });
            const data = Object.entries(agg)
                               .filter(([,v]) => v > 0)
                               .map(([site, volume]) => ({ site, volume }))
                               .sort((a,b) => d3.descending(a.volume, b.volume));

            console.table(data);
            console.groupEnd();

            renderPieChart(data);
        })
        .catch(err => {
            console.error("❌ Camembert :", err.message);

        });
}

function renderPieChart(data){
    // Création du svg si nécessaire
    const svg = d3.select("#site-volume-chart");
    svg.selectAll("*").remove();

    if (data.length === 0) return;          // rien à afficher

    const W = +svg.attr("width") || 800,
          H = +svg.attr("height") || 600,
          R = Math.min(W, H) / 2 - 10;

    const g     = svg.append("g").attr("transform", `translate(${W/2},${H/2})`);
    const color = d3.scaleOrdinal().domain(data.map(d=>d.site))
                                  .range(d3.schemeTableau10);

    const pie  = d3.pie().sort(null).value(d => d.volume);
    const arc  = d3.arc().innerRadius(0).outerRadius(R);

    const tip = d3.select("body").append("div")
        .attr("class","deepsearch-loader-content")
        .style("position","absolute")
        .style("pointer-events","none")
        .style("background","rgba(0,0,0,.85)")
        .style("padding","8px 10px").style("border-radius","6px")
        .style("font-size","14px").style("display","none");

    g.selectAll("path")
      .data(pie(data))
      .enter()
      .append("path")
        .attr("d", arc)
        .attr("fill", d => color(d.data.site))
        .attr("stroke", "#1e242e")     // fin liseré pour bien détacher
        .attr("stroke-width", 1)
        .on("mouseover", (e,d) => {
            const pct = (d.data.volume /
                        d3.sum(data,v=>v.volume) * 100).toFixed(1);
            tip.html(`<b>${d.data.site}</b><br>Volume : ${d.data.volume.toFixed(2)} m³<br>${pct}&nbsp;%`)
               .style("display","block");
        })
        .on("mousemove", e =>
            tip.style("left", e.pageX + 15 + "px")
               .style("top",  e.pageY + 15 + "px"))
        .on("mouseout", () => tip.style("display","none"));
}




/*********************************************
 * 2) Fonctions de recherche avancée (cartes)
 *********************************************/
function parseAdvancedSearch(searchStr) {
    if (!searchStr) {
        return { positives: [], negatives: [] };
    }
    const firstExclIndex = searchStr.indexOf('!');
    let positivePart = searchStr;
    let negativePart = "";
    if (firstExclIndex >= 0) {
        positivePart = searchStr.substring(0, firstExclIndex);
        negativePart = searchStr.substring(firstExclIndex).replace(/^!+/, "");
    }
    const positives = [];
    if (positivePart.trim().length>0) {
        const andChunks = positivePart.trim().split(/\s+/);
        andChunks.forEach(chunk=>{
            const orParts = chunk.split('#').map(s => s.trim()).filter(s => s.length>0);
            if (orParts.length>0) {
                positives.push(orParts);
            }
        });
    }
    const negatives = [];
    if (negativePart.trim().length>0) {
        let negClean = negativePart.replace(/!/g," ");
        let negTokens = negClean.trim().split(/[\s#]+/);
        negTokens= negTokens.filter(s=> s.length>0);
        negatives.push(...negTokens);
    }
    return { positives, negatives };
}
function matchPositives(itemStr, positives) {
    if (positives.length===0) return true;
    for (let group of positives) {
        let foundOne = false;
        for (let token of group) {
            if (itemStr.includes(token)) {
                foundOne= true;
                break;
            }
        }
        if (!foundOne) {
            return false;
        }
    }
    return true;
}
function matchNegatives(itemStr, negatives) {
    if (negatives.length===0) return true;
    for (let token of negatives) {
        if (itemStr.includes(token)) {
            return false;
        }
    }
    return true;
}
function matchAdvancedSearch(itemStr, searchStr) {
    const { positives, negatives } = parseAdvancedSearch(searchStr);
    const okPos = matchPositives(itemStr, positives);
    const okNeg = matchNegatives(itemStr, negatives);
    return okPos && okNeg;
}

function parseBasicSearch(searchStr) {
    if (!searchStr) {
        return [];
    }
    const andChunks = searchStr.trim().split(/\s+/);
    const result = [];
    andChunks.forEach(chunk => {
        const orParts = chunk.split('#')
            .map(s => s.trim().toLowerCase())
            .filter(s => s.length > 0);
        if (orParts.length > 0) {
            result.push(orParts);
        }
    });
    return result;
}
function matchBasicSearch(itemStr, parsedSearch) {
    if (parsedSearch.length === 0) {
        return true;
    }
    const itemLower = itemStr.toLowerCase();
    for (let group of parsedSearch) {
        let foundOne = false;
        for (let token of group) {
            if (itemLower.includes(token)) {
                foundOne = true;
                break;
            }
        }
        if (!foundOne) {
            return false;
        }
    }
    return true;
}

/*********************************************
 * 3) Autres Fonctions de Filtre (cartes)
 *********************************************/
function getUniqueKey(d) {
    return `${d.prod_id}_${d.sit_id}_${d.empl_id}`;
}
function isWithinBrush(d) {
    if(!filterState.brushSelection) return true;
    if(filterState.currentTab!=="tab-utilite-obsolescence") return true;
    const { x0,y0,x1,y1 }= filterState.brushSelection;
    const cx = xScale(d['taux_utilité']);
    const cy = yScale(d['Obsolescence (mois)']);
    return (cx>=x0 && cx<=x1 && cy>=y0 && cy<=y1);
}
function passDimensionFilter(d) {
    const largeur = +d.prod_largeur || 0;
    const hauteur = +d.prod_hauteur || 0;
    const profondeur = +d.prod_profondeur || 0;
    
    const largeurPass = largeur >= filterState.largeurMin && largeur <= filterState.largeurMax;
    const hauteurPass = hauteur >= filterState.hauteurMin && hauteur <= filterState.hauteurMax;
    const profondeurPass = profondeur >= filterState.profondeurMin && profondeur <= filterState.profondeurMax;
    
    return largeurPass && hauteurPass && profondeurPass;
}
function passEssentialFilter(d) {
    if(filterState.currentTab!=="tab-les-essentiels") {
        return true; 
    }
    if(filterState.essentialFilter==="jamais") {
        return jamaisUtiliseProdNames.includes(d.prod_designation);
    } else if(filterState.essentialFilter==="deja") {
        const rowFound= sortiesParProduitTrie.find(r=> r.prod_designation=== d.prod_designation);
        if(!rowFound) return false;
        const cumVal= +rowFound.cumulative_sprod_sur_Stotal;
        return (cumVal <= filterState.dejaUtiliseRange);
    }
    return true;
}
function sortFilteredData(dataArr){
    const s = filterState.sortSelectValue;
    const sortedData = dataArr.slice();
    
    if(s === "alphabetical-asc") {
        sortedData.sort((a, b) => a.prod_designation.localeCompare(b.prod_designation, 'fr', {sensitivity: "base"}));
    } else if(s === "alphabetical-desc") {
        sortedData.sort((a, b) => b.prod_designation.localeCompare(a.prod_designation, 'fr', {sensitivity: "base"}));
    } else if(s === "quantity-asc") {
        sortedData.sort((a, b) => d3.ascending(a.qte_dispo, b.qte_dispo));
    } else if(s === "quantity-desc") {
        sortedData.sort((a, b) => d3.descending(a.qte_dispo, b.qte_dispo));
    } else if(s === "used-asc") {
        sortedData.sort((a, b) => {
            const au = alreadyUsedCountMap.get(a.prod_designation) || 0;
            const bu = alreadyUsedCountMap.get(b.prod_designation) || 0;
            return d3.ascending(au, bu);
        });
    } else if(s === "used-desc") {
        sortedData.sort((a, b) => {
            const au = alreadyUsedCountMap.get(a.prod_designation) || 0;
            const bu = alreadyUsedCountMap.get(b.prod_designation) || 0;
            return d3.descending(au, bu);
        });
    }
    return sortedData;
}
function resetFilters(){
    filterState.searchTerm="";
    d3.select("#search-box").property("value","");

    filterState.largeurMin = 0;
    filterState.largeurMax = Infinity;
    filterState.hauteurMin = 0;
    filterState.hauteurMax = Infinity;
    filterState.profondeurMin = 0;
    filterState.profondeurMax = Infinity;
    d3.select("#largeur-min").property("value", "");
    d3.select("#largeur-max").property("value", "");
    d3.select("#hauteur-min").property("value", "");
    d3.select("#hauteur-max").property("value", "");
    d3.select("#profondeur-min").property("value", "");
    d3.select("#profondeur-max").property("value", "");
    
    filterState.dimension = "largeur";
    filterState.dimensionMin = 0;
    filterState.dimensionMax = Infinity;

    filterState.sortSelectValue="alphabetical-asc";
    d3.select("#sort-select").property("value","alphabetical-asc");

    d3.select("#site-search-box").property("value", "");
    d3.select("#emplacement-search-box").property("value", "");
    filterState.selectedSites.clear();
    filterState.selectedEmplacements.clear();
}

/*********************************************
 * 4) applyAllFiltersAndUpdate()
 *********************************************/
function applyAllFiltersAndUpdate(){
    let dataAfterPrimary = allCardsData.filter(d => {
        if(!passDimensionFilter(d)) return false;
        if(!passEssentialFilter(d)) return false;
        if(!isWithinBrush(d)) return false;
        if(d.qte_dispo < filterState.qtyMin) return false;
        const itemStr= (d.prod_designation + " " + d.sit_nom + " " + d.empl_libelle).toLowerCase();
        if(!matchAdvancedSearch(itemStr, filterState.searchTerm)) return false;
        return true;
    });
    dataAfterPrimary = sortFilteredData(dataAfterPrimary);

    const possibleSites = new Set(dataAfterPrimary.map(d => d.sit_nom));
    for(const s of filterState.selectedSites){
        if(!possibleSites.has(s)){
            filterState.selectedSites.delete(s);
        }
    }
    let dataAfterSiteFilter;
    if(filterState.selectedSites.size>0){
        dataAfterSiteFilter = dataAfterPrimary.filter(d => filterState.selectedSites.has(d.sit_nom));
    } else {
        dataAfterSiteFilter = dataAfterPrimary;
    }

    const possibleEmplacements = new Set(dataAfterSiteFilter.map(d => d.empl_libelle));
    for(const e of filterState.selectedEmplacements){
        if(!possibleEmplacements.has(e)){
            filterState.selectedEmplacements.delete(e);
        }
    }
    let finalData;
    if(filterState.selectedEmplacements.size>0){
        finalData = dataAfterSiteFilter.filter(d =>
            filterState.selectedEmplacements.has(d.empl_libelle)
        );
    } else {
        finalData = dataAfterSiteFilter;
    }

    updateSiteListUI(dataAfterPrimary);
    updateEmplListUI(dataAfterSiteFilter);

    updateCards(finalData);

    updateSummary();
    updateCartButtonsState();
    renderCartSummary();
    adjustCartSummaryHeight();
}

/*********************************************
 * 5) updateSiteListUI
 *********************************************/
function updateSiteListUI(dataSubset){
    const allSiteNames = Array.from(d3.group(dataSubset, d => d.sit_nom).keys()).sort();
    const siteSearchTerm = d3.select("#site-search-box").property("value") || "";
    const siteParsedSearch = parseBasicSearch(siteSearchTerm);

    const displayedSites = allSiteNames.filter(siteName =>
        matchBasicSearch(siteName, siteParsedSearch)
    );

    const siteList = d3.select("#site-list-container");
    siteList.selectAll("*").remove();

    const checkedSites = displayedSites.filter(s => filterState.selectedSites.has(s));
    const uncheckedSites = displayedSites.filter(s => !filterState.selectedSites.has(s));

    function createSiteRow(siteName){
        const isChecked = filterState.selectedSites.has(siteName);
        const checkboxId = "site-checkbox-" + siteName.replace(/\s/g, "_");

        const row = siteList.append("div")
            .style("margin-bottom", "5px");

        row.append("input")
            .attr("type", "checkbox")
            .attr("id", checkboxId)
            .attr("value", siteName)
            .property("checked", isChecked)
            .on("change", function(){
                if(this.checked){
                    filterState.selectedSites.add(siteName);
                } else {
                    filterState.selectedSites.delete(siteName);
                }
                applyAllFiltersAndUpdate();
            });

        row.append("label")
            .attr("for", checkboxId)
            .text(" " + siteName);
    }

    checkedSites.forEach(createSiteRow);
    if(checkedSites.length>0 && uncheckedSites.length>0){
        siteList.append("div")
            .attr("class","horizontal-divider")
            .style("margin","10px 0");
    }
    uncheckedSites.forEach(createSiteRow);
}

/*********************************************
 * 6) updateEmplListUI
 *********************************************/
function updateEmplListUI(dataSubset){
    const allEmplNames = Array.from(d3.group(dataSubset, d => d.empl_libelle).keys()).sort();
    const emplSearchTerm = d3.select("#emplacement-search-box").property("value") || "";
    const emplParsedSearch = parseBasicSearch(emplSearchTerm);

    const displayedEmpl = allEmplNames.filter(e =>
        matchBasicSearch(e, emplParsedSearch)
    );

    const emplList = d3.select("#emplacement-list-container");
    emplList.selectAll("*").remove();

    const checkedEmpl = displayedEmpl.filter(e => filterState.selectedEmplacements.has(e));
    const uncheckedEmpl = displayedEmpl.filter(e => !filterState.selectedEmplacements.has(e));

    function createEmplRow(emplacementName){
        const isChecked = filterState.selectedEmplacements.has(emplacementName);
        const checkboxId = "empl-checkbox-" + emplacementName.replace(/\s/g, "_");

        const row = emplList.append("div")
            .style("margin-bottom", "5px");

        row.append("input")
            .attr("type", "checkbox")
            .attr("id", checkboxId)
            .attr("value", emplacementName)
            .property("checked", isChecked)
            .on("change", function(){
                if(this.checked){
                    filterState.selectedEmplacements.add(emplacementName);
                } else {
                    filterState.selectedEmplacements.delete(emplacementName);
                }
                applyAllFiltersAndUpdate();
            });

        row.append("label")
            .attr("for", checkboxId)
            .text(" " + emplacementName);
    }

    checkedEmpl.forEach(createEmplRow);
    if(checkedEmpl.length>0 && uncheckedEmpl.length>0){
        emplList.append("div")
            .attr("class","horizontal-divider")
            .style("margin","10px 0");
    }
    uncheckedEmpl.forEach(createEmplRow);
}

/*********************************************
 * 7) Mise à jour des cartes
 *********************************************/
/* APRÈS — même fonction avec les deux indicateurs rétablis */
function updateCards(dataArr) {

    /* ---------- 1. data-join ---------- */
    const cards = d3.select("#cards-container")
        .selectAll(".card")
        .data(dataArr, d => getUniqueKey(d));

    cards.exit().remove();

    /* ---------- 2. enter : création ---------- */
    const enter = cards.enter()
        .append("div")
        .attr("class", "card")
        .style("opacity", 0)
        .style("transform", "translateY(20px)")
        .on("click", function (e, d) {
            if (d3.select(e.target).classed("remove-item")) return;
            const chk = d3.select(this).select(".card-checkbox");
            const newChecked = !chk.property("checked");
            chk.property("checked", newChecked);
            const key = getUniqueKey(d);
            newChecked ? selectedCards.add(key) : selectedCards.delete(key);
            d3.select(this).classed("selected", newChecked);
            updateSelectAllCheckbox();
            updateCartButtonsState();
            renderCartSummary();
            updateSummary();
            adjustCartSummaryHeight();
        });

    /* — vignette — */
    enter.append("img")
        .attr("loading", "lazy")
        .attr("decoding", "async")
        .attr("src", d => `./data/${clientSelect.value}/${d.image_url}`)
        .attr("alt", d => d.prod_designation.replace(/_/g, " "));

    /* --- PASTILLE COULEUR (utilité/obsolescence) --- */
    enter.append("div")
        .attr("class", "obso-util")
        .style("background-color", d => getColor(d))
        .style("width", "18px")
        .style("height", "18px")
        .style("border-radius", "4px")
        .style("position", "absolute")
        .style("top", "8px")
        .style("right", "8px");

    /* — contenu textuel — */
    enter.append("div")
        .attr("class", "card-content")
        .html(d => `
            <b>${d.prod_designation.replace(/_/g, ' ')}</b><br><br>
            <b>L*H*P (cm):</b> ${d.prod_largeur}*${d.prod_hauteur}*${d.prod_profondeur}<br><br>
            <b>Volume :</b> ${d.stock_volume} m³<br><br>
            <b>Site:</b> ${d.sit_nom}<br>
            <b>Emplacement:</b> ${d.empl_libelle}<br>`);

    /* — quantité dispo — */
    enter.append("div")
        .attr("class", "quantity-pill")
        .text(d => `qté. dispo : ${d.qte_dispo}`);

    /* --- PILULE DÉJÀ SORTI (si >0) --- */
    enter.append("div")
        .filter(d => (alreadyUsedCountMap.get(d.prod_designation) || 0) > 0)
        .attr("class", "already-used-pill")
        .text(d => `déjà sorti : ${alreadyUsedCountMap.get(d.prod_designation)}`);

    /* — checkbox invisible pour la sélection — */
    enter.append("input")
        .attr("type", "checkbox")
        .attr("class", "card-checkbox");

    /* ---------- 3. update + animation ---------- */
    /* APRÈS — même bloc + ré-ordonnancement DOM */
    const merged = enter.merge(cards);

    /* 1. (re)tri visuel selon l’ordre actuel de dataArr */
    merged.sort((a, b) => dataArr.indexOf(a) - dataArr.indexOf(b));

    /* 2. mise à jour des indicateurs couleur / pilule */
    merged.select(".obso-util")
        .style("background-color", d => getColor(d));

    merged.select(".already-used-pill")
        .text(d => {
            const n = alreadyUsedCountMap.get(d.prod_designation) || 0;
            return n ? `déjà sorti : ${n}` : "";
        });

    /* 3. petite transition d’apparition */
    merged.transition()
        .duration(250)
        .style("opacity", 1)
        .style("transform", "translateY(0)");

    /* 4. MAJ panneaux et résumé */
    updateSelectAllCheckbox();
    updateCartButtonsState();
    renderCartSummary();
    updateSummary();
    adjustCartSummaryHeight();
}


function getColor(d){
    const u= d['taux_utilité'];
    const o= d['Obsolescence (mois)'];
    if(u===0) return "yellow";
    if(o<=9 && u<=0.35) return "green";
    if(o>9 && u>0.35) return "black";
    if(o<=9 && u>0.35) return "blue";
    if(o>9 && u<=0.35) return "red";
    return "gray";
}
function updateSelectAllCheckbox(){
    const totalVisible = d3.selectAll("#cards-container .card-checkbox").size();
    const checkedVisible = d3.selectAll("#cards-container .card-checkbox:checked").size();
    const selectAllBox = d3.select("#select-all-checkbox");
    
    if(totalVisible === 0) {
        selectAllBox.property("checked", false);
        selectAllBox.property("indeterminate", false);
    } else if(checkedVisible === 0) {
        selectAllBox.property("checked", false);
        selectAllBox.property("indeterminate", false);
    } else if(checkedVisible === totalVisible) {
        selectAllBox.property("checked", true);
        selectAllBox.property("indeterminate", false);
    } else {
        selectAllBox.property("checked", false);
        selectAllBox.property("indeterminate", true);
    }
}

const magnifyToggleBtn = document.getElementById("magnify-toggle-btn");
let hoverMagnifyActive = false;
/* APRÈS – délégation + listener unique */
function applyMagnifyHoverEffects() {
    /* délégation : un seul listener sur le conteneur */
    const cont = document.getElementById('cards-container');
    if (cont._hoverBound) return;          // déjà fait
    cont._hoverBound = true;

    cont.addEventListener('mouseover', e => {
        if (!e.target.matches('.card img')) return;
        if (document.body.classList.contains('magnify-mode')) {
            updateCardPositionClasses();
            e.target.classList.add('hover-magnified');
            e.target.closest('.card').style.zIndex = 10;
        }
    });

    cont.addEventListener('mouseout', e => {
        if (!e.target.matches('.card img')) return;
        e.target.classList.remove('hover-magnified');
        const card = e.target.closest('.card');
        if (card) card.style.zIndex = 1;
    });
}

function updateCardPositionClasses() {
    const cardsContainer = document.getElementById('cards-container');
    if (!cardsContainer) return;
    
    const cards = Array.from(cardsContainer.querySelectorAll('.card'));
    if (cards.length === 0) return;
    
    const containerRect = cardsContainer.getBoundingClientRect();
    const cardPositions = cards.map(card => {
        const rect = card.getBoundingClientRect();
        return {
            card: card,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom
        };
    });
    
    cards.forEach(card => {
        card.classList.remove(
            'corner-top-left', 'corner-top-right', 'corner-bottom-left', 'corner-bottom-right',
            'top-edge', 'bottom-edge', 'left-edge', 'right-edge'
        );
    });
    
    // Regrouper par lignes (tolerance)
    const rows = [];
    const tolerance = 5;
    cardPositions.forEach(pos => {
        const row = rows.find(r => Math.abs(r[0].top - pos.top) < tolerance);
        if (row) {
            row.push(pos);
        } else {
            rows.push([pos]);
        }
    });
    rows.sort((a, b) => a[0].top - b[0].top);
    rows.forEach(row => row.sort((a, b) => a.left - b.left));
    
    // Appliquer classes
    cardPositions.forEach(pos => {
        const rowIndex = rows.findIndex(row => row.some(p => p.card === pos.card));
        const columnIndex = rows[rowIndex].findIndex(p => p.card === pos.card);
        const isTopEdge = rowIndex === 0;
        const isBottomEdge = rowIndex === rows.length - 1;
        const isLeftEdge = columnIndex === 0;
        const isRightEdge = columnIndex === rows[rowIndex].length - 1;
        if (isTopEdge) pos.card.classList.add('top-edge');
        if (isBottomEdge) pos.card.classList.add('bottom-edge');
        if (isLeftEdge) pos.card.classList.add('left-edge');
        if (isRightEdge) pos.card.classList.add('right-edge');
        if (isTopEdge && isLeftEdge) pos.card.classList.add('corner-top-left');
        if (isTopEdge && isRightEdge) pos.card.classList.add('corner-top-right');
        if (isBottomEdge && isLeftEdge) pos.card.classList.add('corner-bottom-left');
        if (isBottomEdge && isRightEdge) pos.card.classList.add('corner-bottom-right');
    });
}
function handleImageMouseEnter() {
    if (document.body.classList.contains('magnify-mode')) {
        this.classList.add('hover-magnified');
        const card = this.closest('.card');
        if (card) {
            card.style.zIndex = '10';
        }
    }
}
function handleImageMouseLeave() {
    this.classList.remove('hover-magnified');
    const card = this.closest('.card');
    if (card) {
        card.style.zIndex = '1';
    }
}
if (magnifyToggleBtn) {
    magnifyToggleBtn.addEventListener('click', function() {
        document.body.classList.toggle('magnify-mode');
        this.classList.toggle('active');
        hoverMagnifyActive = document.body.classList.contains('magnify-mode');
        if (hoverMagnifyActive) {
            this.querySelector('i').classList.replace('fa-search-plus', 'fa-search-minus');
            applyMagnifyHoverEffects();
        } else {
            this.querySelector('i').classList.replace('fa-search-minus', 'fa-search-plus');
            document.querySelectorAll('.hover-magnified').forEach(img => {
                img.classList.remove('hover-magnified');
            });
        }
    });
}
document.addEventListener('DOMContentLoaded', function() {
    const allImgs = document.querySelectorAll('img:not(.cart-item-img)');
    allImgs.forEach(img => {
        img.classList.remove('scaled-image');
        img.addEventListener('click', function(e) {
            this.classList.remove('scaled-image');
            if (document.body.classList.contains('magnify-mode')) {
                e.stopPropagation();
                return false;
            }
        }, true);
    });
    const cardsContainer = document.getElementById('cards-container');
    if (cardsContainer) {
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    if (document.body.classList.contains('magnify-mode')) {
                        setTimeout(() => {
                            applyMagnifyHoverEffects();
                        }, 50);
                    }
                }
            });
        });
        observer.observe(cardsContainer, { childList: true, subtree: true });
        if (document.body.classList.contains('magnify-mode')) {
            applyMagnifyHoverEffects();
        }
    }
    resetImageScale();
    currentlyScaledImg = null;
    document.body.classList.remove("magnify-mode");
    const magnifyBtn = document.getElementById("magnify-toggle-btn");
    if (magnifyBtn) {
        magnifyBtn.classList.remove("active");
        const iEl = magnifyBtn.querySelector('i');
        if(iEl) iEl.classList.replace('fa-search-minus','fa-search-plus');
    }
});

/*********************************************
 * 8) Résumé & Panier
 *********************************************/
function updateSummary(){
    const selData = allCardsData.filter(d => selectedCards.has(getUniqueKey(d)));
    const nb = selectedCards.size;
    const totalQte = d3.sum(selData, d => d.qte_dispo);
    const totalVol = d3.sum(selData, d => {
        return d.stock_volume * d.qte_dispo;
    }).toFixed(2);
    const nbSites = new Set(selData.map(d => d.sit_id)).size;
    const nbEmpl = new Set(selData.map(d => d.empl_id)).size;

    d3.select("#summary-count").text(nb);
    d3.select("#summary-quantity").text(totalQte);
    d3.select("#summary-volume").text(totalVol);
    d3.select("#summary-sites").text(nbSites);
    d3.select("#summary-emplacements").text(nbEmpl);
}
function updateCartButtonsState(){
    const cartCount= selectedCards.size;
    if(cartCount>0){
        emptyCartButton.classed("disabled", false);
        validateCartButton.classed("disabled", false);
    } else {
        emptyCartButton.classed("disabled", true);
        validateCartButton.classed("disabled", true);
    }
}
function renderCartSummary(){
    const cartItemsContainer= d3.select("#cart-items");
    cartItemsContainer.html("");

    const selData= allCardsData.filter(d=> selectedCards.has(getUniqueKey(d)));
    const grouped= d3.rollups(
        selData,
        items=>({
            prod_designation: items[0].prod_designation,
            image_url: items[0].image_url,
            qte_dispo: d3.sum(items, dd=> dd.qte_dispo)
        }),
        d=> d.prod_designation
    );
    const groupedData= grouped.map(([_,val])=> val);

    groupedData.forEach(d=>{
        const item= cartItemsContainer.append("div").attr("class","cart-item");
        item.append("img")
            .attr("src", `./data/${clientSelect.value}/${d.image_url}`)
            .attr("alt", d.prod_designation.replace(/_/g,' '));
        item.append("span")
            .attr("class","qte-dispo")
            .text(`Qté: ${d.qte_dispo}`);

        const removeIcon= item.append("span")
            .attr("class","remove-item")
            .append("i")
                .attr("class","fa-solid fa-trash");

        removeIcon.on("click",(ev)=>{
            ev.stopPropagation();
            item.classed("cart-item-removing", true);
            const itemEl= item.node();
            itemEl.addEventListener("transitionend", function handleTransition(e){
                if(e.target!== itemEl) return;
                itemEl.removeEventListener("transitionend", handleTransition);
                item.remove();

                allCardsData.forEach(ad=>{
                    if(ad.prod_designation=== d.prod_designation && selectedCards.has(getUniqueKey(ad))){
                        selectedCards.delete(getUniqueKey(ad));
                    }
                });
                updateCartButtonsState();
                renderCartSummary();
                updateSummary();
                d3.selectAll("#cards-container .card-checkbox").each(function(cd){
                    if(cd.prod_designation=== d.prod_designation){
                        d3.select(this).property("checked",false);
                        d3.select(this.parentNode).classed("selected",false);
                    }
                });
                adjustCartSummaryHeight();
            });
        });
    });
    d3.select("#cart-summary").node().scrollTop= 0;
}
function emptyCart(){
    if(d3.select("#empty-cart-button").classed("disabled")) return;
    selectedCards.clear();
    updateCartButtonsState();
    const cartItems= d3.selectAll("#cart-items .cart-item");
    cartItems.each(function(){
        d3.select(this).classed("cart-item-removing", true);
        const itemEl= this;
        itemEl.addEventListener("transitionend", function handleTransition(e){
            if(e.target!== itemEl) return;
            itemEl.removeEventListener("transitionend", handleTransition);
            d3.select(itemEl).remove();
        });
    });
    d3.selectAll("#cards-container .card-checkbox").property("checked",false)
        .each(function(){
            d3.select(this.parentNode).classed("selected", false);
        });
    d3.select("#select-all-checkbox").property("checked",false);
    updateSummary();
    adjustCartSummaryHeight();
}

/*********************************************
 * 9) Brush (scatter-plot)
 *********************************************/
function brushEnded(event,data){
    if(!event.selection){
        filterState.brushSelection=null;
        applyAllFiltersAndUpdate();
        return;
    }
    const [[x0,y0],[x1,y1]]= event.selection;
    filterState.brushSelection= { x0,y0,x1,y1 };
    filterState.currentTab="tab-utilite-obsolescence";
    applyAllFiltersAndUpdate();
}

/*********************************************
 * 10) Modale Panier
 *********************************************/
function displayCartSummaryTable(){
    const selData= allCardsData.filter(d=> selectedCards.has(getUniqueKey(d)));
    const grouped= d3.rollups(
        selData,
        items=>({
            prod_designation: items[0].prod_designation,
            image_url: items[0].image_url,
            prod_largeur: items[0].prod_largeur,
            prod_hauteur: items[0].prod_hauteur,
            prod_profondeur: items[0].prod_profondeur,
            cli_raison_sociale: items[0].cli_raison_sociale,
            sit_nom: items[0].sit_nom,
            empl_libelle: items[0].empl_libelle,
            qte_dispo: d3.sum(items, dd=> dd.qte_dispo)
        }),
        d=> d.prod_designation
    );
    cartSummaryData= grouped.map(([_,v])=> v);

    currentPage=1;
    rowsPerPage= +d3.select("#rows-per-page").property("value");
    totalPages= Math.ceil(cartSummaryData.length/rowsPerPage);
    
    if (!window.cartTableInitialized) {
        cartSummaryData.sort((a,b)=>{
            const aa= a.prod_designation.toLowerCase();
            const bb= b.prod_designation.toLowerCase();
            return aa.localeCompare(bb);
        });
        sortState[1]="asc";
        d3.selectAll("#cart-summary-table th").classed("sort-asc",false).classed("sort-desc",false);
        d3.select("#cart-summary-table th:nth-child(2)").classed("sort-asc",true);
        window.cartTableInitialized = true;
    }
    renderTable();
    updateTopFirstImages();
    setupCartSummaryTableSorting();
}
function renderTable(){
    const tbody= d3.select("#cart-summary-table tbody");
    tbody.html("");
    const start= (currentPage-1)*rowsPerPage;
    const end= start+rowsPerPage;
    const pageData= cartSummaryData.slice(start,end);
    const curCli= clientSelect.value;

    pageData.forEach(card=>{
        const row= tbody.append("tr");
        const tdPhoto = row.append("td");
        tdPhoto.append("img")
          .attr("src", `./data/${curCli}/${card.image_url}`)
          .attr("alt", card.prod_designation.replace(/_/g,' '))
          .attr("class","cart-summary-img")
          .attr("loading","lazy")
      .attr("decoding","async")
          .style("width","50px")
          .style("cursor","pointer")
          .on("click",function(event){
              event.preventDefault();
              event.stopPropagation();
              const img = this;
              if (currentlyScaledImg === img) {
                  img.classList.remove("scaled-image");
                  img.style.transform = "";
                  img.style.position = "";
                  img.style.zIndex = "";
                  img.style.transformOrigin = "";
                  currentlyScaledImg = null;
              } else if (currentlyScaledImg && currentlyScaledImg !== img) {
                  currentlyScaledImg.classList.remove("scaled-image");
                  currentlyScaledImg.style.transform = "";
                  currentlyScaledImg.style.position = "";
                  currentlyScaledImg.style.zIndex = "";
                  currentlyScaledImg.style.transformOrigin = "";
                  img.classList.add("scaled-image");
                  img.style.zIndex = "1000";
                  img.style.position = "relative";
                  img.style.transform = "scale(2.5)";
                  img.style.transformOrigin = "bottom left";
                  currentlyScaledImg = img;
              } else {
                  img.classList.add("scaled-image");
                  img.style.zIndex = "1000";
                  img.style.position = "relative";
                  img.style.transform = "scale(2.5)";
                  img.style.transformOrigin = "bottom left";
                  currentlyScaledImg = img;
              }
              updateTopFirstImages();
              return false;
          });

        row.append("td").text(card.prod_designation.replace(/_/g,' '));
        row.append("td").text(`${card.prod_largeur}*${card.prod_hauteur}*${card.prod_profondeur}`);
        row.append("td").text(card.cli_raison_sociale);
        row.append("td").text(card.sit_nom);
        row.append("td").text(card.empl_libelle);
        row.append("td").text(card.qte_dispo);

        row.append("td")
          .append("input")
          .attr("type","number")
          .attr("min","0")
          .attr("value",card.qte_dispo)
          .style("width","60px")
          .on("input",function(){
            if(+this.value> card.qte_dispo){
                this.value= card.qte_dispo;
            }
          });

        row.append("td")
          .append("i")
            .attr("class","fa-solid fa-trash")
            .style("cursor","pointer")
            .on("click",(ev)=>{
                ev.stopPropagation();
                const rowEl = row.node();
                rowEl.offsetWidth;                            // <── reflow
                d3.select(rowEl).classed("table-row-removing", true);
                rowEl.addEventListener("transitionend", function handleRowEnd(e){
                    if(e.target!== rowEl) return;
                    rowEl.removeEventListener("transitionend", handleRowEnd);
                    d3.select(rowEl).remove();
                    allCardsData.forEach(ad=>{
                        if(ad.prod_designation=== card.prod_designation && selectedCards.has(getUniqueKey(ad))){
                            selectedCards.delete(getUniqueKey(ad));
                        }
                    });
                    updateCartButtonsState();
                    renderCartSummary();
                    updateSummary();
                    d3.selectAll("#cards-container .card-checkbox").each(function(d2){
                        if(d2.prod_designation=== card.prod_designation){
                            d3.select(this).property("checked",false);
                            d3.select(this.parentNode).classed("selected",false);
                        }
                    });
                    cartSummaryData= cartSummaryData.filter(x=> x.prod_designation!== card.prod_designation);
                    totalPages= Math.ceil(cartSummaryData.length/rowsPerPage);
                    if(currentPage> totalPages) currentPage= totalPages;
                    renderTable();
                    updatePaginationControls();
                    adjustCartSummaryHeight();
                });
            });
    });
    d3.select("#page-info").text(`Page ${currentPage} sur ${totalPages}`);
    updatePaginationControls();
    updateTopFirstImages();
}
function updatePaginationControls(){
    const prevB= d3.select("#prev-page");
    const nextB= d3.select("#next-page");
    prevB.property("disabled", currentPage===1);
    nextB.property("disabled", currentPage=== totalPages|| totalPages===0);

    prevB.on("click",()=>{
        if(currentPage>1){
            currentPage--;
            renderTable();
        }
    });
    nextB.on("click",()=>{
        if(currentPage< totalPages){
            currentPage++;
            renderTable();
        }
    });
    d3.select("#rows-per-page").on("change",function(){
        rowsPerPage= +this.value;
        totalPages= Math.ceil(cartSummaryData.length/rowsPerPage);
        currentPage=1;
        renderTable();
    });
}
function openCartSummaryModal(){
    cartSummaryModal.style.display="block";
    d3.select("body").style("overflow","hidden");
    displayCartSummaryTable();
}
function closeCartSummaryModal(){
    cartSummaryModal.style.display="none";
    d3.select("body").style("overflow","auto");
}
cartSummaryModal.addEventListener('click', (e) => {
    if (e.target === cartSummaryModal) {
        closeCartSummaryModal();
    }
});
function sortTable(colIndex, ascending){
    cartSummaryData.sort((a,b)=>{
        let av, bv;
        switch(colIndex){
            case 1:
                av= a.prod_designation.toLowerCase();
                bv= b.prod_designation.toLowerCase();
                break;
            case 2:
                av= (a.prod_largeur+"*"+a.prod_hauteur+"*"+a.prod_profondeur).toLowerCase();
                bv= (b.prod_largeur+"*"+b.prod_hauteur+"*"+b.prod_profondeur).toLowerCase();
                break;
            case 3:
                av= a.cli_raison_sociale?.toLowerCase() || "";
                bv= b.cli_raison_sociale?.toLowerCase() || "";
                break;
            case 4:
                av= a.sit_nom.toLowerCase();
                bv= b.sit_nom.toLowerCase();
                break;
            case 5:
                av= a.empl_libelle.toLowerCase();
                bv= b.empl_libelle.toLowerCase();
                break;
            case 6:
                av= a.qte_dispo;
                bv= b.qte_dispo;
                break;
            default:
                av="";
                bv="";
        }
        if(av< bv) return ascending? -1:1;
        if(av> bv) return ascending? 1:-1;
        return 0;
    });
    currentPage=1;
    d3.selectAll("#cart-summary-table th").classed("sort-asc",false).classed("sort-desc",false);
    d3.select(`#cart-summary-table th:nth-child(${colIndex+1})`)
      .classed("sort-asc", ascending)
      .classed("sort-desc", !ascending);

    renderTable();
    updatePaginationControls();
    d3.select("#cart-summary-table-container").node().scrollTop=0;
}
function setupCartSummaryTableSorting() {
    d3.selectAll("#cart-summary-table th[data-col]").on("click", function() {
        const col = parseInt(d3.select(this).attr("data-col"));
        if (col === 0 || col === 8) return;
        let ascending = true;
        if (d3.select(this).classed("sort-asc")) {
            ascending = false;
        } else if (d3.select(this).classed("sort-desc")) {
            ascending = true;
        }
        sortTable(col, ascending);
    });
}




/*********************************************
 * 11) Événements Interface (cartes)
 *********************************************/

function positionPill(activeButton) {
    const pill = document.getElementById('tab-pill');
    if (!pill || !activeButton) return;
    const buttonRect = activeButton.getBoundingClientRect();
    const tabsButtonsRect = document.getElementById('tabs-buttons').getBoundingClientRect();
    pill.style.width = `${buttonRect.width}px`;
    pill.style.left = `${buttonRect.left - tabsButtonsRect.left}px`;
}
document.addEventListener('DOMContentLoaded', () => {
    const activeButton = document.querySelector('.tab-button.active');
    positionPill(activeButton);
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('mouseenter', function() {
            if (!this.classList.contains('active')) {
                this.style.color = '#c9e8c9';
            }
        });
        button.addEventListener('mouseleave', function() {
            if (!this.classList.contains('active')) {
                this.style.color = '';
            }
        });
    });
    const corrModal = document.getElementById('corr-modal');
    if (corrModal && corrModal.parentNode !== document.body) {
        document.body.appendChild(corrModal);   // téléporte le modal hors du tab
    }
});
function switchTab(newTabButton) {
    const tabsContent   = document.getElementById('tabs-content');
    const prevActiveTab = document.querySelector('.tab-content.active');
    const newTabName    = newTabButton.getAttribute('data-tab');
    const newTab        = document.getElementById(newTabName);
    if (!newTab || newTab === prevActiveTab) return;

    /* ----- 1. UI onglets ----- */
    tabButtons.forEach(b => { b.classList.remove('active'); b.style.color = ''; });
    newTabButton.classList.add('active');

    if (prevActiveTab) {
        tabsContent.style.height = `${prevActiveTab.offsetHeight}px`;
    }
    setTimeout(() => {
        tabContents.forEach(c => { if (c !== newTab) c.classList.remove('active'); });
        newTab.classList.add('active');
        setTimeout(() => {
            tabsContent.style.height = `${newTab.offsetHeight}px`;
            setTimeout(() => { tabsContent.style.height = 'auto'; }, 400);
        }, 50);
    }, 50);

    /* ----- 2. visibilités annexes ----- */
    handleCardsVisibility(newTabName);
    filterState.currentTab = newTabName;

    /* ----- 3. Règle métier : reset « Jamais utilisé » si on entre      */
    /*        dans l’onglet Les Essentiels OU après changement de client */
    if (newTabName === "tab-les-essentiels") {
        /* état interne */
        filterState.essentialFilter   = "jamais";
        filterState.dejaUtiliseRange  = 1;

        /* boutons UI */
        const btnJamais = document.getElementById("btn-jamais-utilise");
        const btnDeja   = document.getElementById("btn-deja-utilise");
        if (btnJamais && btnDeja) {
            btnJamais.classList.add   ("active");
            btnDeja  .classList.remove("active");
            /* désactive le range */
            document.getElementById("deja-utilise-range-container")
                    .classList.add("disabled");
        }
    }

    /* ----- 4. onglets spéciaux ----- */
    if (newTabName === "tab-deep-search") {
        initializeDeepSearch();
    } else {
        document.body.style.overflow = "auto";
    }
}


/* APRÈS — bloc complet et auto-contenu */
function handleCardsVisibility(tabName) {

    const restrictedTabs = [
        "tab-deep-search",
        "tab-correlations-sorties"
    ];
    const isRestricted = restrictedTabs.includes(tabName);

    /* ---------- TABS RESTRICTED : on masque tout ---------- */
    if (isRestricted) {

        /* 1. fade-out + visibility:hidden pour la zone cartes (au lieu de display:none pour préserver le comportement sticky) */
        if (cardsSection) {
            cardsSection.style.opacity   = "0";
            cardsSection.style.transform = "translateY(20px)";
            setTimeout(() => { 
                cardsSection.style.visibility = "hidden"; 
                // On garde display:block pour préserver le contexte de positionnement sticky
                cardsSection.style.height = "0";
                cardsSection.style.overflow = "hidden";
            }, 300);
        }

        /* 2. on ferme proprement les deux barres latérales */
        sidebarLeft .classList.remove("sidebar-open");
        sidebarLeft .classList.add   ("sidebar-closed");
        sidebarRight.classList.remove("sidebar-open");
        sidebarRight.classList.add   ("sidebar-closed");

        /* 3. on remet immédiatement les marges à 0 */
        cardsSection.style.marginLeft  = "0px";
        cardsSection.style.marginRight = "0px";
        leftOpen  = false;          // on resynchronise les flags
        rightOpen = false;

        /* 4. boutons désactivés */
        const cartBtn   = document.getElementById("btn-cart");
        const filterBtn = document.getElementById("btn-filters");
        if (cartBtn)   { cartBtn.disabled = true; cartBtn.classList.add("disabled"); cartBtn.setAttribute("data-disabled","true"); }
        if (filterBtn) { filterBtn.disabled = true; filterBtn.classList.add("disabled"); filterBtn.setAttribute("data-disabled","true"); }

        return;                      // rien d’autre à faire
    }

    /* ---------- TABS AUTORISÉS : ré-affichage ---------- */

    /* 1. on montre la zone cartes sans délai superflu */
    if (cardsSection) {
        cardsSection.style.visibility = "visible";
        cardsSection.style.height = "";
        cardsSection.style.overflow = "";
        void cardsSection.offsetWidth;        // force reflow
        cardsSection.style.opacity   = "1";
        cardsSection.style.transform = "translateY(0)";
    }

    /* 2. on restaure l’état visuel en fonction des flags leftOpen/rightOpen */
    if (leftOpen) {
        sidebarLeft.classList.add("sidebar-open");
        sidebarLeft.classList.remove("sidebar-closed");
        cardsSection.style.marginLeft = "250px";
    } else {
        sidebarLeft.classList.remove("sidebar-open");
        sidebarLeft.classList.add("sidebar-closed");
        cardsSection.style.marginLeft = "0px";
    }

    if (rightOpen) {
        sidebarRight.classList.add("sidebar-open");
        sidebarRight.classList.remove("sidebar-closed");
        cardsSection.style.marginRight = "250px";
    } else {
        sidebarRight.classList.remove("sidebar-open");
        sidebarRight.classList.add("sidebar-closed");
        cardsSection.style.marginRight = "0px";
    }

    /* 3. réactivation des boutons */
    const cartBtn   = document.getElementById("btn-cart");
    const filterBtn = document.getElementById("btn-filters");
    if (cartBtn)   { cartBtn.disabled = false; cartBtn.classList.remove("disabled"); cartBtn.removeAttribute("data-disabled"); }
    if (filterBtn) { filterBtn.disabled = false; filterBtn.classList.remove("disabled"); filterBtn.removeAttribute("data-disabled"); }
}

tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        switchTab(btn);
        positionPill(btn);
        if (btn.getAttribute('data-tab') !== "tab-utilite-obsolescence") {
            filterState.brushSelection = null;
        }
        applyAllFiltersAndUpdate();
    });
});
d3.select("#btn-jamais-utilise").on("click", function(){
    filterState.essentialFilter="jamais";
    d3.select(this).classed("active",true);
    d3.select("#btn-deja-utilise").classed("active",false);
    d3.select("#deja-utilise-range-container").classed("disabled", true);
    applyAllFiltersAndUpdate();
});
d3.select("#btn-deja-utilise").on("click", function(){
    filterState.essentialFilter="deja";
    d3.select(this).classed("active",true);
    d3.select("#btn-jamais-utilise").classed("active",false);
    d3.select("#deja-utilise-range-container").classed("disabled", false);
    filterState.dejaUtiliseRange=1;
    d3.select("#deja-utilise-range").property("value",1);
    d3.select("#range-value-input").property("value",1);
    applyAllFiltersAndUpdate();
});
d3.select("#deja-utilise-range").on("input", function(){
    filterState.dejaUtiliseRange= +this.value;
    d3.select("#range-value-input").property("value", this.value);
    applyAllFiltersAndUpdate();
});
d3.select("#range-value-input").on("input", function(){
    filterState.dejaUtiliseRange= +this.value;
    d3.select("#deja-utilise-range").property("value", this.value);
    applyAllFiltersAndUpdate();
});
/* APRÈS — listener complet avec bascule automatique */
d3.select("#sort-select").on("change", function () {

    filterState.sortSelectValue = this.value;

    /* ---------- 2. cas spécial : tri « used-* » ---------- */
    if (this.value === "used-asc" || this.value === "used-desc") {

        /* 2-a. activer l’onglet « Les Essentiels » si besoin */
        const essButton = document.querySelector('.tab-button[data-tab="tab-les-essentiels"]');
        if (essButton && !essButton.classList.contains('active')) {
            switchTab(essButton);                     // fonction déjà définie
        }

        /* 2-b. forcer le mode Déjà utilisé */
        filterState.essentialFilter  = "deja";
        filterState.dejaUtiliseRange = 1;            // plein pot

        const btnJamais = d3.select("#btn-jamais-utilise");
        const btnDeja   = d3.select("#btn-deja-utilise");
        btnJamais.classed("active", false);
        btnDeja  .classed("active", true);

        d3.select("#deja-utilise-range-container")
          .classed("disabled", false);
        d3.select("#deja-utilise-range").property("value", 1);
        d3.select("#range-value-input").property("value", 1);
    }

    /* ---------- 3. mise à jour générale ---------- */
    applyAllFiltersAndUpdate();
});

d3.select("#largeur-min").on("input", function(){
    filterState.largeurMin = this.value ? +this.value : 0;
    applyAllFiltersAndUpdate();
});
d3.select("#largeur-max").on("input", function(){
    filterState.largeurMax = this.value ? +this.value : Infinity;
    applyAllFiltersAndUpdate();
});
d3.select("#hauteur-min").on("input", function(){
    filterState.hauteurMin = this.value ? +this.value : 0;
    applyAllFiltersAndUpdate();
});
d3.select("#hauteur-max").on("input", function(){
    filterState.hauteurMax = this.value ? +this.value : Infinity;
    applyAllFiltersAndUpdate();
});
d3.select("#profondeur-min").on("input", function(){
    filterState.profondeurMin = this.value ? +this.value : 0;
    applyAllFiltersAndUpdate();
});
d3.select("#profondeur-max").on("input", function(){
    filterState.profondeurMax = this.value ? +this.value : Infinity;
    applyAllFiltersAndUpdate();
});
d3.select("#search-box").on("input", function(){
    filterState.searchTerm= this.value.toLowerCase().trim();
    applyAllFiltersAndUpdate();
});
d3.select("#reset-filters-btn").on("click", ()=>{
    resetFilters();
    applyAllFiltersAndUpdate();
});
d3.select("#select-all-checkbox").on("click", function(){
    const isChecked = this.checked;
    d3.selectAll("#cards-container .card").each(function(d){
        const checkbox = d3.select(this).select(".card-checkbox");
        checkbox.property("checked", isChecked);
        const key = getUniqueKey(d);
        if(isChecked) {
            selectedCards.add(key);
        } else {
            selectedCards.delete(key);
        }
        d3.select(this).classed("selected", isChecked);
    });
    updateSelectAllCheckbox();
    updateCartButtonsState();
    renderCartSummary();
    updateSummary();
    adjustCartSummaryHeight();
});
d3.select("#site-search-box").on("input", function(){
    applyAllFiltersAndUpdate();
});
d3.select("#emplacement-search-box").on("input", function(){
    applyAllFiltersAndUpdate();
});
cartSummaryCloseModalBtn.onclick= ()=> closeCartSummaryModal();
emptyCartButton.on("click", ()=>{
    if(!emptyCartButton.classed("disabled")){
        if(confirm("Voulez-vous vraiment vider le panier ?")){
            emptyCart();
        }
    }
});
validateCartButton.on("click", ()=>{
    if(!validateCartButton.classed("disabled")){
        openCartSummaryModal();
    }
});
d3.select("#cart-summary-table th#delete-all-header").on("click", function(){
    const st= d3.select("#modal-search-box").property("value").trim();
    if(st.length>0){
        if(confirm("Êtes-vous sûr de vouloir supprimer tous les éléments visibles de la liste ?")){
            cartSummaryData.forEach(item=>{
                allCardsData.forEach(ad=>{
                    if(ad.prod_designation=== item.prod_designation && selectedCards.has(getUniqueKey(ad))){
                        selectedCards.delete(getUniqueKey(ad));
                    }
                });
                d3.selectAll("#cards-container .card-checkbox").each(function(d){
                    if(d.prod_designation=== item.prod_designation){
                        d3.select(this).property("checked",false);
                        d3.select(this.parentNode).classed("selected",false);
                    }
                });
            });
            d3.select("#modal-search-box").property("value","");
            cartSummaryData=[];
            updateCartButtonsState();
            renderCartSummary();
            updateSummary();
            displayCartSummaryTable();
        }
    } else {
        if(confirm("Êtes-vous sûr de vouloir vider le panier ?")){
            emptyCart();
            closeCartSummaryModal();
        }
    }
});
d3.select("#modal-search-box").on("input", function(){
    const st= this.value.toLowerCase();
    cartSummaryData=[];
    const selData= allCardsData.filter(d=> selectedCards.has(getUniqueKey(d)));
    let grouped= d3.rollups(
        selData,
        items=>({
            prod_designation: items[0].prod_designation,
            image_url: items[0].image_url,
            prod_largeur: items[0].prod_largeur,
            prod_hauteur: items[0].prod_hauteur,
            prod_profondeur: items[0].prod_profondeur,
            cli_raison_sociale: items[0].cli_raison_sociale,
            sit_nom: items[0].sit_nom,
            empl_libelle: items[0].empl_libelle,
            qte_dispo: d3.sum(items, dd=>dd.qte_dispo)
        }),
        d=> d.prod_designation
    );
    let arr= grouped.map(([_,v])=> v);
    if(st.length>0){
        arr= arr.filter(x=>{
            const bigStr= (x.prod_designation+" "+ x.cli_raison_sociale+" "+x.sit_nom+" "+x.empl_libelle).toLowerCase();
            return bigStr.includes(st);
        });
    }
    cartSummaryData= arr;
    totalPages= Math.ceil(cartSummaryData.length/rowsPerPage);
    currentPage=1;
    renderTable();
    updatePaginationControls();
    adjustCartSummaryHeight();
});
document.querySelectorAll('.search-box-container').forEach(c=>{
    const inp= c.querySelector('input[type="text"]');
    const clearB= c.querySelector('.clear-button');
    if(!inp) return;
    clearB.style.display= inp.value.trim().length>0?'block':'none';
    inp.addEventListener('input', ()=>{
        if(inp.value.trim().length>0){
            clearB.style.display='block';
        } else {
            clearB.style.display='none';
        }
    });
    clearB.addEventListener('click', ()=>{
        inp.value='';
        clearB.style.display='none';
        inp.dispatchEvent(new Event('input'));
    });
});
backToTopButton.on("click", ()=>{
    window.scrollTo({top:0, behavior:"smooth"});
});
function closeLoginSection() {
    loginSection.style.display = "none";
    connectionValidationButton.classList.remove('active');
}
connectionValidationButton.onclick = (e) => {
    e.stopPropagation();
    if (loginSection.style.display === "none") {
        loginSection.style.display = "block";
        connectionValidationButton.classList.add('active');
    } else {
        closeLoginSection();
    }
};
document.addEventListener('click', (e) => {
    if (loginSection.style.display === "block") {
        if (!loginSection.contains(e.target) && e.target !== connectionValidationButton && !connectionValidationButton.contains(e.target)) {
            closeLoginSection();
        }
    }
});
const closeLoginButton = document.getElementById("close-login-section");
if (closeLoginButton) {
    closeLoginButton.addEventListener('click', () => {
        closeLoginSection();
    });
}
modalLoginButton.onclick= ()=>{
    const user= document.getElementById("modal-username").value.trim();
    const pass= document.getElementById("modal-password").value.trim();
    if(!user || !pass){
        alert("Veuillez remplir les champs Identifiant et Mot de passe.");
        return;
    }
    alert("Connexion réussie !");
    loginSection.style.display="none";
};

/*********************************************
 * Ajustement hauteur du panier
 *********************************************/
function adjustCartSummaryHeight(){
    const summary= document.getElementById('summary');
    const cartSummary= document.getElementById('cart-summary');
    if(!summary || !cartSummary) return;
    const sH= summary.offsetHeight;
    const wh= window.innerHeight;
    const maxH= wh - (sH + 100);
    cartSummary.style.maxHeight= maxH+"px";
}
window.addEventListener('resize',()=>{
    adjustCartSummaryHeight();
});
window.addEventListener('load',()=>{
    adjustCartSummaryHeight();
    loadClients();
    d3.select("#btn-jamais-utilise").classed("active",true);
    d3.select("#cards-container").html("");
    updateTopFirstImages();
});


/*********************************************
 * CHARGEMENT DES DONNÉES
 *********************************************/
function loadClients(){
    fetch('./data/clients.json')
    .then(r=> r.json())
    .then(data=>{
        clientSelect.innerHTML= '<option value="" disabled selected>Choisissez un client...</option>';
        data.clients.forEach(cli=>{
            const opt= document.createElement('option');
            opt.value= cli;
            opt.textContent= cli;
            clientSelect.appendChild(opt);
        });
        clientSelect.addEventListener('change', function(){
            resetFilters();
            filterState.currentTab="tab-les-essentiels";
            filterState.essentialFilter="jamais";
            filterState.dejaUtiliseRange=1;

            tabButtons.forEach(b=> b.classList.remove('active'));
            tabContents.forEach(c=> c.classList.remove('active'));
            const essentielsTabButton = document.querySelector(`.tab-button[data-tab="tab-les-essentiels"]`);
            essentielsTabButton.classList.add('active');
            document.getElementById("tab-les-essentiels").classList.add('active');
            document.getElementById("btn-jamais-utilise").classList.add('active');
            document.getElementById("btn-deja-utilise").classList.remove('active');
            positionPill(essentielsTabButton);

            selectedCards.clear();
            updateSummary();
            updateCartButtonsState();
            filterState.selectedSites.clear();
            filterState.selectedEmplacements.clear();

            loadClientData(this.value);
        });
    })
    .catch(e=> console.error("Erreur clients.json:", e));
}
function loadClientData(cli){
    console.log("✓ Client chargé", cli);
    selectedCards.clear();
    updateSummary();
    updateCartButtonsState();
    alreadyUsedCountMap.clear();
    jamaisUtiliseProdNames=[];
    sortiesParProduitTrie=[];

    const sortiePath= `./data/${cli}/sorties_par_produit_trie.csv`;
    d3.csv(sortiePath).then(data=>{
        sortiesParProduitTrie=data;
        data.forEach(row=>{
            alreadyUsedCountMap.set(row.prod_designation, +row.count_S);
        });
    })
    .catch(()=>{})
    .finally(()=>{
        const zeroPath= `./data/${cli}/zero_sortie.csv`;
        d3.csv(zeroPath).then(zData=>{
            jamaisUtiliseProdNames= zData.map(z=> z.prod_designation);
        })
        .catch(()=>{})
        .finally(()=>{
            const dataPath= `./data/${cli}/data.json`;
            svg.selectAll("*").remove();

            d3.json(dataPath).then(dd=>{
                dd.forEach(d=>{
                    d['Obsolescence (mois)']= +d['Obsolescence (mois)'];
                    d['taux_utilité']= +d['taux_utilité'];
                    d.prod_largeur= +d.prod_largeur;
                    d.prod_hauteur= +d.prod_hauteur;
                    d.prod_profondeur= +d.prod_profondeur;
                    d.qte_dispo= +d.qte_dispo;
                });
                // ---------------- index des images ----------------
                prodImageMap.clear();
                dd.forEach(d => prodImageMap.set(d.prod_designation, d.image_url));

                allCardsData= dd;

                xScale= d3.scaleLinear()
                  .domain([-0.1, d3.max(dd,d=> d['taux_utilité'])*1.1])
                  .range([0,width]);
                yScale= d3.scaleLinear()
                  .domain([0, d3.max(dd,d=> d['Obsolescence (mois)'])*1.1])
                  .range([height,0]);

                svg.append("g")
                  .attr("transform",`translate(0,${height})`)
                  .call(d3.axisBottom(xScale));
                svg.append("g")
                  .call(d3.axisLeft(yScale));

                svg.append("text")
                  .attr("x", width/2)
                  .attr("y", height+40)
                  .style("font-size","16px")
                  .attr("fill","white")
                  .text("Taux d'utilité");

                svg.append("text")
                  .attr("transform","rotate(-90)")
                  .attr("y",-60)
                  .attr("x",-height/2)
                  .style("text-anchor", "start")
                  .style("fill", "white")
                  .text("Obsolescence (mois)");

                // Légende sur trois lignes pour éviter tout chevauchement
                const legendLabels= [
                    { color: "green", label:"peu utilisé récemment"},
                    { color: "black", label:"très utilisé non récemment"},
                    { color: "blue", label:"très utilisé récemment"},
                    { color: "red", label:"peu utilisé non récemment"},
                    { color: "yellow", label:"Jamais utilisé"}
                ];
                
                // Créer un groupe de légende centralisé sous l'axe des abscisses
                // Placement de la légende sur deux lignes, alignée sous l'intitulé de l'axe des X
                
                // Position Y absolue pour assurer qu'elle apparaisse sous l'axe des X
                // L'axe des X est à height, l'intitulé est à height + 40, donc la légende commence après
                const legendPosY1 = height + 65; // Première ligne de légende
                const legendPosY2 = height + 95; // Deuxième ligne de légende
                
                // Disposition des légendes sur deux lignes
                const legendByRow = [
                    // Première ligne
                    [legendLabels[0], legendLabels[4], legendLabels[2]],
                    // Deuxième ligne
                    [legendLabels[3], legendLabels[1]]
                ];

                // Création des légendes, ligne par ligne
                legendByRow.forEach((rowItems, rowIndex) => {
                    // Position Y selon la ligne
                    const yPos = rowIndex === 0 ? legendPosY1 : legendPosY2;
                    
                    // Calcul de la largeur totale de cette ligne pour le centrage
                    let totalLineWidth = 0;
                    
                    // Créer un groupe par ligne pour faciliter le centrage
                    const lineGroup = svg.append("g")
                        .attr("class", "legend-line")
                        .attr("transform", `translate(${width/2}, ${yPos})`);
                    
                    // Ajouter les éléments de légende dans cette ligne
                    rowItems.forEach((item, i) => {
                        // Écart entre les éléments de légende
                        const spacing = 220;
                        
                        // Positionnement horizontal: décaler chaque élément par rapport au centre
                        // Pour 3 éléments: -spacing, 0, +spacing
                        // Pour 2 éléments: -spacing/2, +spacing/2
                        let xOffset;
                        if (rowItems.length === 3) {
                            xOffset = (i - 1) * spacing;
                        } else { // 2 éléments
                            xOffset = (i - 0.5) * spacing;
                        }
                        
                        // Créer l'élément de légende
                        const legendItem = lineGroup.append("g")
                            .attr("class", "legend")
                            .attr("transform", `translate(${xOffset}, 0)`);
                        
                        // Rectangle de couleur
                        legendItem.append("rect")
                            .attr("width", 14)
                            .attr("height", 14)
                            .attr("x", -7) // Centrer le rectangle
                            .style("fill", item.color);
                        
                        // Texte de légende
                        legendItem.append("text")
                            .attr("x", 12)
                            .attr("y", 7)
                            .attr("dy", ".35em")
                            .attr("text-anchor", "start")
                            .style("fill", "white")
                            .style("font-size", "14px") // Police de taille 14px comme demandé
                            .text(item.label);
                    });
                });

                const dotsGroup = svg.append('g');
                function animateScatterPlot() {
                    dotsGroup.selectAll("circle").remove();
                    const dots = dotsGroup
                      .selectAll("circle")
                      .data(dd)
                      .enter()
                      .append("circle")
                      .attr("cx", d => xScale(d['taux_utilité']))
                      .attr("cy", d => yScale(d['Obsolescence (mois)']))
                      .attr("r", 6)
                      .style("fill", getColor)
                      .style("opacity", 0.7);
                }
                animateScatterPlot();
                const brush= d3.brush()
                  .extent([[0,0],[width,height]])
                  .on("end",(evt)=> brushEnded(evt, dd));
                svg.append("g")
                  .attr("class","brush")
                  .call(brush);

                /* CORRÉLATIONS ----------------------------------------------- */
                console.log("🚀 appel loadCorrelationsFiles");
                loadCorrelationsFiles(cli).then(() => {

                    /* a) premier rendu complet ------------------------------- */
                    renderCorrelationCards();

                    /* b) branchement du champ de recherche ------------------- */
                    const corrSearchInput = document.getElementById("corr-search-box");
                    const corrSearchClear = document.querySelector("#corr-search-container .clear-button");

                    if (corrSearchInput) {

                        /* saisie utilisateur  */
                        corrSearchInput.addEventListener("input", function () {
                            corrFilterState.searchTerm = this.value.toLowerCase().trim();
                            corrSearchClear.style.display = this.value.trim() ? "block" : "none";
                            applyCorrSearch();
                        });

                        /* bouton ✕ pour vider */
                        corrSearchClear.addEventListener("click", () => {
                            corrSearchInput.value = "";
                            corrSearchClear.style.display = "none";
                            corrFilterState.searchTerm = "";
                            applyCorrSearch();
                        });
                    }
                });


                computeSiteVolumes(cli)       // calcule + dessine le camembert
                    .then(applyAllFiltersAndUpdate); // puis rafraîchit l’UI
            });
        });
    });
}

/*********************************************
 * -------------------------------------------
 *        DEEPSEARCH IMPLEMENTATION
 * -------------------------------------------
 *********************************************/

/**
 * Variable globale pour DeepSearch
 */
let dsData = [];                // Tableau d'objets pour l'intégralité du CSV.
let dsColumns = [];             // Liste des colonnes (nom exact).
let dsSelectedColumns = [];     // Colonnes affichées actuellement.
let dsSortConfigs = [];         // [{colIndex, dir}, ...] pour tri multi-colonnes
let dsFilters = [];             // { colIndex, operator, value }
let dsCurrentPage = 1;
let dsRowsPerPage = 500;
let dsTotalPages = 1;

/**
 * Initialisation de l’onglet DeepSearch
 */
function initializeDeepSearch(){
    // Empêcher de scroller la page principale
    document.body.style.overflow = "hidden";

    // Vérifier si déjà initialisé
    const table = document.getElementById('deepsearch-table');
    if(!table || table.getAttribute('data-ds-initialized') === 'true'){
        return;
    }
    table.setAttribute('data-ds-initialized','true');

     // Ajouter le scroll horizontal au conteneur du tableau
     document.getElementById('deepsearch-table-container').style.overflowX = "auto";
    // Afficher le loader
    const loader = document.getElementById('deepsearch-loader');
    loader.style.display = 'flex';

    // Lancer le chargement du CSV
    loadDSCsvData('./data/merged_history.csv')
      .then(() => {
          loader.style.display = 'none';
          buildDeepSearchTable();
      })
      .catch(err => {
          loader.style.display = 'none';
          const errEl = document.getElementById('deepsearch-error');
          errEl.style.display = 'flex';
          const msg = document.getElementById('deepsearch-error-message');
          msg.textContent = "Le fichier ./data/merged_history.csv est introuvable ou illisible. Veuillez vérifier...";
          console.error(err);
      });
}

/**
 * Chargement + Parsing CSV volumineux
 */
function loadDSCsvData(csvPath){
    return new Promise((resolve,reject)=>{
        const xhr = new XMLHttpRequest();
        xhr.open('GET', csvPath, true);
        xhr.responseType = 'text';

        xhr.onload = ()=>{
            if(xhr.status >=200 && xhr.status <300){
                const raw = xhr.responseText;
                parseDSCsv(raw);
                resolve(true);
            } else {
                reject("Erreur HTTP: " + xhr.status);
            }
        };
        xhr.onerror = ()=>{
            reject("Erreur réseau ou CORS");
        };
        xhr.send();
    });
}

/**
 * Parsing CSV Manuel (ou simplifié)
 */
function parseDSCsv(rawCsv){
    // Supposons qu’il y a une première ligne d’en-têtes
    // On split par lignes
    let lines = rawCsv.split(/\r?\n/).filter(l => l.trim().length>0);
    // Extraire en-tête
    const headerLine = lines.shift();
    dsColumns = headerLine.split(",");
    // Par défaut : on affiche les 10 premières colonnes, la 1ère colonne est verrouillée
    // On garde toujours la première colonne, plus 9 suivantes => 10 par défaut
    dsSelectedColumns = dsColumns.slice(0,10);

    dsData = lines.map(line => {
        const tokens = line.split(",");
        // Convertir en objet
        const obj = {};
        dsColumns.forEach((col, idx)=>{
            obj[col] = tokens[idx]!==undefined ? tokens[idx] : '';
        });
        return obj;
    });
    dsSortConfigs = [];
    dsFilters = dsColumns.map((c,i)=>({
        colIndex: i,
        operator: 'like',
        value: ''
    }));
}

/**
 * Construction du tableau + events
 */
function buildDeepSearchTable(){
    // Créer l’en-tête + filters
    buildDSTableHeader();
    // Générer le dropdown de colonnes
    buildDSColumnDropdown();
    // Appliquer un tri initial / pagination
    dsRowsPerPage = parseInt(document.getElementById('ds-rows-per-page').value,10) || 500;
    dsCurrentPage = 1;
    recomputeDSTable();
    // Ajouter events sur pagination
    setupDSPagination();
    // Gérer la toolbar (colonnes, reset, export)
    setupDSToolbarActions();
}

/**
 * Construction de l'en-tête + champs de filtrage
 */
function buildDSTableHeader(){
    const table = document.getElementById('deepsearch-table');
    const thead = table.querySelector('thead');
    thead.innerHTML = ''; // reset

    const trHeader = document.createElement('tr');
    dsSelectedColumns.forEach((col, idx)=>{
        const th = document.createElement('th');
        th.textContent = col;
        // Ajout d'un conteneur handle pour le resize
        const resizer = document.createElement('div');
        resizer.classList.add('ds-col-resizer');
        th.appendChild(resizer);

        // Click tri simple ou multi-colonnes
        th.addEventListener('click',(e)=>{
            // Éviter le clic sur le resizer
            if(e.target === resizer) return;
            handleDSSortClick(idx, e.shiftKey);
        });

        // Indicateur si la colonne est la 1ère du CSV (verrouillée)
        // -> On l’affiche de toute façon, pas de masquage possible
        trHeader.appendChild(th);
    });
    thead.appendChild(trHeader);

    // Ligne de filtre
    const trFilter = document.createElement('tr');
    dsSelectedColumns.forEach((col, idx)=>{
        const td = document.createElement('td');
        // Rechercher index global
        const globalIndex = dsColumns.indexOf(col);
        const filterObj = dsFilters[globalIndex];

        const filterContainer = document.createElement('div');
        filterContainer.style.display = 'flex';
        filterContainer.style.flexWrap = 'wrap';
        filterContainer.style.gap = '4px';

        // Input
        const inp = document.createElement('input');
        inp.type='text';
        inp.classList.add('ds-header-filter');
        inp.value = filterObj.value;
        inp.placeholder = 'Filtre...';
        inp.addEventListener('input',()=>{
            filterObj.value = inp.value;
            dsCurrentPage=1;
            recomputeDSTable();
        });

        //filterContainer.appendChild(sel);
        filterContainer.appendChild(inp);

        td.appendChild(filterContainer);
        trFilter.appendChild(td);
    });
    thead.appendChild(trFilter);

    // Rendre les colonnes resizables
    activateDSColumnResizing();
}

/**
 * Appliquer tri + filtres + pagination => dessiner TBody
 */
function recomputeDSTable(){
    const table = document.getElementById('deepsearch-table');
    const tbody = table.querySelector('tbody');
    tbody.innerHTML='';

    // 1) Appliquer tous les filtres
    let filteredData = dsData.filter(row=>{
        return dsFilters.every(f => {
            const val = row[dsColumns[f.colIndex]];
            // Utiliser toujours 'like' comme opérateur par défaut
            return dsPassFilter(val, 'like', f.value);
        });
    });

    // 2) Appliquer tri multi-colonnes
    if(dsSortConfigs.length>0){
        filteredData.sort((a,b)=>{
            for(let conf of dsSortConfigs){
                const colIndex = conf.colIndex;
                const dir = conf.dir; // 'asc' ou 'desc'
                const colName = dsSelectedColumns[colIndex]; 
                // IMPORTANT : colIndex = index local, on doit retrouver la col globale:
                const globalColName = colName;

                const av = a[globalColName];
                const bv = b[globalColName];

                const avNum = parseFloat(av);
                const bvNum = parseFloat(bv);
                let cmp=0;

                // Détecter si la valeur est une date au format DD/MM/YYYY
                const isDateFormat = (val) => {
                    return typeof val === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(val);
                };

                // Si c'est une date, convertir et comparer comme dates
                if (isDateFormat(av) && isDateFormat(bv)) {
                    const [dayA, monthA, yearA] = av.split('/').map(Number);
                    const [dayB, monthB, yearB] = bv.split('/').map(Number);
                    
                    const dateA = new Date(yearA, monthA - 1, dayA);
                    const dateB = new Date(yearB, monthB - 1, dayB);
                    
                    if (dateA < dateB) cmp = -1;
                    else if (dateA > dateB) cmp = 1;
                }
                // Sinon essayer comme nombres
                else if(!isNaN(avNum) && !isNaN(bvNum)){
                    if(avNum<bvNum) cmp=-1;
                    else if(avNum>bvNum) cmp=1;
                } else {
                    // Comparaison string
                    if(av< bv) cmp=-1;
                    else if(av> bv) cmp=1;
                }
                if(cmp!==0){
                    return dir==='asc'? cmp : -cmp;
                }
            }
            return 0;
        });
    }

    // 3) Pagination
    dsRowsPerPage = parseInt(document.getElementById('ds-rows-per-page').value,10) || 500;
    dsTotalPages = Math.ceil(filteredData.length / dsRowsPerPage);
    if(dsCurrentPage>dsTotalPages) dsCurrentPage= dsTotalPages<1?1: dsTotalPages;
    const start = (dsCurrentPage-1)* dsRowsPerPage;
    const end = start + dsRowsPerPage;
    const pageData = filteredData.slice(start,end);

    // 4) Générer les lignes
    pageData.forEach(row=>{
        const tr = document.createElement('tr');
        dsSelectedColumns.forEach(col=>{
            const td = document.createElement('td');
            const cellVal = row[col];
            td.textContent = cellVal;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    // Mettre à jour info pagination
    document.getElementById('ds-page-info').textContent = 
        `Page ${dsCurrentPage} / ${dsTotalPages || 1}`;
}

/*
 * Test d'un filtre simple - recherche multi-mots (chaque mot doit être présent)
 */
function dsPassFilter(val, operator, filterVal){
    // Si le filtre est vide => tout passe
    if(!filterVal || filterVal.trim() === '') return true;
    
    // Conversion des valeurs en minuscules pour recherche insensible à la casse
    const valLower = (val || '').toString().toLowerCase();
    const filterWords = filterVal.toLowerCase().split(/\s+/).filter(word => word.length > 0);
    
    // Vérifier que chaque mot du filtre est présent dans la valeur
    return filterWords.every(word => valLower.indexOf(word) >= 0);
}

/**
 * Gestion du clic sur l'en-tête => tri
 */
function handleDSSortClick(localColIndex, isMulti){
    const thead = document.querySelector('#deepsearch-table thead tr');
    const allTH = thead.querySelectorAll('th');
    const targetTH = allTH[localColIndex];

    // Récup dir actuel
    let existingConf = dsSortConfigs.find(c=> c.colIndex=== localColIndex);
    let newDir = 'asc';
    if(existingConf){
        // si asc => desc, si desc => enlever la config
        if(existingConf.dir==='asc'){
            existingConf.dir='desc';
        } else {
            // on supprime l’entrée => cycle complet
            dsSortConfigs = dsSortConfigs.filter(c=> c.colIndex!== localColIndex);
        }
    } else {
        // creer
        dsSortConfigs.push({colIndex: localColIndex, dir: newDir});
    }

    // Si pas multi => on remove tous les autres
    if(!isMulti){
        const found = dsSortConfigs.find(c=> c.colIndex=== localColIndex);
        dsSortConfigs = found? [found] : [];
    }

    dsCurrentPage=1;
    recomputeDSTable();

    // Visuel
    // On retire toutes les classes .ds-sort-asc .ds-sort-desc
    allTH.forEach(th=>{
        th.classList.remove('ds-sort-asc','ds-sort-desc');
    });
    dsSortConfigs.forEach(conf=>{
        const colTh = allTH[conf.colIndex];
        if(conf.dir==='asc'){
            colTh.classList.add('ds-sort-asc');
        } else {
            colTh.classList.add('ds-sort-desc');
        }
    });
}

/**
 * Rendre colonnes resizables
 */
function activateDSColumnResizing(){
    const thead = document.querySelector('#deepsearch-table thead tr');
    const allTH = thead.querySelectorAll('th');
    allTH.forEach((th, idx)=>{
        const resizer = th.querySelector('.ds-col-resizer');
        if(!resizer) return;
        let startX, startWidth;

        resizer.addEventListener('mousedown',(e)=>{
            e.preventDefault();
            startX = e.pageX;
            startWidth = th.offsetWidth;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
        function onMouseMove(e){
            const newWidth = startWidth + (e.pageX - startX);
            if(newWidth>40){
                th.style.width= newWidth+'px';
            }
        }
        function onMouseUp(e){
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }
    });
}

/**
 * Générer la liste de colonnes + cases à cocher
 */
function buildDSColumnDropdown(){
    const colsList = document.getElementById('ds-columns-list');
    colsList.innerHTML='';
    dsColumns.forEach((col, idx)=>{
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type='checkbox';
        // La 1ère colonne (idx=0) est toujours cochée et désactivée
        if(idx===0){
            cb.checked=true;
            cb.disabled=true;
        } else {
            cb.checked = dsSelectedColumns.includes(col);
        }
        cb.addEventListener('change',()=>{
            if(cb.checked){
                if(!dsSelectedColumns.includes(col)){
                    // Insert col dans dsSelectedColumns à la place idx
                    // => pour conserver l'ordre original
                    const pos = dsColumns.indexOf(col);
                    // On veut que l’ordre de dsSelectedColumns suive l’ordre du CSV
                    // => on le reconstruit proprement
                    dsSelectedColumns = dsColumns.filter((c,i)=> i===0 || dsSelectedColumns.includes(c) || c===col);
                }
            } else {
                if(dsSelectedColumns.includes(col)){
                    dsSelectedColumns = dsSelectedColumns.filter(c => c!==col);
                }
            }
            dsCurrentPage=1;
            buildDSTableHeader();
            recomputeDSTable();
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(col));
        colsList.appendChild(label);
    });
}

/**
 * Toolbar : col toggles, reset, export, etc.
 */
function setupDSToolbarActions(){
    const colToggleBtn = document.getElementById('ds-column-toggle-btn');
    const colDropdown = document.getElementById('ds-columns-dropdown');

    colToggleBtn.addEventListener('click',(e)=>{
        e.stopPropagation();
        colDropdown.classList.toggle('hidden');
    });
    document.addEventListener('click',(e)=>{
        if(!colDropdown.contains(e.target) && e.target!==colToggleBtn){
            colDropdown.classList.add('hidden');
        }
    });

    document.getElementById('ds-col-select-all').addEventListener('click',()=>{
        dsSelectedColumns = dsColumns.slice(); 
        // la 1ère colonne reste toujours => c’est ok
        // Mais on la garde en premier
        dsCurrentPage=1;
        buildDSTableHeader();
        recomputeDSTable();
        buildDSColumnDropdown();
    });
    document.getElementById('ds-col-unselect-all').addEventListener('click',()=>{
        // On ne peut pas déselectionner la première
        dsSelectedColumns = [dsColumns[0]];
        dsCurrentPage=1;
        buildDSTableHeader();
        recomputeDSTable();
        buildDSColumnDropdown();
    });

    // Reset Tri & Filtres
    document.getElementById('ds-reset-btn').addEventListener('click',()=>{
        dsSortConfigs=[];
        dsFilters.forEach(f=>{
            f.operator='like';
            f.value='';
        });
        dsCurrentPage=1;
        buildDSTableHeader();
        recomputeDSTable();
    });

    // Export
    const exportBtn = document.getElementById('ds-export-btn');
    const exportDd = document.getElementById('ds-export-dropdown');
    exportBtn.addEventListener('click',(e)=>{
        e.stopPropagation();
        exportDd.classList.toggle('hidden');
    });
    document.addEventListener('click',(e)=>{
        if(!exportDd.contains(e.target) && e.target!==exportBtn){
            exportDd.classList.add('hidden');
        }
    });
    document.getElementById('ds-export-all').addEventListener('click',()=>{
        doDSExport(false);
    });
    document.getElementById('ds-export-filtered').addEventListener('click',()=>{
        doDSExport(true);
    });
}

/**
 * Pagination
 */
function setupDSPagination(){
    document.getElementById('ds-page-prev').addEventListener('click',()=>{
        if(dsCurrentPage>1){
            dsCurrentPage--;
            recomputeDSTable();
        }
    });
    document.getElementById('ds-page-next').addEventListener('click',()=>{
        if(dsCurrentPage< dsTotalPages){
            dsCurrentPage++;
            recomputeDSTable();
        }
    });
    document.getElementById('ds-rows-per-page').addEventListener('change',()=>{
        dsRowsPerPage = parseInt(document.getElementById('ds-rows-per-page').value,10);
        dsCurrentPage=1;
        recomputeDSTable();
    });
}

    /**
     * Export XLSX
     */
    function doDSExport(filteredOnly){
        let rawData;
        if(!filteredOnly){
            // export tout
            rawData = dsData;
        } else {
            // Appliquer filtres
            rawData = dsData.filter(row=>{
                return dsFilters.every(f => {
                    const val = row[dsColumns[f.colIndex]];
                    return dsPassFilter(val, f.operator, f.value);
                });
            });
        }
        // On veut un tableau d’objets ne contenant que les dsSelectedColumns
        // OU on exporte toutes les colonnes ??? => le cahier des charges précise:
        // "Exporter tout" => TOUT (toutes colonnes), 
        // "Exporter filtré" => (uniquement les données filtrées, mais TOUTES LES COLONNES ou seulement les colonnes affichées?)
        // On choisit: TOUTES les colonnes => "Exporter tout" ; 
        // Filtré => on exporte TOUTES LES COLONNES mais seulement les lignes filtrées.
        // Ajuster si vous souhaitez seulement les colonnes visibles.

        const columnsToExport = dsColumns; 

        const aoa = [];
        aoa.push(columnsToExport); // première ligne => entêtes
        rawData.forEach(row=>{
            const line = columnsToExport.map(c => row[c]);
            aoa.push(line);
        });

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "DeepSearch");
        XLSX.writeFile(wb, "export_deepsearch.xlsx");

        // Confirmation
        const msg = document.createElement('div');
        msg.textContent = "Export effectué";
        msg.style.color = 'lime';
        msg.style.position = 'absolute';
        msg.style.top = '0';
        msg.style.right = '0';
        msg.style.margin='10px';
        msg.style.zIndex='9999';
        document.body.appendChild(msg);
        setTimeout(()=>{
            if(msg.parentNode) msg.parentNode.removeChild(msg);
        }, 5000);
    }


/* ==================================================
   CORRELATIONS DES SORTIES : fonctions principales
   ================================================== */

/* 1. Chargement des trois fichiers ------------------------------------ */
function loadCorrelationsFiles(client){
    console.log("📥 début chargement corrélations");
    return Promise.all([
        d3.json(`./data/${client}/data.json`),
        d3.csv(`./data/${client}/sorties_par_produit_trie.csv`, d3.autoType),
        d3.json(`./data/${client}/cooccurrence.json`)
    ]).then(([dataJson, popCsv, matrix])=>{
        console.log("✅ Fichiers OK",
            dataJson.length,               // nb produits
            popCsv.length,                 // nb lignes popularité
            Object.keys(matrix).length);   // nb clés matrice
        // Si le fichier est au format {products:[…], matrix:[[…]]}
        if (Array.isArray(matrix.products) && Array.isArray(matrix.matrix)) {
            const prodList = matrix.products;
            const rows     = matrix.matrix;
            const conv = {};
            prodList.forEach((prod, i) => {
                const rowObj = {};
                rows[i].forEach((val, j) => {
                    rowObj[prodList[j]] = val;
                });
                conv[prod] = rowObj;
            });
            matrix = conv;            // 🔄 on écrase par la version “objet”
        }
        // matrice
        corrMatrix = matrix;

        // popularité
        popCsv.forEach(r=>{
            corrPopularityMap.set(r.prod_designation, +r.sprod_sur_Stotal);
        });

        // ne conserver que les produits présents dans la matrice
        corrCardsData = dataJson.filter(d => corrMatrix[d.prod_designation] !== undefined);

        // tri décroissant de popularité
        corrCardsData.sort((a,b)=>
            d3.descending(
                corrPopularityMap.get(a.prod_designation) || 0,
                corrPopularityMap.get(b.prod_designation) || 0
            )
        );
    });
}

/*  Ⓐ version interne qui prend un tableau déjà filtré */
function renderCorrelationCardsInner(arr){
    const container = d3.select("#correlations-cards-container").html("");

    container.selectAll(".card")
        .data(arr)
        .enter()
        .append("div")
            .attr("class","card")
            .style("position","relative")
            .on("click", openCorrModal)
            .each(function(d){
                const c = d3.select(this);
                // image
                c.append("img")
                 .attr("src", `./data/${clientSelect.value}/${d.image_url}`)
                 .attr("alt", d.prod_designation.replace(/_/g," "));
                // titre
                c.append("div")
                 .attr("class","card-content")
                 .html(`<b>${d.prod_designation.replace(/_/g," ")}</b>`);
                // badge popularité
                const pop = corrPopularityMap.get(d.prod_designation) || 0;
                c.append("div")
                 .attr("class","popularity-pill")
                 .text((pop*100).toFixed(1)+" %");
            });
}

/*  Ⓑ wrapper public : reset filtre, affiche tout */
function renderCorrelationCards(){
    corrFilterState.searchTerm = "";
    d3.select("#corr-search-box").property("value","");
    renderCorrelationCardsInner(corrCardsData);
}



/* =====================================================
Filtrage dynamique sur le champ corr-search-box
===================================================== */
function openCorrModal (e, d) {

    corrSelectedKey = d.prod_designation;

    /* construction du corps (gauche + droite) */
    const corrBody  = d3.select("#corr-companions").html("");
    const flexWrap  = corrBody.append("div").attr("class", "corr-flex");

    /* 1. colonne gauche : carte sélectionnée */
    const selectedWrapper = flexWrap.append("div").attr("id", "corr-selected");
    const selectedCard    = selectedWrapper.append("div")
                           .attr("class", "card corr-selected-card");

    selectedCard.append("img")
        .attr("src", `./data/${clientSelect.value}/${d.image_url}`)
        .attr("alt", d.prod_designation.replace(/_/g, " "));
    selectedCard.append("div")
        .attr("class", "card-content")
        .html(`<b>${d.prod_designation.replace(/_/g, " ")}</b>`);
    selectedCard.append("div")
        .attr("class", "popularity-pill")
        .text(((corrPopularityMap.get(d.prod_designation) || 0) * 100).toFixed(1) + " %");

    /* 2. colonne droite : cartes companions */
    const right = flexWrap.append("div").attr("class", "companion-container");

    const line       = corrMatrix[corrSelectedKey] || {};
    const companions = Object.keys(line)
        .filter(k => k !== corrSelectedKey && line[k] > 0)
        .sort((a, b) => d3.descending(line[a], line[b]));

    companions.forEach(key => {
        const cd = corrCardsData.find(x => x.prod_designation === key);
        if (!cd) return;
        const c = right.append("div").attr("class", "card companion");
        c.append("img")
         .attr("src", `./data/${clientSelect.value}/${cd.image_url}`)
         .attr("alt", key.replace(/_/g, " "));
        c.append("div")
         .attr("class", "card-content")
         .html(`<b>${key.replace(/_/g, " ")}</b>`);
        c.append("div")
         .attr("class", "cooc-pill")
         .text((line[key] * 100).toFixed(1) + " %");
    });

    /* ouverture de la modale + blocage du scroll global */
    d3.select("#corr-modal").style("display", "block");
    document.body.style.overflow            = "hidden";
    document.documentElement.style.overflow = "hidden";   // ← on bloque aussi <html>
}

/* ---------------- CORRÉLATIONS : fermeture ---------------- */
const corrModal = d3.select("#corr-modal");
function closeCorrModal(){
    corrModal.style("display","none");
    document.body.style.overflow            = "auto";
    document.documentElement.style.overflow = "auto";     // ✅ FIX : on débloque <html> aussi
}
d3.select("#corr-modal-close").on("click", closeCorrModal);
corrModal.on("click", (event)=>{
    if (event.target === corrModal.node()){
        closeCorrModal();
    }
});
