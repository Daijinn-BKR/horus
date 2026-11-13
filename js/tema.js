// Tema claro/oscuro: se aplica antes de pintar para evitar parpadeo (archivo aparte: la CSP no permite scripts en línea)
try { const t = localStorage.getItem("horus.tema"); if (t === "claro" || t === "oscuro") document.documentElement.dataset.theme = t === "claro" ? "light" : "dark"; } catch (e) {}
