/* =============================================
   SICREDI FATURAS — dashboard.js
   Painel com KPIs, insights e gráficos interativos (Chart.js).
   Filtro cruzado no estilo Power BI: tocar em um mês ou categoria
   filtra todo o painel; tocar de novo (ou no "×" do filtro) limpa.
   ============================================= */

// ---------- ESTADO ----------

const CHARTJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';

let dash = { periodo: '6', mes: null, cat: null };
const dashCharts = {};

// ---------- CARREGAMENTO DO CHART.JS ----------

let _chartLoading = null;
function loadChartJs() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (!_chartLoading) {
    _chartLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CHARTJS_URL;
      s.onload  = () => resolve(window.Chart);
      s.onerror = () => { _chartLoading = null; reject(new Error('sem conexão')); };
      document.head.appendChild(s);
    });
  }
  return _chartLoading;
}

// ---------- DADOS ----------

const MES_CURTO = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

function mesCurto(mesAno) {
  const [y, m] = mesAno.split('-');
  return `${MES_CURTO[parseInt(m) - 1]}/${y.slice(2)}`;
}

function brToMes(br) {
  const [, m, y] = (br || '').split('/');
  return y && m ? `${y}-${m}` : null;
}

function mesAtual() { return todayISO().slice(0, 7); }

// Lista única de lançamentos. O cartão entra pelo valor oficial de cada fatura,
// no mês do vencimento (quando o dinheiro sai da conta).
function dashMovimentos() {
  const out = [];
  entradas.forEach(e => out.push({
    mes: e.data.slice(0, 7), lado: 'ent', cat: e.tipo, catLabel: TIPO_LABELS[e.tipo] || e.tipo, valor: e.valor,
  }));
  saidas.forEach(s => out.push({
    mes: s.data.slice(0, 7), lado: 'sai', cat: s.tipo, catLabel: SAIDA_LABELS[s.tipo] || s.tipo, valor: s.valor,
  }));
  faturas.forEach(f => {
    const mes = brToMes(f.venc);
    if (!mes) return;
    const valor = f.total || allTx.filter(t => t.faturaId === f.id).reduce((s, t) => s + t.valor, 0);
    out.push({ mes, lado: 'sai', cat: 'cartao', catLabel: 'Cartão de crédito', valor });
  });
  return out;
}

// Meses do período escolhido, do mais antigo ao mais recente.
function dashMeses(movs) {
  const comDados = [...movs.map(m => m.mes), ...investimentos.map(i => i.data.slice(0, 7))].sort();
  if (!comDados.length) return [];
  const fim    = [mesAtual(), comDados[comDados.length - 1]].sort().pop();
  let inicio;
  if (dash.periodo === 'tudo')     inicio = comDados[0];
  else if (dash.periodo === 'ano') inicio = fim.slice(0, 4) + '-01';
  else                             inicio = shiftMes(fim, -(parseInt(dash.periodo) - 1));
  const meses = [];
  for (let m = inicio; m <= fim; m = shiftMes(m, 1)) meses.push(m);
  return meses;
}

function soma(lista) { return lista.reduce((s, x) => s + x.valor, 0); }

// ---------- INVESTIMENTOS ----------
// Aportes não contam como gasto: aparecem à parte, como destino do que sobrou.

function invDoMes(mes) {
  return investimentos.filter(i => i.data.slice(0, 7) === mes);
}

function invPatrimonioAte(mes) {
  return invSaldo(investimentos.filter(i => i.data.slice(0, 7) <= mes));
}

function invResumo(meses) {
  const lista = investimentos.filter(i => meses.includes(i.data.slice(0, 7)));
  return {
    aportes:     invSoma(lista, 'aporte'),
    resgates:    invSoma(lista, 'resgate'),
    rendimentos: invSoma(lista, 'rendimento'),
    patrimonio:  invPatrimonioAte(meses[meses.length - 1]),
  };
}

// Aplica o filtro de categoria às saídas (entradas não têm categoria de saída).
function filtraCat(movs) {
  return dash.cat ? movs.filter(m => m.lado === 'ent' || m.cat === dash.cat) : movs;
}

function porMes(movs, meses) {
  return meses.map(mes => {
    const doMes  = movs.filter(m => m.mes === mes);
    const ent    = soma(doMes.filter(m => m.lado === 'ent'));
    const cartao = soma(doMes.filter(m => m.lado === 'sai' && m.cat === 'cartao'));
    const outras = soma(doMes.filter(m => m.lado === 'sai' && m.cat !== 'cartao'));
    return { mes, ent, cartao, outras, sai: cartao + outras, res: ent - cartao - outras };
  });
}

function agrupa(movs, lado) {
  const map = {};
  movs.filter(m => m.lado === lado).forEach(m => {
    if (!map[m.cat]) map[m.cat] = { cat: m.cat, label: m.catLabel, valor: 0 };
    map[m.cat].valor += m.valor;
  });
  return Object.values(map).filter(x => x.valor > 0).sort((a, b) => b.valor - a.valor);
}

// Compras no cartão (débitos) das faturas que vencem nos meses informados.
function comprasCartao(meses) {
  const set = new Set(meses);
  const faturaMes = {};
  faturas.forEach(f => { faturaMes[f.id] = brToMes(f.venc); });
  return allTx.filter(t => t.tipo === 'debito' && set.has(faturaMes[t.faturaId]));
}

function topEstabelecimentos(meses, n) {
  const map = {};
  comprasCartao(meses).forEach(t => {
    const k = t.desc.trim().toLowerCase();
    if (!map[k]) map[k] = { label: t.desc.trim(), valor: 0, qtd: 0 };
    map[k].valor += t.valor;
    map[k].qtd++;
  });
  return Object.values(map).sort((a, b) => b.valor - a.valor).slice(0, n);
}

// Parcelas ainda a pagar, a partir da fatura mais recente importada.
function parcelasFuturas() {
  const ultima = faturas
    .map(f => ({ f, mes: brToMes(f.venc) }))
    .filter(x => x.mes)
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .pop();
  const map = {};
  if (!ultima) return map;
  allTx.filter(t => t.faturaId === ultima.f.id && t.parcela && t.parcela.atual < t.parcela.total)
    .forEach(t => {
      for (let k = 1; k <= t.parcela.total - t.parcela.atual; k++) {
        const mes = shiftMes(ultima.mes, k);
        map[mes] = (map[mes] || 0) + t.valor;
      }
    });
  return map;
}

function entradasPrevistas() {
  const map = {};
  const hoje = mesAtual();
  entradasFuturas.forEach(e => { map[e.mesAno] = (map[e.mesAno] || 0) + e.valor; });
  entradas.filter(e => e.data.slice(0, 7) > hoje)
    .forEach(e => { const m = e.data.slice(0, 7); map[m] = (map[m] || 0) + e.valor; });
  return map;
}

// ---------- FORMATAÇÃO ----------

const fmtCompacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
function fmtEixo(v) { return 'R$ ' + fmtCompacto.format(v); }
function fmtPct(v)  { return (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '%'; }

function cssVar(nome) {
  return getComputedStyle(document.body).getPropertyValue(nome).trim();
}

function comAlpha(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function escopoLabel(meses) {
  if (dash.mes) return mesAnoLabel(dash.mes);
  return meses.length === 1 ? mesAnoLabel(meses[0]) : `${mesCurto(meses[0])} a ${mesCurto(meses[meses.length - 1])}`;
}

// ---------- FILTROS ----------

function dashSetPeriodo(v) {
  dash.periodo = v;
  dash.mes = null;
  renderDashboard();
}

function dashToggleMes(mes) {
  dash.mes = dash.mes === mes ? null : mes;
  renderDashboard();
}

function dashToggleCat(cat) {
  dash.cat = dash.cat === cat ? null : cat;
  renderDashboard();
}

function renderChips() {
  const el = document.getElementById('dash-chips');
  el.textContent = '';
  const chip = (rotulo, valor, limpar) => {
    const b = document.createElement('button');
    b.className = 'dash-chip';
    b.title = 'Remover filtro';
    b.append(rotulo + ': ');
    const strong = document.createElement('b');
    strong.textContent = valor;
    const x = document.createElement('span');
    x.className = 'x';
    x.textContent = '✕';
    b.append(strong, x);
    b.onclick = limpar;
    el.append(b);
  };
  if (dash.mes) chip('Mês', mesAnoLabel(dash.mes), () => dashToggleMes(dash.mes));
  if (dash.cat) {
    const label = dash.cat === 'cartao' ? 'Cartão de crédito' : (SAIDA_LABELS[dash.cat] || dash.cat);
    chip('Categoria', label, () => dashToggleCat(dash.cat));
  }
}

// ---------- RENDER ----------

function renderDashboard() {
  const tab = document.getElementById('tab-dashboard');
  if (!tab || !tab.classList.contains('active')) return;

  const movs  = dashMovimentos();
  const vazio = !movs.length && !investimentos.length;
  document.getElementById('dash-empty').style.display = vazio ? '' : 'none';
  document.getElementById('dash-body').style.display  = vazio ? 'none' : '';
  if (vazio) return;

  const meses = dashMeses(movs);
  if (dash.mes && !meses.includes(dash.mes)) dash.mes = null;

  const mesesEscopo = dash.mes ? [dash.mes] : meses;
  const movsCat     = filtraCat(movs);
  const linhas      = porMes(movsCat, meses);
  const escopo      = movsCat.filter(m => mesesEscopo.includes(m.mes));

  renderChips();
  renderKpis(movsCat, meses, mesesEscopo);
  renderInsights(movs, meses, mesesEscopo, linhas);
  renderTabela(linhas);

  loadChartJs()
    .then(() => {
      renderMensal(linhas);
      renderBarrasH('cat', agrupa(movs.filter(m => mesesEscopo.includes(m.mes)), 'sai'), '--viz-sai', 'Saídas',
        { selecionado: dash.cat, onClick: item => dashToggleCat(item.cat) });
      renderBarrasH('ent', agrupa(escopo, 'ent'), '--viz-ent', 'Entradas', {});
      renderAcumulado(linhas);
      renderTop(mesesEscopo);
      renderCarteira(meses);
      renderPrevisao();
    })
    .catch(() => {
      document.querySelectorAll('#tab-dashboard .dash-chart').forEach(el => {
        el.style.height = '';
        el.innerHTML = '<div class="dash-msg">Sem conexão para carregar os gráficos. Os números acima e a tabela continuam valendo.</div>';
      });
    });
}

// ---------- KPIs ----------

function renderKpis(movs, meses, mesesEscopo) {
  // Período anterior de mesmo tamanho, para comparação.
  const n         = mesesEscopo.length;
  const anteriores = [];
  for (let i = n; i >= 1; i--) anteriores.push(shiftMes(mesesEscopo[0], -i));

  const calc = ms => {
    const doEscopo = movs.filter(m => ms.includes(m.mes));
    const ent    = soma(doEscopo.filter(m => m.lado === 'ent'));
    const sai    = soma(doEscopo.filter(m => m.lado === 'sai'));
    const cartao = soma(doEscopo.filter(m => m.lado === 'sai' && m.cat === 'cartao'));
    // Média só sobre meses com gastos lançados (meses sem fatura importada não puxam a média para baixo).
    const mesesComGasto = new Set(doEscopo.filter(m => m.lado === 'sai').map(m => m.mes)).size || 1;
    return { ent, sai, res: ent - sai, taxa: ent > 0 ? (ent - sai) / ent : null,
             media: sai / mesesComGasto, pesoCartao: sai > 0 ? cartao / sai : null,
             temDados: doEscopo.length > 0 };
  };
  const a = calc(mesesEscopo);
  const b = calc(anteriores);

  // maiorEhBom: se subir é bom (entradas) ou ruim (saídas).
  const delta = (atual, ant, maiorEhBom, emPontos) => {
    if (!b.temDados || ant === null || atual === null) return { txt: 'sem período anterior', cls: '' };
    if (emPontos) {
      const d = (atual - ant) * 100;
      if (Math.abs(d) < 0.5) return { txt: '= igual ao período anterior', cls: '' };
      return { txt: `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(0)} p.p. vs anterior`, cls: (d > 0) === maiorEhBom ? 'bom' : 'ruim' };
    }
    if (!ant) return { txt: 'sem período anterior', cls: '' };
    const d = (atual - ant) / Math.abs(ant);
    if (Math.abs(d) < 0.005) return { txt: '= igual ao período anterior', cls: '' };
    return { txt: `${d > 0 ? '▲' : '▼'} ${fmtPct(Math.abs(d))} vs anterior`, cls: (d > 0) === maiorEhBom ? 'bom' : 'ruim' };
  };

  const kpis = [
    { label: 'Entradas', valor: fmtVal(a.ent), cor: 'green', d: delta(a.ent, b.ent, true) },
    { label: dash.cat ? 'Saídas (categoria)' : 'Saídas', valor: fmtVal(a.sai), cor: 'red', d: delta(a.sai, b.sai, false) },
    { label: a.res >= 0 ? 'Resultado (sobrou)' : 'Resultado (faltou)', valor: fmtVal(a.res), cor: a.res >= 0 ? 'green' : 'red',
      d: delta(a.res, b.res, true) },
    { label: 'Taxa de poupança', valor: a.taxa === null ? '—' : fmtPct(a.taxa), cor: a.taxa !== null && a.taxa < 0 ? 'red' : '',
      d: delta(a.taxa, b.taxa, true, true) },
    { label: n > 1 ? 'Gasto médio mensal' : 'Gasto no mês', valor: fmtVal(a.media), cor: '', d: delta(a.media, b.media, false) },
    { label: 'Peso do cartão nas saídas', valor: a.pesoCartao === null ? '—' : fmtPct(a.pesoCartao), cor: 'blue',
      d: delta(a.pesoCartao, b.pesoCartao, false, true) },
  ];

  // Investimentos: não entram em saídas/resultado. Comparação só se havia carteira antes.
  const invA = invResumo(mesesEscopo);
  const invB = invResumo(anteriores);
  const temInvAntes = investimentos.some(i => i.data.slice(0, 7) <= anteriores[anteriores.length - 1]);
  const deltaInv = (atual, ant) => {
    if (!temInvAntes || !ant) return { txt: 'sem período anterior', cls: '' };
    const d = (atual - ant) / Math.abs(ant);
    if (Math.abs(d) < 0.005) return { txt: '= igual ao período anterior', cls: '' };
    return { txt: `${d > 0 ? '▲' : '▼'} ${fmtPct(Math.abs(d))} vs anterior`, cls: d > 0 ? 'bom' : 'ruim' };
  };
  kpis.push(
    { label: 'Investido no período', valor: fmtVal(invA.aportes), cor: 'purple',
      d: invA.resgates ? { txt: `${fmtVal(invA.resgates)} resgatados`, cls: '' } : deltaInv(invA.aportes, invB.aportes) },
    { label: 'Patrimônio investido', valor: fmtVal(invA.patrimonio), cor: 'purple',
      d: invA.rendimentos ? { txt: `+ ${fmtVal(invA.rendimentos)} de rendimentos`, cls: 'bom' } : deltaInv(invA.patrimonio, invB.patrimonio) },
  );

  document.getElementById('dash-kpis').innerHTML = kpis.map(k => `
    <div class="metric">
      <div class="metric-label">${k.label}</div>
      <div class="metric-value ${k.cor}">${k.valor}</div>
      <div class="dash-kpi-delta ${k.d.cls}">${k.d.txt}</div>
    </div>`).join('');
}

// ---------- INSIGHTS ----------

function renderInsights(movs, meses, mesesEscopo, linhas) {
  const itens = [];
  const add = (icon, txt) => itens.push({ icon, txt });
  const doEscopo = movs.filter(m => mesesEscopo.includes(m.mes));
  const ent = soma(doEscopo.filter(m => m.lado === 'ent'));
  const sai = soma(doEscopo.filter(m => m.lado === 'sai'));
  const escopo = escopoLabel(meses);

  // 1. Resultado do período
  if (ent > 0 || sai > 0) {
    const res = ent - sai;
    if (res >= 0) add('✅', `Em ${escopo} você recebeu ${fmtVal(ent)} e gastou ${fmtVal(sai)}: sobraram ${fmtVal(res)}` +
      (ent > 0 ? ` (${fmtPct(res / ent)} do que entrou).` : '.'));
    else add('⚠️', `Em ${escopo} as saídas (${fmtVal(sai)}) passaram as entradas (${fmtVal(ent)}) em ${fmtVal(-res)}.`);
  }

  // 2. Maior categoria de gasto
  const cats = agrupa(doEscopo, 'sai');
  if (cats.length > 1 && sai > 0) {
    add('🧭', `${cats[0].label} é o maior gasto: ${fmtVal(cats[0].valor)}, ${fmtPct(cats[0].valor / sai)} das saídas.`);
  }

  // 3. Último mês vs média dos anteriores do período
  const comGasto = linhas.filter(l => l.sai > 0);
  if (!dash.mes && comGasto.length >= 3) {
    const ultimo = comGasto[comGasto.length - 1];
    const media  = comGasto.slice(0, -1).reduce((s, l) => s + l.sai, 0) / (comGasto.length - 1);
    const d = (ultimo.sai - media) / media;
    if (Math.abs(d) >= 0.05) {
      add(d > 0 ? '📈' : '📉', `Os gastos de ${mesAnoLabel(ultimo.mes)} ficaram ${fmtPct(Math.abs(d))} ${d > 0 ? 'acima' : 'abaixo'} ` +
        `da média dos meses anteriores (${fmtVal(media)}).`);
    }
  }

  // 4. Meses no vermelho
  const comMov = linhas.filter(l => l.ent > 0 || l.sai > 0);
  const negativos = comMov.filter(l => l.res < 0);
  if (!dash.mes && comMov.length >= 2 && negativos.length) {
    add('🔴', `Em ${negativos.length} de ${comMov.length} meses as saídas superaram as entradas` +
      ` (pior: ${mesAnoLabel(negativos.sort((a, b) => a.res - b.res)[0].mes)}).`);
  }

  // 5. Onde mais gastou no cartão
  const top = topEstabelecimentos(mesesEscopo, 1)[0];
  if (top) {
    add('💳', `No cartão, o maior gasto somado foi em ${top.label}: ${fmtVal(top.valor)} em ${top.qtd} ${top.qtd === 1 ? 'compra' : 'compras'}.`);
  }

  // 6. Parcelas já comprometidas
  const parcelas = parcelasFuturas();
  const proximos = Object.keys(parcelas).sort().slice(0, 3);
  if (proximos.length) {
    const total3 = proximos.reduce((s, m) => s + parcelas[m], 0);
    const mediaEnt = comMov.length ? comMov.reduce((s, l) => s + l.ent, 0) / comMov.length : 0;
    const peso = mediaEnt > 0 ? ` — cerca de ${fmtPct(parcelas[proximos[0]] / mediaEnt)} das suas entradas médias por mês` : '';
    add('🗓️', `Você já tem ${fmtVal(total3)} em parcelas do cartão para os próximos ${proximos.length} ${proximos.length === 1 ? 'mês' : 'meses'}` +
      ` (${fmtVal(parcelas[proximos[0]])} em ${mesAnoLabel(proximos[0])}${peso}).`);
  }

  // 7. Investimentos no período
  const inv = invResumo(mesesEscopo);
  if (inv.aportes > 0 || inv.rendimentos > 0) {
    const res = ent - sai;
    let txt = `Você investiu ${fmtVal(inv.aportes)} em ${escopo}`;
    if (inv.aportes > 0 && res > 0) txt += ` — ${fmtPct(Math.min(inv.aportes / res, 9.99))} do que sobrou`;
    else if (inv.aportes > 0 && ent > 0) txt += ` (${fmtPct(inv.aportes / ent)} das entradas)`;
    txt += `. Patrimônio investido: ${fmtVal(inv.patrimonio)}`;
    if (inv.rendimentos > 0) txt += `, com ${fmtVal(inv.rendimentos)} de rendimentos no período`;
    add('💰', txt + '.');
  }

  if (dash.cat) add('🔎', 'Filtro de categoria ativo: saídas, resultado e gráficos mostram só essa categoria.');

  const ul = document.getElementById('dash-insights');
  ul.textContent = '';
  if (!itens.length) itens.push({ icon: 'ℹ️', txt: 'Sem dados suficientes no período para gerar insights.' });
  itens.forEach(i => {
    const li = document.createElement('li');
    li.dataset.icon = i.icon;
    li.textContent = i.txt;
    ul.append(li);
  });
}

// ---------- TABELA ----------

function renderTabela(linhas) {
  const body = document.getElementById('dash-table-body');
  body.textContent = '';
  let acum = 0;
  linhas.forEach(l => {
    acum += l.res;
    const tr = document.createElement('tr');
    if (l.mes === dash.mes) tr.className = 'sel';
    tr.onclick = () => dashToggleMes(l.mes);
    const cel = (txt, cls) => { const td = document.createElement('td'); td.textContent = txt; if (cls) td.className = cls; tr.append(td); };
    cel(mesAnoLabel(l.mes));
    cel(fmtVal(l.ent));
    cel(fmtVal(l.cartao));
    cel(fmtVal(l.outras));
    cel(fmtVal(l.res), l.res >= 0 ? 'pos' : 'neg');
    cel(fmtVal(acum), acum >= 0 ? 'pos' : 'neg');
    cel(fmtVal(invSoma(invDoMes(l.mes), 'aporte')));
    cel(fmtVal(invPatrimonioAte(l.mes)));
    body.prepend(tr);  // mais recente no topo
  });
}

// ---------- GRÁFICOS ----------

function baseOpts() {
  const muted = cssVar('--muted');
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size   = 11;
  Chart.defaults.color       = muted;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    plugins: {
      legend: {
        position: 'top', align: 'start',
        // Chave da legenda espelha a marca: retângulo para barras, linha para linhas.
        labels: {
          boxWidth: 10, boxHeight: 10, padding: 14, color: cssVar('--text'), usePointStyle: true,
          generateLabels: chart => Chart.defaults.plugins.legend.labels.generateLabels(chart).map(item => {
            const ds = chart.data.datasets[item.datasetIndex];
            const linha = (ds.type || chart.config.type) === 'line';
            const cor = Array.isArray(ds.backgroundColor) ? ds.borderColor || cssVar('--muted') : ds.backgroundColor;
            return { ...item, pointStyle: linha ? 'line' : 'rect', fillStyle: linha ? ds.borderColor : (ds.legendColor || cor),
                     strokeStyle: linha ? ds.borderColor : (ds.legendColor || cor), lineWidth: linha ? 2 : 0 };
          }),
        },
      },
      tooltip: {
        backgroundColor: cssVar('--bg1'),
        titleColor: cssVar('--muted'),
        bodyColor: cssVar('--text'),
        borderColor: cssVar('--border2'),
        borderWidth: 1,
        padding: 10,
        boxWidth: 10, boxHeight: 2, boxPadding: 6,
        bodyFont: { weight: '600' },
        callbacks: { label: c => ` ${fmtVal(c.parsed[c.chart.options.indexAxis === 'y' ? 'x' : 'y'])}  ${c.dataset.label}` },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: cssVar('--viz-axis') }, ticks: { color: muted } },
      y: { grid: { color: cssVar('--viz-grid') }, border: { display: false }, ticks: { color: muted, callback: fmtEixo, maxTicksLimit: 6 } },
    },
  };
}

function novoGrafico(id, config) {
  if (dashCharts[id]) dashCharts[id].destroy();
  dashCharts[id] = new Chart(document.getElementById('dash-c-' + id), config);
}

function barra(cor) {
  return { backgroundColor: cor, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28 };
}

function renderMensal(linhas) {
  const cEnt = cssVar('--viz-ent'), cSai = cssVar('--viz-sai'), cSaldo = cssVar('--viz-saldo');
  // Mês selecionado fica em destaque; os demais ficam esmaecidos.
  const cor = (c, i) => !dash.mes || linhas[i].mes === dash.mes ? c : comAlpha(c, 0.25);
  const opts = baseOpts();
  opts.interaction = { mode: 'index', intersect: false };
  opts.onClick = (evt, els, chart) => {
    const pts = chart.getElementsAtEventForMode(evt, 'index', { intersect: false }, false);
    if (pts.length) dashToggleMes(linhas[pts[0].index].mes);
  };
  opts.onHover = (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; };
  opts.plugins.tooltip.callbacks.footer = () => 'Toque para filtrar este mês';

  novoGrafico('mensal', {
    type: 'bar',
    data: {
      labels: linhas.map(l => mesCurto(l.mes)),
      datasets: [
        { label: 'Entradas', data: linhas.map(l => l.ent), order: 1, ...barra(cEnt), legendColor: cEnt,
          backgroundColor: linhas.map((l, i) => cor(cEnt, i)) },
        { label: dash.cat ? 'Saídas (categoria)' : 'Saídas', data: linhas.map(l => l.sai), order: 1, ...barra(cSai), legendColor: cSai,
          backgroundColor: linhas.map((l, i) => cor(cSai, i)) },
        // Mês sem nenhum lançamento fica sem ponto (lacuna), em vez de parecer resultado zero.
        { type: 'line', label: 'Resultado', order: 0,
          data: linhas.map(l => l.ent || l.sai ? l.res : null),
          borderColor: cSaldo, backgroundColor: cSaldo, borderWidth: 2, tension: 0, spanGaps: false,
          pointRadius: linhas.map(l => !dash.mes || l.mes === dash.mes ? 4 : 2), pointHoverRadius: 6,
          pointBackgroundColor: cSaldo, pointBorderColor: cssVar('--bg1'), pointBorderWidth: 2 },
      ],
    },
    options: { ...opts, datasets: { bar: { categoryPercentage: 0.72, barPercentage: 0.88 } } },
  });
}

// Barras horizontais com altura proporcional ao número de itens.
function renderBarrasH(id, itens, corVar, rotulo, { selecionado, onClick }) {
  const holder = document.getElementById('dash-h-' + id);
  if (!itens.length) {
    if (dashCharts[id]) { dashCharts[id].destroy(); delete dashCharts[id]; }
    holder.style.height = '';
    holder.innerHTML = `<div class="dash-msg">Sem ${rotulo.toLowerCase()} no período</div>`;
    return;
  }
  if (!holder.querySelector('canvas')) holder.innerHTML = `<canvas id="dash-c-${id}" role="img" aria-label="${rotulo}"></canvas>`;
  holder.style.height = (itens.length * 34 + 36) + 'px';

  const c = cssVar(corVar);
  const opts = baseOpts();
  opts.indexAxis = 'y';
  opts.plugins.legend.display = false;  // série única: o título do card a nomeia
  opts.scales = {
    x: { grid: { color: cssVar('--viz-grid') }, border: { display: false }, ticks: { color: cssVar('--muted'), callback: fmtEixo, maxTicksLimit: 5 } },
    y: { grid: { display: false }, border: { color: cssVar('--viz-axis') }, ticks: { color: cssVar('--text') } },
  };
  const total = itens.reduce((s, x) => s + x.valor, 0);
  opts.plugins.tooltip.callbacks.label = ctx => ` ${fmtVal(ctx.parsed.x)}  ·  ${fmtPct(ctx.parsed.x / total)} do total`;
  if (onClick) {
    opts.onClick = (evt, els) => { if (els.length) onClick(itens[els[0].index]); };
    opts.onHover = (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; };
    opts.plugins.tooltip.callbacks.footer = () => 'Toque para filtrar';
  }

  novoGrafico(id, {
    type: 'bar',
    data: {
      labels: itens.map(x => x.label),
      datasets: [{ label: rotulo, data: itens.map(x => x.valor), ...barra(c),
        backgroundColor: itens.map(x => !selecionado || x.cat === selecionado ? c : comAlpha(c, 0.25)) }],
    },
    options: { ...opts, datasets: { bar: { categoryPercentage: 0.8, barPercentage: 0.9 } } },
  });
}

function renderAcumulado(linhas) {
  const c = cssVar('--viz-saldo');
  let acum = 0;
  const dados = linhas.map(l => (acum += l.res));
  const opts = baseOpts();
  opts.plugins.legend.display = false;
  opts.interaction = { mode: 'index', intersect: false };
  opts.onClick = (evt, els, chart) => {
    const pts = chart.getElementsAtEventForMode(evt, 'index', { intersect: false }, false);
    if (pts.length) dashToggleMes(linhas[pts[0].index].mes);
  };

  novoGrafico('acum', {
    type: 'line',
    data: {
      labels: linhas.map(l => mesCurto(l.mes)),
      datasets: [{ label: 'Saldo acumulado', data: dados, borderColor: c, borderWidth: 2, tension: 0,
        fill: 'origin', backgroundColor: comAlpha(c, 0.12),
        pointRadius: linhas.map(l => l.mes === dash.mes ? 6 : 3), pointHoverRadius: 6,
        pointBackgroundColor: c, pointBorderColor: cssVar('--bg1'), pointBorderWidth: 2 }],
    },
    options: opts,
  });
}

function renderTop(mesesEscopo) {
  const note   = document.getElementById('dash-top-note');
  const holder = document.getElementById('dash-h-top');
  if (dash.cat && dash.cat !== 'cartao') {
    if (dashCharts.top) { dashCharts.top.destroy(); delete dashCharts.top; }
    holder.style.display = 'none';
    note.style.display = '';
    note.textContent = 'Disponível só para a categoria Cartão de crédito.';
    return;
  }
  holder.style.display = '';
  note.style.display = 'none';
  const top = topEstabelecimentos(mesesEscopo, 8);
  renderBarrasH('top', top, '--viz-sai', 'Compras no cartão', {});
  if (dashCharts.top) {
    dashCharts.top.options.plugins.tooltip.callbacks.label =
      ctx => ` ${fmtVal(ctx.parsed.x)}  ·  ${top[ctx.dataIndex].qtd} ${top[ctx.dataIndex].qtd === 1 ? 'compra' : 'compras'}`;
  }
}

// Evolução da carteira: patrimônio no fim de cada mês (linha) e aportes do mês (barras).
// Um só eixo em R$; cor própria (violeta), nunca no mesmo gráfico que o azul das entradas.
function renderCarteira(meses) {
  const holder = document.getElementById('dash-h-inv');
  if (!investimentos.length) {
    if (dashCharts.inv) { dashCharts.inv.destroy(); delete dashCharts.inv; }
    holder.style.height = '';
    holder.innerHTML = '<div class="dash-msg">Cadastre aportes e rendimentos na aba Investimentos para ver a evolução da carteira.</div>';
    return;
  }
  if (!holder.querySelector('canvas')) {
    holder.innerHTML = '<canvas id="dash-c-inv" role="img" aria-label="Evolução do patrimônio investido"></canvas>';
  }
  holder.style.height = '260px';

  const c = cssVar('--viz-inv');
  const patrimonio = meses.map(invPatrimonioAte);
  const aportes    = meses.map(m => invSoma(invDoMes(m), 'aporte'));
  const rendim     = meses.map(m => invSoma(invDoMes(m), 'rendimento'));
  // Barras em tom claro do violeta; meses fora do filtro ficam ainda mais claros.
  const corBarra   = i => comAlpha(c, !dash.mes || meses[i] === dash.mes ? 0.45 : 0.12);

  const opts = baseOpts();
  opts.interaction = { mode: 'index', intersect: false };
  opts.onClick = (evt, els, chart) => {
    const pts = chart.getElementsAtEventForMode(evt, 'index', { intersect: false }, false);
    if (pts.length) dashToggleMes(meses[pts[0].index]);
  };
  opts.plugins.tooltip.callbacks.footer = items => {
    const r = rendim[items[0].dataIndex];
    return r ? `Rendimentos no mês: ${fmtVal(r)}` : '';
  };

  novoGrafico('inv', {
    type: 'bar',
    data: {
      labels: meses.map(mesCurto),
      datasets: [
        { label: 'Aportes do mês', data: aportes, order: 1, ...barra(comAlpha(c, 0.45)), legendColor: comAlpha(c, 0.45),
          backgroundColor: aportes.map((_, i) => corBarra(i)) },
        { type: 'line', label: 'Patrimônio', data: patrimonio, order: 0,
          borderColor: c, backgroundColor: c, borderWidth: 2, tension: 0,
          pointRadius: meses.map(m => !dash.mes || m === dash.mes ? 4 : 2), pointHoverRadius: 6,
          pointBackgroundColor: c, pointBorderColor: cssVar('--bg1'), pointBorderWidth: 2 },
      ],
    },
    options: { ...opts, datasets: { bar: { categoryPercentage: 0.6, barPercentage: 0.9 } } },
  });
}

function renderPrevisao() {
  const parcelas = parcelasFuturas();
  const previstas = entradasPrevistas();
  const inicio = shiftMes(mesAtual(), 1);
  const meses = [];
  for (let i = 0; i < 6; i++) meses.push(shiftMes(inicio, i));

  const opts = baseOpts();
  opts.interaction = { mode: 'index', intersect: false };
  opts.plugins.tooltip.callbacks.footer = items => {
    const i = items[0].dataIndex;
    const sobra = (previstas[meses[i]] || 0) - (parcelas[meses[i]] || 0);
    return `Sobra após parcelas: ${fmtVal(sobra)}`;
  };

  novoGrafico('prev', {
    type: 'bar',
    data: {
      labels: meses.map(mesCurto),
      datasets: [
        { label: 'Entradas previstas', data: meses.map(m => previstas[m] || 0), ...barra(cssVar('--viz-ent')) },
        { label: 'Parcelas do cartão', data: meses.map(m => parcelas[m] || 0), ...barra(cssVar('--viz-sai')) },
      ],
    },
    options: { ...opts, datasets: { bar: { categoryPercentage: 0.72, barPercentage: 0.88 } } },
  });
}

// Primeira renderização: app.js já carregou os dados (loadAll) antes deste arquivo.
renderDashboard();
