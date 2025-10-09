// SkiClothing v5.2
const PHONE_NL = "31628683759";
const ADMIN_PIN = "SKI123"; // wijzig naar eigen PIN

const state = { products: [], cart: [], selectedSizeByProduct: {} };

/* === Shopify Storefront API config (Option B) === */
const SHOPIFY = {
  domain: "JOUW-STORE.myshopify.com",         // <-- VERVANG met jouw domein
  token:  "STOREFRONT_ACCESS_TOKEN_HIER",     // <-- VERVANG met je Storefront access token
  api:    "2024-07"
};

function shopifyEnabled(){
  return SHOPIFY.domain.includes(".myshopify.com") && SHOPIFY.token && SHOPIFY.token !== "STOREFRONT_ACCESS_TOKEN_HIER";
}

async function sf(query, variables={}){
  const r = await fetch(`https://${SHOPIFY.domain}/api/${SHOPIFY.api}/graphql.json`, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "X-Shopify-Storefront-Access-Token": SHOPIFY.token
    },
    body: JSON.stringify({query, variables})
  });
  const j = await r.json();
  if(j.errors){ console.error(j.errors); }
  return j.data;
}

// Map pagina -> collectie-handle
function collectionHandle(){
  const cat = getCategoryFilter();
  if(cat === "shoes") return "schoenen";
  if(cat === "jackets") return "jassen";
  if(cat === "tracksuits") return "trainingspakken";
  return null;
}

// Haal producten uit Shopify-collectie
async function loadProductsFromShopify(handle){
  const q = `
  query($h:String!){
    collectionByHandle(handle:$h){
      products(first:100){
        nodes{
          id title handle
          featuredImage{url altText}
          variants(first:50){
            nodes{
              id title availableForSale
              price{ amount currencyCode }
            }
          }
        }
      }
    }
  }`;
  const d = await sf(q, {h: handle});
  const nodes = d && d.collectionByHandle && d.collectionByHandle.products ? d.collectionByHandle.products.nodes : [];
  return nodes.map(p=>{
    const vmap = {};
    (p.variants.nodes||[]).forEach(v=>{
      // variant title kan "41" of "EU 41" of "41 / Black" etc zijn
      let key = (v.title||"").split("/")[0].trim().replace("EU","").trim();
      vmap[key] = v.id;
    });
    const sizes = {};
    Object.keys(vmap).forEach(k=> sizes[k] = true);
    return {
      id: p.id,
      name: p.title,
      price: Number(p.variants.nodes?.[0]?.price?.amount || 0),
      images: [p.featuredImage?.url],
      sizes,
      _variantBySize: vmap,           // voor checkout
      variants: p.variants.nodes,     // raw
      category: getCategoryFilter()
    };
  });
}

// Maak een Shopify-cart en ga naar checkout
async function checkoutShopifyFromCart(){
  if(!shopifyEnabled()){ alert("Shopify is nog niet geconfigureerd. Vul je domein + token in app.js."); return; }
  if(state.cart.length===0){ alert("Je mandje is leeg."); return; }

  const lines = [];
  for(const it of state.cart){
    const p = state.products.find(x=>x.id === it.id);
    // fallback: ook op naam proberen (mocht id verschillen)
    const pp = p || state.products.find(x=> x.name===it.name);
    const vmap = pp && pp._variantBySize ? pp._variantBySize : null;
    const vid = vmap ? (vmap[it.size] || vmap[it.size?.toUpperCase()] || vmap[it.size?.toString()]) : null;
    if(!vid){ alert(`Kan Shopify-variant niet vinden voor ${it.name} maat ${it.size}. Check variantenamen in Shopify.`); return; }
    lines.push({quantity: it.qty, merchandiseId: vid});
  }

  const q = `mutation($lines:[CartLineInput!]!){
    cartCreate(input:{lines:$lines}){
      cart{ checkoutUrl }
      userErrors{ field message }
    }
  }`;
  const d = await sf(q, {lines});
  const url = d && d.cartCreate && d.cartCreate.cart && d.cartCreate.cart.checkoutUrl;
  if(url){ window.location.href = url; }
  else { alert("Kon geen Shopify checkout openen. Check API token/scopes."); }
}

const $ = (s,p=document)=>p.querySelector(s);
const $$ = (s,p=document)=>Array.from(p.querySelectorAll(s));

function persistCart(){ try{ localStorage.setItem("skiclothing.cart", JSON.stringify(state.cart)); }catch(e){} }
function restoreCart(){ try{ const r = localStorage.getItem("skiclothing.cart"); state.cart = r? JSON.parse(r): []; }catch(e){} }

async function loadProducts(){
  const handle = collectionHandle();
  if(handle && shopifyEnabled()){
    try{
      state.products = await loadProductsFromShopify(handle);
      return;
    }catch(e){ console.warn("Shopify load failed, fallback to local.", e); }
  }
  // Fallback: lokale JSON
  try{ const res = await fetch("data/products.json"); if(!res.ok) throw new Error(); state.products = await res.json(); }
  catch(e){ state.products = []; }
  const inv = JSON.parse(localStorage.getItem("skiclothing.inventory")||"null");
  if(inv){ state.products = state.products.map(p=> (inv[p.id]? {...p, sizes:inv[p.id]}:p)); }
  const shop = JSON.parse(localStorage.getItem("skiclothing.shopify")||"{}");
  state.products = state.products.map(p=> (shop[p.id]? {...p, shopify_url:shop[p.id]}:p));
}

function getCategoryFilter(){ return document.body.getAttribute("data-category") || "all"; }

function renderProducts(){
  const grid = $("#productGrid"); if(!grid) return;
  const cat = getCategoryFilter();
  const qEl = $("#q"), sortEl = $("#sort");
  const q = qEl? qEl.value.trim().toLowerCase(): "";
  const order = sortEl? sortEl.value : "rel";
  grid.innerHTML = "";

  let list = state.products.filter(p=> (cat==="all" || p.category===cat));
  if(q) list = list.filter(p=> p.name.toLowerCase().includes(q));
  if(order==="asc") list.sort((a,b)=>a.price-b.price);
  if(order==="desc") list.sort((a,b)=>b.price-a.price);

  list.forEach(p=>{
    const card = document.createElement("article"); card.className="card reveal";
    card.innerHTML = `
      <div class="img-wrap"><img src="${p.images[0]}" alt="${p.name}"/></div>
      <div class="title"><h3>${p.name}</h3><span class="price">€${p.price.toFixed(0)}</span></div>
      <div class="sizes" data-product="${p.id}">
        ${Object.entries(p.sizes).map(([s,ok])=>`<button class="size ${ok?'':'disabled'}" data-size="${s}">${s}</button>`).join("")}
      </div>
      <div class="actions">
        ${p.shopify_url? `<a class="ghost" href="${p.shopify_url}" target="_blank" rel="noopener">Shopify</a>`:""}
        <button class="primary add" data-id="${p.id}">Toevoegen</button>
      </div>`;
    grid.appendChild(card);
  });

  $$(".sizes").forEach(g=> g.addEventListener("click", e=>{
    const b = e.target.closest(".size"); if(!b || b.classList.contains("disabled")) return;
    $$(".size", g).forEach(x=>x.classList.remove("selected")); b.classList.add("selected");
    state.selectedSizeByProduct[g.dataset.product] = b.dataset.size;
  }));

  $$(".add").forEach(b=> b.addEventListener("click", ()=>{
    const id = b.dataset.id; const size = state.selectedSizeByProduct[id];
    if(!size) return alert("Kies eerst een maat.");
    const p = state.products.find(x=>x.id===id);
    const ex = state.cart.find(x=>x.id===id && x.size===size);
    if(ex) ex.qty += 1; else state.cart.push({id, size, qty:1, name:p.name, price:p.price, image:p.images[0]});
    updateCartUI(); b.textContent="Toegevoegd ✓"; setTimeout(()=>b.textContent="Toevoegen", 900);
  }));

  setupReveals();
}

function updateCartUI(){
  const cc = $("#cartCount"); if(cc) cc.textContent = state.cart.reduce((a,b)=>a+b.qty,0);
  const list = $("#cartItems"); if(list){
    list.innerHTML = state.cart.length? state.cart.map((it,i)=>`
      <div class="cart-row reveal">
        <img src="${it.image}" alt=""/>
        <div class="meta"><div style="display:flex;justify-content:space-between;gap:8px"><strong>${it.name}</strong><span>€${(it.price*it.qty).toFixed(0)}</span></div><div><span class="badge">Maat ${it.size}</span></div></div>
        <div class="qty"><button class="btn" data-act="minus" data-i="${i}">−</button><span>${it.qty}</span><button class="btn" data-act="plus" data-i="${i}">+</button><button class="btn" data-act="del" data-i="${i}">🗑️</button></div>
      </div>`).join("") : `<p class="muted">Je mandje is leeg.</p>`;
    $$("#cartItems .btn").forEach(b=> b.addEventListener("click", ()=>{
      const i = +b.dataset.i, a=b.dataset.act;
      if(a==="plus") state.cart[i].qty++;
      if(a==="minus") state.cart[i].qty=Math.max(1,state.cart[i].qty-1);
      if(a==="del") state.cart.splice(i,1);
      updateCartUI();
    }));
  }
  persistCart();
}

function openCart(open=true){ const d=$("#cartDrawer"); if(d) d.setAttribute("aria-hidden",(!open).toString()); }
function setupCart(){ const o=$("#openCart"), c=$("#closeCart"); if(o) o.addEventListener("click",()=>openCart(true)); if(c) c.addEventListener("click",()=>openCart(false)); updateCartUI(); }

function setupCheckout(){
  const form=$("#checkoutForm"); if(!form) return;
  const shopBtn = $("#checkoutShopify"); if(shopBtn) shopBtn.addEventListener('click', checkoutShopifyFromCart);
  form.addEventListener("submit", e=>{
    e.preventDefault(); if(state.cart.length===0) return alert("Je mandje is leeg.");
    const data = Object.fromEntries(new FormData(form).entries());
    const itemsTxt = state.cart.map(it=>`• ${it.name} — maat ${it.size} × ${it.qty}`).join("%0A");
    const total = state.cart.reduce((s,it)=>s+it.price*it.qty,0);
    const msg = `Nieuwe bestelling van SkiClothing%0A%0AItems:%0A${itemsTxt}%0A%0ATotaal: €${total.toFixed(0)}%0A%0AKlant:%0ANaam: ${encodeURIComponent(data.name)}%0AAdres: ${encodeURIComponent(data.address)}%0APostcode: ${encodeURIComponent(data.postcode)}%0ATelefoon: ${encodeURIComponent(data.phone)}%0AE-mail: ${encodeURIComponent(data.email)}%0AOpmerkingen: ${encodeURIComponent(data.notes||"-")}%0A%0ABron: Website`;
    window.open(`https://wa.me/${PHONE_NL}?text=${msg}`, "_blank");
  });
}

/* Admin (PIN protected; open with #admin or Ctrl/Cmd + Alt + B) */
function openAdmin(open=true){ const el=$("#adminPanel"); if(el) el.classList.toggle("hidden", !open); }
function renderAdmin(){
  // no-op in v5.2 (panel hidden to public); keep your previous admin build if needed
}
function setupAdminGate(){
  if(window.location.hash==="#admin"){
    const pin = prompt("Voer je admin-PIN in:");
    if(pin === ADMIN_PIN){ alert("Beheer geopend (basis)."); } else { alert("Onjuiste PIN."); }
  }
  window.addEventListener('keydown', (e)=>{
    if((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase()==='b'){
      const pin = prompt("Admin-PIN:");
      if(pin === ADMIN_PIN){ alert("Beheer geopend (basis)."); }
    }
  });
}

/* Menu */
function openMenu(open=true){ const d=$("#menuDrawer"); if(d) d.setAttribute("aria-hidden",(!open).toString()); }
function setupMenu(){ const o=$("#openMenu"), c=$("#closeMenu"); if(o) o.addEventListener("click", ()=>openMenu(true)); if(c) c.addEventListener("click", ()=>openMenu(false)); }

/* Reveal */
function setupReveals(){
  const obs = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('in'); obs.unobserve(e.target); } });
  }, {threshold: 0.1});
  document.querySelectorAll('.reveal').forEach(el=>obs.observe(el));
}

/* Init */
(async function init(){
  const y=$("#year"); if(y) y.textContent = new Date().getFullYear();
  restoreCart();
  await loadProducts();
  renderProducts();
  setupCart(); setupCheckout(); setupAdminGate(); setupMenu();
})();