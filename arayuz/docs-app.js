/* Karun dokumantasyon gezgini: menu, icerik, bu sayfada, arama. */
"use strict";

const SAYFALAR = window.KARUN_DOCS;
const $ = (s) => document.querySelector(s);

let aktifSlug = null;

function slugAl() {
  const h = location.hash.replace(/^#/, "");
  const s = h.split("?")[0];
  return SAYFALAR.some((p) => p.slug === s) ? s : SAYFALAR[0].slug;
}

function menuCiz() {
  $("#menu").innerHTML = SAYFALAR.map(
    (p) => `<a href="#${p.slug}" data-slug="${p.slug}">${p.menu}</a>`
  ).join("");
}

function icindekilerCiz(sayfa) {
  const kap = $("#icindekiler");
  kap.innerHTML = sayfa.basliklar.map((b) => `<a href="#${sayfa.slug}" data-id="${b.id}">${b.ad}</a>`).join("");
  kap.querySelectorAll("a").forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      const hedef = document.getElementById(a.dataset.id);
      if (hedef) hedef.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  });
}

function gecisCiz(indeks) {
  const onceki = SAYFALAR[indeks - 1];
  const sonraki = SAYFALAR[indeks + 1];
  $("#gecis").innerHTML =
    (onceki ? `<a class="gecis" href="#${onceki.slug}"><div class="yon">← Previous</div><div class="ad">${onceki.menu}</div></a>` : "<div style='flex:1'></div>") +
    (sonraki ? `<a class="gecis ileri" href="#${sonraki.slug}"><div class="yon">Next →</div><div class="ad">${sonraki.menu}</div></a>` : "<div style='flex:1'></div>");
}

function sayfaGoster(slug, kaydir = true) {
  const indeks = SAYFALAR.findIndex((p) => p.slug === slug);
  const sayfa = SAYFALAR[indeks];
  if (!sayfa) return;
  aktifSlug = slug;

  $("#baslik").textContent = sayfa.baslik;
  $("#alt-baslik").textContent = sayfa.altBaslik || "";
  $("#alt-baslik").style.display = sayfa.altBaslik ? "" : "none";
  $("#icerik").innerHTML = sayfa.html;
  document.title = sayfa.baslik + " · Karun Docs";

  document.querySelectorAll("#menu a").forEach((a) => a.classList.toggle("secili", a.dataset.slug === slug));
  icindekilerCiz(sayfa);
  gecisCiz(indeks);

  if (window.mermaid) {
    try { window.mermaid.run({ querySelector: "pre.mermaid" }); } catch (_) {}
  }
  if (kaydir) window.scrollTo({ top: 0, behavior: "instant" });
  gozlemciKur();
}

/* okunan bolumu sag menude isaretle */
let gozlemci = null;
function gozlemciKur() {
  if (gozlemci) gozlemci.disconnect();
  const basliklar = [...document.querySelectorAll("#icerik h2")];
  if (!basliklar.length) return;
  gozlemci = new IntersectionObserver(
    (girisler) => {
      const gorunen = girisler.filter((g) => g.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!gorunen) return;
      document.querySelectorAll("#icindekiler a").forEach((a) =>
        a.classList.toggle("aktif", a.dataset.id === gorunen.target.id)
      );
    },
    { rootMargin: "-70px 0px -70% 0px", threshold: 0 }
  );
  basliklar.forEach((b) => gozlemci.observe(b));
}

/* arama: baslik ve govde metninde */
function aramaKur() {
  const girdi = $("#ara");
  const menu = $("#menu");
  girdi.addEventListener("input", () => {
    const q = girdi.value.trim().toLowerCase();
    if (!q) {
      menuCiz();
      document.querySelectorAll("#menu a").forEach((a) => a.classList.toggle("secili", a.dataset.slug === aktifSlug));
      return;
    }
    const dumdum = (h) => h.replace(/<[^>]+>/g, " ").toLowerCase();
    const sonuc = SAYFALAR.map((p) => {
      const govde = dumdum(p.html);
      const yer = govde.indexOf(q);
      const basliktaMi = p.menu.toLowerCase().includes(q) || p.baslik.toLowerCase().includes(q);
      if (yer === -1 && !basliktaMi) return null;
      const kesit = yer === -1 ? (p.altBaslik || "").slice(0, 90)
        : "…" + govde.slice(Math.max(0, yer - 35), yer + 55).replace(/\s+/g, " ").trim() + "…";
      return { p, kesit };
    }).filter(Boolean);

    menu.innerHTML = sonuc.length
      ? sonuc.map((s) => `<a href="#${s.p.slug}" data-slug="${s.p.slug}">${s.p.menu}
          <div style="font-size:12px;color:var(--ucuncul);margin-top:2px;font-weight:400">${s.kesit}</div></a>`).join("")
      : `<div style="padding:10px 12px;font-size:13px;color:var(--ucuncul)">No results</div>`;
  });
  girdi.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { girdi.value = ""; girdi.dispatchEvent(new Event("input")); girdi.blur(); }
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); girdi.focus(); }
  });
}

/* baslangic */
if (window.mermaid) {
  window.mermaid.initialize({ startOnLoad: false, theme: "neutral",
    themeVariables: { fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif", fontSize: "13px" } });
}
menuCiz();
aramaKur();
sayfaGoster(slugAl(), false);
window.addEventListener("hashchange", () => sayfaGoster(slugAl()));
