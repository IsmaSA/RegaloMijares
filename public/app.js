
const $ = (sel) => document.querySelector(sel);

const grid = $("#grid");
const totalVotesEl = $("#totalVotes");
const myVoteEl = $("#myVote");
const legendEl = $("#legend");
const sortSelect = $("#sortSelect");

const shareBtn = $("#shareBtn");
const themeBtn = $("#themeBtn");
const changeVoteBtn = $("#changeVoteBtn");
const clearLocalBtn = $("#clearLocalBtn");

const modal = $("#modal");
const modalImg = $("#modalImg");
const modalTitle = $("#modalTitle");
const modalSub = $("#modalSub");
const modalClose = $("#modalClose");

const liveDot = $("#liveDot");
const liveText = $("#liveText");

const toasts = $("#toasts");
const confettiCanvas = $("#confetti");
const ctxConfetti = confettiCanvas.getContext("2d");

const LS = {
  voterToken: "pv_voter_token",
  myVote: "pv_my_vote",
  theme: "pv_theme"
};

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getVoterToken() {
  let t = localStorage.getItem(LS.voterToken);
  if (!t) {
    t = uuid() + "-" + Date.now().toString(36);
    localStorage.setItem(LS.voterToken, t);
  }
  return t;
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(LS.theme, theme);
}
function initTheme() {
  const saved = localStorage.getItem(LS.theme);
  if (saved) return setTheme(saved);
  const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)")?.matches;
  setTheme(prefersLight ? "light" : "dark");
}

function toast(title, sub = "", kind = "info") {
  const el = document.createElement("div");
  el.className = "toast";
  const color = kind === "ok" ? "var(--good)" : kind === "bad" ? "var(--bad)" : "var(--accent2)";
  el.innerHTML = `
    <div style="width:10px;height:10px;border-radius:4px;margin-top:4px;background:${color}"></div>
    <div>
      <div class="t-title">${escapeHtml(title)}</div>
      <div class="t-sub">${escapeHtml(sub)}</div>
    </div>
  `;
  toasts.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    el.style.transition = "all .18s ease";
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#039;"
  }[c]));
}

async function apiGet(url) {
  const r = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error("GET failed");
  return r.json();
}

async function apiPost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "POST failed");
  return data;
}

let state = {
  photos: [],
  results: { totalVotes: 0, photos: [], updatedAt: 0 },
  myVoteId: localStorage.getItem(LS.myVote) || null
};

let chart = null;

function sortedPhotos(list) {
  const v = sortSelect.value;
  const copy = [...list];
  if (v === "votesDesc") copy.sort((a,b) => (b.votes - a.votes) || a.title.localeCompare(b.title));
  if (v === "votesAsc") copy.sort((a,b) => (a.votes - b.votes) || a.title.localeCompare(b.title));
  if (v === "titleAsc") copy.sort((a,b) => a.title.localeCompare(b.title));
  if (v === "titleDesc") copy.sort((a,b) => b.title.localeCompare(a.title));
  return copy;
}

function pct(v, total) {
  if (!total) return 0;
  return Math.round((v / total) * 100);
}

function render() {
  const resultsMap = new Map(state.results.photos.map(p => [p.id, p]));
  const merged = state.photos.map(p => {
    const r = resultsMap.get(p.id);
    return { ...p, votes: r?.votes ?? 0 };
  });

  const total = state.results.totalVotes ?? 0;
  totalVotesEl.textContent = String(total);

  const my = merged.find(p => p.id === state.myVoteId);
  myVoteEl.textContent = my ? my.title : "—";

  const list = sortedPhotos(merged);
  grid.innerHTML = "";
  for (const p of list) {
    const isMine = p.id === state.myVoteId;
    const percent = pct(p.votes, total);
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="thumb" role="button" tabindex="0" aria-label="Abrir ${escapeHtml(p.title)}">
        <img src="${escapeHtml(p.src)}" alt="${escapeHtml(p.alt || p.title)}" loading="lazy"/>
        <div class="badges">
          <div class="badge"><strong>${p.votes}</strong> votos</div>
          <div class="badge">${percent}%</div>
          ${isMine ? `<div class="badge" style="border-color: rgba(52,211,153,.45)">Tu voto</div>` : ""}
        </div>
      </div>

      <div class="meta">
        <div class="meta-top">
          <div>
            <div class="name">${escapeHtml(p.title)}</div>
            <div class="small">Actualizado: ${new Date(state.results.updatedAt || Date.now()).toLocaleTimeString()}</div>
          </div>
          <button class="icon-btn" type="button" data-preview="${escapeHtml(p.id)}" aria-label="Ver grande">🔍</button>
        </div>

        <div class="progress" aria-hidden="true">
          <div style="width:${percent}%;"></div>
        </div>

        <div class="btnrow">
          <button class="btn" type="button" data-vote="${escapeHtml(p.id)}">
            ${isMine ? "Votada ✅ (tocar para cambiar)" : "Votar por esta"}
          </button>
          <button class="btn ghost" type="button" data-preview="${escapeHtml(p.id)}">Ver</button>
        </div>
      </div>
    `;

    const thumb = card.querySelector(".thumb");
    thumb.addEventListener("click", () => openModal(p));
    thumb.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") openModal(p);
    });

    card.querySelectorAll("[data-preview]").forEach(btn => btn.addEventListener("click", () => openModal(p)));

    const voteBtn = card.querySelector("[data-vote]");
    voteBtn.addEventListener("click", async () => {
      await voteFor(p.id, p.title);
    });

    grid.appendChild(card);
  }

  renderLegend(merged, total);
  renderChart(merged);
}

function renderLegend(merged, total) {
  const top = [...merged].sort((a,b) => (b.votes - a.votes) || a.title.localeCompare(b.title));
  legendEl.innerHTML = "";
  for (const p of top) {
    const row = document.createElement("div");
    row.className = "legend-item";
    row.innerHTML = `
      <div class="legend-left">
        <div class="swatch"></div>
        <div>
          <div style="font-weight:900">${escapeHtml(p.title)}</div>
          <div class="small">${pct(p.votes, total)}% • ${p.votes} votos</div>
        </div>
      </div>
      <div class="kpi">${pct(p.votes, total)}%</div>
    `;
    legendEl.appendChild(row);
  }
}

function renderChart(merged) {
  const canvas = $("#votesChart");
  const labels = merged.map(p => p.title);
  const data = merged.map(p => p.votes);

  const theme = document.documentElement.dataset.theme || "dark";
  const gridColor = theme === "light" ? "rgba(11,16,32,.12)" : "rgba(234,240,255,.12)";
  const tickColor = theme === "light" ? "rgba(11,16,32,.70)" : "rgba(234,240,255,.75)";

  const cfg = {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Votos",
        data,
        backgroundColor: (ctx) => {
          const chart = ctx.chart;
          const { ctx: c, chartArea } = chart;
          if (!chartArea) return "rgba(124,92,255,.75)";
          const g = c.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
          g.addColorStop(0, "rgba(124,92,255,.85)");
          g.addColorStop(1, "rgba(34,211,238,.70)");
          return g;
        },
        borderRadius: 10
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (item) => ` ${item.raw} votos` }
        }
      },
      scales: {
        x: {
          ticks: { color: tickColor, maxRotation: 0, autoSkip: true },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: { color: tickColor, precision: 0 },
          grid: { color: gridColor }
        }
      }
    }
  };

  if (!chart) {
    chart = new Chart(canvas, cfg);
  } else {
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.update();
  }
}

function openModal(photo) {
  modalImg.src = photo.src;
  modalImg.alt = photo.alt || photo.title;
  modalTitle.textContent = photo.title;

  const total = state.results.totalVotes ?? 0;
  const percent = pct(photo.votes ?? 0, total);
  modalSub.textContent = `${photo.votes ?? 0} votos • ${percent}% del total`;

  modal.hidden = false;
  modalClose.focus();
}

function closeModal() {
  modal.hidden = true;
  modalImg.src = "";
}
modal.addEventListener("click", (e) => {
  const close = e.target?.dataset?.close === "1";
  if (close) closeModal();
});
modalClose.addEventListener("click", closeModal);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) closeModal();
});

async function voteFor(photoId, title) {
  const voterToken = getVoterToken();

  try {
    toast("Registrando voto…", `Por "${title}"`);
    await apiPost("/api/vote", { photoId, voterToken });
    state.myVoteId = photoId;
    localStorage.setItem(LS.myVote, photoId);
    confettiBurst();
    toast("Votado", `Has votado por "${title}"`, "ok");
    render();
  } catch (e) {
    toast("No se pudo votar", String(e?.message || e), "bad");
  }
}

function connectStream() {
  liveText.textContent = "Conectando…";
  liveDot.classList.remove("live");

  const es = new EventSource("/api/stream");
  es.addEventListener("open", () => {
    liveText.textContent = "En directo";
    liveDot.classList.add("live");
  });

  es.addEventListener("results", (evt) => {
    try {
      const payload = JSON.parse(evt.data);
      state.results = payload;
      render();
    } catch {
    }
  });

  es.addEventListener("error", () => {
    liveText.textContent = "Reconectando…";
    liveDot.classList.remove("live");
  });
}

function resizeConfetti() {
  confettiCanvas.width = window.innerWidth * devicePixelRatio;
  confettiCanvas.height = window.innerHeight * devicePixelRatio;
}
window.addEventListener("resize", resizeConfetti);

let confetti = [];
function confettiBurst() {
  resizeConfetti();
  const n = 160;
  const cx = (window.innerWidth * 0.55) * devicePixelRatio;
  const cy = (window.innerHeight * 0.25) * devicePixelRatio;
  const colors = ["#7C5CFF", "#22D3EE", "#34D399", "#FBBF24", "#FB7185", "#EAF0FF"];
  for (let i=0; i<n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 2 + Math.random() * 8;
    confetti.push({
      x: cx,
      y: cy,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - (2 + Math.random()*3),
      g: 0.18 + Math.random() * 0.22,
      r: 2 + Math.random() * 4,
      life: 80 + Math.random() * 40,
      color: colors[(Math.random()*colors.length)|0]
    });
  }
  if (!confetti._anim) animateConfetti();
}

function animateConfetti() {
  confetti._anim = true;
  const w = confettiCanvas.width;
  const h = confettiCanvas.height;

  ctxConfetti.clearRect(0,0,w,h);

  confetti = confetti.filter(p => p.life > 0);
  for (const p of confetti) {
    p.life -= 1;
    p.vy += p.g;
    p.x += p.vx;
    p.y += p.vy;

    ctxConfetti.beginPath();
    ctxConfetti.fillStyle = p.color;
    ctxConfetti.arc(p.x, p.y, p.r, 0, Math.PI*2);
    ctxConfetti.fill();
  }

  if (confetti.length) {
    requestAnimationFrame(animateConfetti);
  } else {
    ctxConfetti.clearRect(0,0,w,h);
    confetti._anim = false;
  }
}

shareBtn.addEventListener("click", async () => {
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    toast("Enlace copiado", "Pégalo en el grupo para que voten.", "ok");
  } catch {
    toast("Copia manual", url);
  }
});

themeBtn.addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme || "dark";
  setTheme(cur === "dark" ? "light" : "dark");
  renderChart(state.photos.map(p => ({...p, votes: (state.results.photos.find(r => r.id===p.id)?.votes ?? 0)})));
  toast("Tema cambiado", `Ahora: ${document.documentElement.dataset.theme}`);
});

changeVoteBtn.addEventListener("click", () => {
  toast("Elige otra foto", "Toca “Votar por esta” en la foto que quieras.", "info");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

clearLocalBtn.addEventListener("click", () => {
  localStorage.removeItem(LS.myVote);
  localStorage.removeItem(LS.voterToken);
  state.myVoteId = null;
  toast("Reiniciado", "Este dispositivo puede votar de nuevo.", "ok");
  render();
});

sortSelect.addEventListener("change", render);

(async function init() {
  initTheme();
  resizeConfetti();
  try {
    const { photos } = await apiGet("/api/photos");
    state.photos = photos;
  } catch {
    toast("Error", "No se pudieron cargar las fotos.", "bad");
  }

  try {
    state.results = await apiGet("/api/results");
  } catch {
  }

  render();
  connectStream();
})();
