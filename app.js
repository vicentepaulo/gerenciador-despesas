/* =============================================
   SICREDI FATURAS — app.js
   ============================================= */

// ---------- CONSTANTS ----------

const IGNORE_PATTERNS = [
  /pag\s*fat/i,
  /pagamento\s*fatura/i,
  /pag\s*deb\s*cc/i,
  /^pagamento\s+\d+$/i,   // PDF Sicredi X: "Pagamento 031050631"
];

function isPagFatura(desc) {
  return IGNORE_PATTERNS.some(p => p.test(desc));
}

const TIPO_LABELS = {
  salario:          'Salário',
  vale_alimentacao: 'Vale alimentação',
  vale_refeicao:    'Vale refeição',
  freelance:        'Freelance',
  bonus:            'Bônus',
  aluguel:          'Aluguel recebido',
  investimento:     'Rendimento investimento',
  outros:           'Outros',
};

const SAIDA_LABELS = {
  moradia:            'Moradia / Aluguel',
  contas:             'Contas (água, luz, internet)',
  mercado:            'Mercado',
  transporte:         'Transporte',
  saude:              'Saúde',
  educacao:           'Educação',
  lazer:              'Lazer',
  pix_transferencia:  'Pix / Transferência',
  outros:             'Outros',
};

// Agrupamento usado nas métricas de Saídas (fixas vs. variáveis, como um app de despesas comum)
const SAIDA_FIXAS     = ['moradia', 'contas', 'educacao'];
const SAIDA_VARIAVEIS = ['mercado', 'transporte', 'saude', 'lazer'];

const MES_LABELS = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
];

// ---------- STATE ----------

let allTx          = [];
let faturas        = [];
let pending        = null;
let statusOverride = {};
let entradas       = [];
let entradasFuturas = [];
let saidas          = [];
let theme           = 'light';

let txSort      = { col: null, dir: null };
let installSort = { col: null, dir: null };
let entSort     = { col: null, dir: null };
let futSort     = { col: null, dir: null };
let sdSort      = { col: null, dir: null };

// ---------- PERSISTENCE (localStorage) ----------
// Todos os dados ficam salvos no localStorage do navegador.

const STORAGE_KEY = 'sicredi_dados';
let _saveTimer = null;

function saveAll() {
  const payload = { allTx, faturas, statusOverride, entradas, entradasFuturas, saidas, theme };
  // debounce: espera 400ms de silêncio antes de salvar
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch (_) {}
  }, 400);
}

function loadAll() {
  try {
    // 'sicredi_fallback' era a chave usada na versão com server.js
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('sicredi_fallback');
    if (raw) {
      const data = JSON.parse(raw);
      allTx           = data.allTx           || [];
      faturas         = data.faturas         || [];
      statusOverride  = data.statusOverride  || {};
      entradas        = data.entradas        || [];
      entradasFuturas = data.entradasFuturas || [];
      saidas          = data.saidas          || [];
      if (data.theme) applyTheme(data.theme, true);
    }
  } catch (_) {}
  afterLoad();
}

function afterLoad() {
  updateMetrics();
  updateEnMetrics();
  renderEnMensal();
  renderEntradasFuturas();
  updateSaidaMetrics();
  renderSdMensal();
  renderSaidas();
  updateFaturaFilter();
  const enDataInput = document.getElementById('en-data');
  if (enDataInput) enDataInput.value = todayISO();
  const futMesInput = document.getElementById('fut-mes');
  if (futMesInput) futMesInput.value = todayISO().slice(0, 7);
  const sdDataInput = document.getElementById('sd-data');
  if (sdDataInput) sdDataInput.value = todayISO();
}

// ---------- TOAST ----------

function showToast(msg, type, duration) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast toast-' + (type || 'info');
  el.style.display = 'block';
  if (duration > 0) setTimeout(hideToast, duration);
}

function hideToast() {
  const el = document.getElementById('toast');
  if (el) el.style.display = 'none';
}

// ---------- HELPERS ----------

function fmtVal(v) {
  const abs = Math.abs(v);
  const str = abs.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '- ' : '') + 'R$\u00a0' + str;
}

function cycleDir(current) {
  if (current === null)  return 'asc';
  if (current === 'asc') return 'desc';
  return null;
}

function sortData(list, col, dir, getter) {
  if (!col || !dir) return list;
  return [...list].sort((a, b) => {
    const va = getter(a, col);
    const vb = getter(b, col);
    if (va === vb) return 0;
    return (va < vb ? -1 : 1) * (dir === 'asc' ? 1 : -1);
  });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isoToBR(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function mesAnoLabel(mesAno) {
  if (!mesAno) return '—';
  const [y, m] = mesAno.split('-');
  return `${MES_LABELS[parseInt(m) - 1]} ${y}`;
}

function maskCurrency(input) {
  let v = input.value.replace(/\D/g, '');
  v = (parseInt(v || '0') / 100).toFixed(2);
  input.value = v.replace('.', ',');
}

function parseCurrencyInput(str) {
  return parseFloat((str || '0').replace(/\./g, '').replace(',', '.')) || 0;
}

// ---------- THEME ----------

// Aplica o tema na tela (e opcionalmente atualiza o estado sem re-salvar,
// usado quando o tema vem dos dados salvos durante o carregamento).
function applyTheme(t, fromLoad) {
  theme = t === 'dark' ? 'dark' : 'light';
  document.body.classList.toggle('dark', theme === 'dark');
  const btnLight = document.getElementById('btn-light');
  const btnDark  = document.getElementById('btn-dark');
  if (btnLight) btnLight.classList.toggle('on', theme === 'light');
  if (btnDark)  btnDark.classList.toggle('on',  theme === 'dark');
  try { localStorage.setItem('sicredi_theme', theme); } catch (_) {}
  if (fromLoad) return; // não reagenda salvamento durante o carregamento inicial
}

// Chamado pelos botões Claro/Escuro — aplica e persiste no localStorage.
function setTheme(t) {
  applyTheme(t);
  saveAll();
}

// Aplica o tema salvo assim que o script roda, antes de carregar os dados,
// para não haver um "flash" do tema errado ao recarregar.
(function initTheme() {
  let saved = 'light';
  try { saved = localStorage.getItem('sicredi_theme') || 'light'; } catch (_) {}
  applyTheme(saved, true);
})();

// ---------- TABS ----------

function switchTab(name, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
  // fechar menu mobile se aberto
  document.getElementById('nav-menu').classList.remove('open');
  if (name === 'entradas')      { renderEntradas(); renderEnMensal(); }
  if (name === 'futuras')       renderEntradasFuturas();
  if (name === 'saidas')        { renderSaidas(); renderSdMensal(); }
  if (name === 'transacoes')    renderTx();
  if (name === 'parcelamentos') renderInstall();
  if (name === 'faturas')       renderFaturas();
}

function toggleMobileMenu() {
  document.getElementById('nav-menu').classList.toggle('open');
}

// ---------- DRAG & DROP / FILE ----------

function ev(e, on) {
  e.preventDefault();
  document.getElementById('dropzone').classList.toggle('dragover', on);
}

function drop(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (f) readFile(f);
}

function handleFile(e) {
  const f = e.target.files[0];
  if (f) readFile(f);
}

function readFile(file) {
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    parsePDF(file).catch(err => {
      console.error(err);
      showToast('Não foi possível ler o PDF: ' + err.message, 'warn', 5000);
    });
    return;
  }
  const rd = new FileReader();
  rd.onload = e => parseCSV(e.target.result, file.name);
  rd.readAsText(file, 'latin1');
}

// ---------- PARSE PDF (Sicredi X) ----------
// O app Sicredi X só exporta a fatura em PDF. O texto é extraído com pdf.js
// (carregado sob demanda) e as transações são lidas pela posição das colunas
// na tabela "Transações": Data e hora | Cidade | Compra | Descrição | Parcela | ... | Valor em reais.

const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const MES_ABREV = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

let _pdfjsLoading = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!_pdfjsLoading) {
    _pdfjsLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS_URL + 'pdf.min.js';
      s.onload  = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_URL + 'pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = () => { _pdfjsLoading = null; reject(new Error('sem conexão para carregar o leitor de PDF')); };
      document.head.appendChild(s);
    });
  }
  return _pdfjsLoading;
}

// Agrupa os textos de cada página em linhas (mesma altura), da mais alta para a mais baixa.
async function pdfRows(file) {
  const pdfjs = await loadPdfJs();
  const pdf   = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc    = await (await pdf.getPage(p)).getTextContent();
    const items = tc.items
      .filter(it => it.str.trim())
      .map(it => ({ x: it.transform[4], y: it.transform[5], s: it.str.trim() }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of items) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(row.y - it.y) <= 2) row.items.push(it);
      else rows.push({ y: it.y, items: [it] });
    }
    rows.forEach(r => {
      r.items.sort((a, b) => a.x - b.x);
      r.text = r.items.map(i => i.s).join(' ');
    });
    pages.push(rows);
  }
  return pages;
}

function brlToNumber(str) {
  return parseFloat(str.replace(/R\$\s*/, '').replace(/\./g, '').replace(',', '.')) || 0;
}

async function parsePDF(file) {
  showToast('Lendo PDF…', 'info', 0);
  const pages   = await pdfRows(file);
  const allText = pages.map(rows => rows.map(r => r.text).join('\n')).join('\n');
  const logs    = [];

  const vencStr = (allText.match(/Vencimento\s+(\d{2}\/\d{2}\/\d{4})/) || [])[1] || '';
  const totalM  = allText.match(/Total fatura de\s+([a-zç]+)\s+(R\$\s*[\d.,]+)/i);
  const totalStr = totalM ? totalM[2] : '';
  if (!vencStr) throw new Error('não parece ser uma fatura do Sicredi (vencimento não encontrado)');

  const [, vMes, vAno] = vencStr.split('/').map(Number);
  const mesNome  = totalM ? totalM[1][0].toUpperCase() + totalM[1].slice(1).toLowerCase() : MES_LABELS[vMes - 1];
  // Id pelo mês da fatura (e não pelo nome do arquivo) para que baixar e
  // importar o mesmo PDF de novo não duplique as transações.
  const filename = `${mesNome} ${vAno}`;

  const assocRow = pages.flat().find(r => /Vencimento\s+\d{2}\/\d{2}\/\d{4}/.test(r.text));
  const meta = {
    'Associado':      assocRow ? assocRow.items[0].s : '—',
    'Conta Corrente': '—',
  };

  const tx = [];
  const uidCount  = {};
  let titular     = null;  // final do cartão principal (primeiro listado)
  let cartao      = '';
  let ignored     = 0;
  const totaisCartao = {};

  for (const rows of pages) {
    let inTable = false;
    const pageTx = [];
    const orphans = [];  // pedaços de descrição em linha própria (ex: "Anuidade Diferenc 11/12")

    for (const r of rows) {
      const t = r.text;
      // Linha "Cartão <nome> (final 1234)" vem logo acima do cabeçalho da tabela.
      const cm = t.match(/^Cartão.*final\s*(\d{4})/);
      if (cm) {
        cartao = cm[1];
        if (!titular) { titular = cartao; meta['Conta Corrente'] = `Cartão final ${titular}`; }
        continue;
      }
      if (/^Data e hora/.test(t)) { inTable = true; continue; }
      if (/^Legenda/.test(t))     { inTable = false; continue; }
      if (!inTable) continue;
      // "Total cartão" se repete em cada página do mesmo cartão — guarda um por cartão.
      if (/^Total cartão/.test(t)) {
        const vm = t.match(/R\$\s*[\d.,]+/);
        if (vm) totaisCartao[cartao] = brlToNumber(vm[0]);
        continue;
      }
      if (/^R\$\s*[\d.,]+$/.test(t) && r.items[0].x > 450) { totaisCartao[cartao] = brlToNumber(t); continue; }

      const dm = t.match(/^(\d{2})\/\s*([a-zç]{3})\s+(\d{2}:\d{2})/i);
      const descParts = r.items.filter(i => i.x >= 230 && i.x < 345).map(i => i.s);
      if (!dm) {
        if (descParts.length) orphans.push({ y: r.y, s: descParts.join(' ') });
        continue;
      }

      const mes   = MES_ABREV.indexOf(dm[2].toLowerCase()) + 1;
      const ano   = mes > vMes ? vAno - 1 : vAno;
      const valIt = r.items.find(i => i.x >= 450 && /R\$/.test(i.s));
      if (!mes || !valIt) continue;
      const neg   = r.items.some(i => i.x >= 450 && i.s.trim().startsWith('-'));
      const parIt = r.items.find(i => i.x >= 345 && i.x < 390 && /^\d+\/\d+$/.test(i.s));

      pageTx.push({
        y: r.y, hora: dm[3],
        data: `${dm[1]}/${String(mes).padStart(2, '0')}/${ano}`,
        descParts: [{ y: r.y, s: descParts.join(' ') }],
        parcelaRaw: parIt ? parIt.s : '',
        valor: (neg ? -1 : 1) * brlToNumber(valIt.s),
        adicional: cartao && cartao !== titular ? cartao : '',
      });
    }

    // Junta cada pedaço de descrição solto à transação mais próxima (até 12pt de distância).
    for (const o of orphans) {
      let best = null;
      for (const p of pageTx) if (!best || Math.abs(p.y - o.y) < Math.abs(best.y - o.y)) best = p;
      if (best && Math.abs(best.y - o.y) <= 12) best.descParts.push(o);
    }

    for (const p of pageTx) {
      const desc = p.descParts.sort((a, b) => b.y - a.y).map(d => d.s).filter(Boolean).join(' ').trim();
      if (isPagFatura(desc)) { ignored++; continue; }

      const pm = p.parcelaRaw.match(/^(\d+)\/(\d+)$/);
      const parcela = pm ? { atual: parseInt(pm[1]), total: parseInt(pm[2]) } : null;

      const baseUid = [p.data, p.hora, desc, p.parcelaRaw, filename].join('||');
      uidCount[baseUid] = (uidCount[baseUid] || 0) + 1;
      const uid = uidCount[baseUid] > 1 ? `${baseUid}||${uidCount[baseUid]}` : baseUid;

      tx.push({ uid, data: p.data, desc, parcela, valor: p.valor, adicional: p.adicional,
                tipo: p.valor < 0 ? 'credito' : 'debito', faturaId: filename });
    }
  }

  hideToast();
  if (!tx.length) throw new Error('nenhuma transação encontrada no PDF');

  logs.push({ t: 'info', m: `Associado: ${meta['Associado']}` });
  logs.push({ t: 'info', m: `Vencimento: ${vencStr} | Total: ${totalStr}` });
  logs.push({ t: 'ok',   m: `${tx.length} transações lidas do PDF (${ignored} pagamentos de fatura ignorados)` });
  logs.push({ t: 'ok',   m: `Parcelamentos: ${tx.filter(t => t.parcela).length} | Créditos: ${tx.filter(t => t.tipo === 'credito').length}` });

  // Conferência: a soma das compras deve bater com os "Total cartão" do PDF.
  const somaDebitos  = tx.filter(t => t.valor > 0).reduce((s, t) => s + t.valor, 0);
  const totalCartoes = Object.values(totaisCartao).reduce((s, v) => s + v, 0);
  if (totalCartoes) {
    const bate = Math.abs(somaDebitos - totalCartoes) < 0.01;
    logs.push({ t: bate ? 'ok' : 'warn',
      m: bate ? `Conferido: compras somam ${fmtVal(somaDebitos)}, igual ao total dos cartões no PDF`
              : `Atenção: compras somam ${fmtVal(somaDebitos)}, mas o PDF informa ${fmtVal(totalCartoes)} — confira a lista` });
  }

  // O PDF só é emitido depois do fechamento, então a fatura já está fechada.
  pending = { tx, meta, vencStr, totalStr, situacao: 'Fechada', filename, logs };
  showPreview();
}

// ---------- PARSE CSV ----------

function parseCSV(raw, filename) {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l);
  const logs  = [];
  const meta  = {};
  let dataStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.toLowerCase().includes('data') && l.toLowerCase().includes('descri')) {
      dataStart = i;
      break;
    }
    const parts = l.split(';').map(s => s.replace(/^[\s"']+|[\s"']+$/g, ''));
    if (parts[0] && parts[1]) meta[parts[0].trim()] = parts[1].trim();
  }

  const vencStr  = meta[' Data de Vencimento'] || meta['Data de Vencimento'] || '';
  const totalStr = meta[' Valor Total (R$)'] || meta['Valor Total (R$)']
                || meta[' Valor Total']      || meta['Valor Total'] || '';
  const situacao = meta[' Situação'] || meta['Situação'] || '';

  logs.push({ t: 'info', m: `Associado: ${meta[' Associado'] || meta['Associado'] || '—'}` });
  logs.push({ t: 'info', m: `Vencimento: ${vencStr} | Total: ${totalStr} | ${situacao}` });

  if (dataStart < 0) {
    logs.push({ t: 'warn', m: 'Cabeçalho de colunas não encontrado' });
    return;
  }

  const header = lines[dataStart].split(';').map(s => s.replace(/^[\s"']+|[\s"']+$/g, '').trim());
  logs.push({ t: 'ok', m: `Colunas: ${header.filter(Boolean).join(' · ')}` });

  const ci         = n => header.findIndex(h => h.toLowerCase().includes(n.toLowerCase()));
  const iData      = ci('data');
  const iDesc      = ci('descri');
  const iParcela   = ci('parcela');
  const iValor     = ci('valor');
  const iAdicional = ci('adicional');

  const tx = [];
  let ignored = 0;
  const uidCount = {};

  for (let i = dataStart + 1; i < lines.length; i++) {
    const row = lines[i].split(';').map(s => s.replace(/^[\s"']+|[\s"']+$/g, '').trim());
    if (!row[iData] || !row[iDesc]) continue;

    const desc = row[iDesc].trim();
    if (isPagFatura(desc)) { ignored++; continue; }

    const parcelaRaw = iParcela >= 0 ? (row[iParcela] || '') : '';
    const valorRaw   = (row[iValor] || '').replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
    const valor      = parseFloat(valorRaw) || 0;
    const adicional  = iAdicional >= 0 ? (row[iAdicional] || '') : '';

    let parcela = null;
    const pm = parcelaRaw.match(/\((\d+)\/(\d+)\)/);
    if (pm) parcela = { atual: parseInt(pm[1]), total: parseInt(pm[2]) };

    const tipo = valor < 0 ? 'credito' : 'debito';

    const baseUid = [row[iData], desc, parcelaRaw, filename].join('||');
    uidCount[baseUid] = (uidCount[baseUid] || 0) + 1;
    const uid = uidCount[baseUid] > 1 ? `${baseUid}||${uidCount[baseUid]}` : baseUid;

    tx.push({ uid, data: row[iData], desc, parcela, valor, adicional, tipo, faturaId: filename });
  }

  logs.push({ t: 'ok', m: `${tx.length} transações lidas (${ignored} pagamentos de fatura ignorados)` });
  logs.push({ t: 'ok', m: `Parcelamentos: ${tx.filter(t => t.parcela).length} | Créditos: ${tx.filter(t => t.tipo === 'credito').length}` });

  pending = { tx, meta, vencStr, totalStr, situacao, filename, logs };
  showPreview();
}

// ---------- PREVIEW ----------

function showPreview() {
  const p = pending;
  document.getElementById('preview-block').style.display = 'block';
  document.getElementById('preview-title').textContent =
    `Pré-visualização: ${p.filename} (${p.tx.length} transações)`;

  const assoc = p.meta[' Associado'] || p.meta['Associado'] || '—';
  const conta = p.meta[' Conta Corrente'] || p.meta['Conta Corrente'] || '—';

  document.getElementById('fatura-info').innerHTML = `
    <div class="sec-title" style="margin-bottom:.5rem">Dados da fatura</div>
    <div class="fatura-grid">
      <div class="fatura-item">Associado<b>${assoc}</b></div>
      <div class="fatura-item">Conta<b>${conta}</b></div>
      <div class="fatura-item">Vencimento<b>${p.vencStr}</b></div>
      <div class="fatura-item">Valor total<b style="color:var(--red)">${p.totalStr}</b></div>
      <div class="fatura-item">Situação<b>${p.situacao}</b></div>
    </div>`;

  document.getElementById('preview-cols').innerHTML =
    ['Data','Descrição','Parcela','Valor','Tipo','Adicional']
      .map(c => `<span class="badge b-blue">${c}</span>`).join('');

  document.getElementById('import-log').innerHTML =
    p.logs.map(l => `<div class="log-${l.t}">${l.t==='ok'?'✓':l.t==='warn'?'⚠':'ℹ'} ${l.m}</div>`).join('');

  document.getElementById('preview-body').innerHTML = p.tx.map(t => `
    <tr>
      <td style="white-space:nowrap;color:var(--muted);font-size:12px">${t.data}</td>
      <td>${t.desc}</td>
      <td>${t.parcela ? `<span class="badge b-amber">${t.parcela.atual}/${t.parcela.total}</span>` : '—'}</td>
      <td style="font-weight:500;color:${t.valor<0?'var(--green)':'var(--red)'};white-space:nowrap">${fmtVal(t.valor)}</td>
      <td><span class="badge ${t.tipo==='credito'?'b-green':'b-red'}">${t.tipo==='credito'?'Crédito':'Débito'}</span></td>
      <td style="font-size:12px;color:var(--muted)">${t.adicional||'—'}</td>
    </tr>`).join('');
}

function confirmImport() {
  if (!pending) return;
  const existing = new Set(allTx.map(t => t.uid));
  const added    = pending.tx.filter(t => !existing.has(t.uid));
  allTx = [...allTx, ...added];

  if (!faturas.find(f => f.id === pending.filename)) {
    const total = parseFloat(
      (pending.totalStr || '0').replace('R$','').replace(/\./g,'').replace(',','.')
    ) || 0;
    faturas.push({
      id: pending.filename, venc: pending.vencStr,
      total, totalStr: pending.totalStr,
      situacao: pending.situacao, count: pending.tx.length,
    });
  }

  pending = null;
  document.getElementById('preview-block').style.display = 'none';
  document.getElementById('finput').value = '';

  saveAll();
  updateFaturaFilter();
  updateMetrics();
  updateEnMetrics();
  updateSaidaMetrics();
  showToast(`${added.length} transações importadas e salvas ✓`, 'ok', 3000);
}

function cancelImport() {
  pending = null;
  document.getElementById('preview-block').style.display = 'none';
  document.getElementById('finput').value = '';
}

// ---------- TRANSACTIONS ----------

function sortTxBy(col) {
  if (txSort.col === col) {
    txSort.dir = cycleDir(txSort.dir);
    if (txSort.dir === null) txSort.col = null;
  } else { txSort.col = col; txSort.dir = 'asc'; }
  renderTx();
}

function txGetter(t, col) {
  if (col === 'data')    return t.data;
  if (col === 'desc')    return t.desc.toLowerCase();
  if (col === 'parcela') return t.parcela ? t.parcela.atual : -1;
  if (col === 'valor')   return Math.abs(t.valor);
  if (col === 'tipo')    return t.tipo;
  if (col === 'fatura')  return t.faturaId;
  return '';
}

function thTx(col, label) {
  const active = txSort.col === col;
  const icon   = !active ? '↕' : txSort.dir === 'asc' ? '↑' : '↓';
  return `<th style="cursor:pointer;user-select:none;${active?'color:var(--accent-text)':''}" onclick="sortTxBy('${col}')">${label} <span style="font-size:10px;opacity:${active?1:0.4}">${icon}</span></th>`;
}

function renderTx() {
  const q  = (document.getElementById('search').value || '').toLowerCase();
  const ft = document.getElementById('ftype').value;
  const ff = document.getElementById('ffatura').value;

  let list = allTx.filter(t => {
    if (q  && !t.desc.toLowerCase().includes(q))   return false;
    if (ft === 'parcelado' && !t.parcela)           return false;
    if (ft && ft !== 'parcelado' && t.tipo !== ft)  return false;
    if (ff && t.faturaId !== ff)                    return false;
    return true;
  });

  list = txSort.col && txSort.dir
    ? sortData(list, txSort.col, txSort.dir, txGetter)
    : [...list].sort((a, b) => b.data.localeCompare(a.data));

  document.getElementById('tx-head').innerHTML =
    thTx('data','Data') + thTx('desc','Descrição') + thTx('parcela','Parcela') +
    thTx('valor','Valor') + thTx('tipo','Tipo') + thTx('fatura','Fatura');

  const body = document.getElementById('tx-body');
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="6"><div class="empty-state">
      <div class="empty-icon">${allTx.length?'🔍':'📄'}</div>
      <div class="empty-title">${allTx.length?'Nenhum resultado':'Nenhuma transação importada'}</div>
      <div class="empty-sub">${allTx.length?'Tente outros filtros':'Importe um CSV do Sicredi para começar'}</div>
    </div></td></tr>`;
    return;
  }

  body.innerHTML = list.map(t => `
    <tr>
      <td style="white-space:nowrap;color:var(--muted);font-size:12px">${t.data}</td>
      <td>${t.desc}</td>
      <td>${t.parcela?`<span class="badge b-amber">${t.parcela.atual}/${t.parcela.total}</span>`:'<span style="color:var(--hint)">—</span>'}</td>
      <td style="font-weight:500;color:${t.valor<0?'var(--green)':'var(--red)'};white-space:nowrap">${fmtVal(t.valor)}</td>
      <td><span class="badge ${t.tipo==='credito'?'b-green':'b-red'}">${t.tipo==='credito'?'Crédito':'Débito'}</span></td>
      <td style="font-size:11px;color:var(--muted);max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.faturaId.replace('.csv','')}</td>
    </tr>`).join('');
}

// ---------- INSTALLMENTS ----------

function buildInstallRows() {
  return allTx.filter(t => t.parcela).map(t => {
    const status = statusOverride[t.uid] !== undefined
      ? statusOverride[t.uid]
      : (t.parcela.atual >= t.parcela.total ? 'quitado' : 'aberto');
    const restantes     = Math.max(0, t.parcela.total - t.parcela.atual);
    const restanteTotal = status === 'quitado' ? 0 : restantes * Math.abs(t.valor);
    return {
      uid: t.uid, desc: t.desc, data: t.data, faturaId: t.faturaId,
      atual: t.parcela.atual, total: t.parcela.total,
      valor: Math.abs(t.valor), restanteTotal, status,
    };
  });
}

function toggleStatus(uid) {
  const rows = buildInstallRows();
  const row  = rows.find(r => r.uid === uid);
  if (!row) return;
  statusOverride[uid] = row.status === 'aberto' ? 'quitado' : 'aberto';
  saveAll();
  renderInstall();
}

function sortInstallBy(col) {
  if (installSort.col === col) {
    installSort.dir = cycleDir(installSort.dir);
    if (installSort.dir === null) installSort.col = null;
  } else { installSort.col = col; installSort.dir = 'asc'; }
  renderInstall();
}

function installGetter(r, col) {
  if (col === 'data')      return r.data;
  if (col === 'desc')      return r.desc.toLowerCase();
  if (col === 'parcela')   return r.atual;
  if (col === 'progresso') return r.atual / r.total;
  if (col === 'valor')     return r.valor;
  if (col === 'restante')  return r.restanteTotal;
  if (col === 'status')    return r.status;
  return '';
}

function thInstall(col, label) {
  const active = installSort.col === col;
  const icon   = !active ? '↕' : installSort.dir === 'asc' ? '↑' : '↓';
  return `<th style="cursor:pointer;user-select:none;${active?'color:var(--accent-text)':''}" onclick="sortInstallBy('${col}')">${label} <span style="font-size:10px;opacity:${active?1:0.4}">${icon}</span></th>`;
}

function renderInstall() {
  const filterVal = document.getElementById('ip-filter').value;
  const allRows   = buildInstallRows();
  const abertos   = allRows.filter(r => r.status === 'aberto');
  const quitados  = allRows.filter(r => r.status === 'quitado');

  document.getElementById('ip-aberto').textContent   = abertos.length;
  document.getElementById('ip-quitado').textContent  = quitados.length;
  document.getElementById('ip-restante').textContent = fmtVal(abertos.reduce((s,r) => s+r.restanteTotal, 0));
  document.getElementById('ip-mes').textContent      = fmtVal(abertos.reduce((s,r) => s+r.valor, 0));

  let items = filterVal==='aberto' ? abertos : filterVal==='quitado' ? quitados : allRows;

  items = installSort.col && installSort.dir
    ? sortData(items, installSort.col, installSort.dir, installGetter)
    : [...items].sort((a, b) => b.data.localeCompare(a.data));

  document.getElementById('ip-head').innerHTML =
    thInstall('data','Data') + thInstall('desc','Descrição') + thInstall('parcela','Parcela') +
    thInstall('progresso','Progresso') + thInstall('valor','Valor') +
    thInstall('restante','Restante') + thInstall('status','Status');

  const body = document.getElementById('ip-body');
  if (!items.length) {
    body.innerHTML = `<tr><td colspan="7"><div class="empty-state">
      <div class="empty-icon">💳</div>
      <div class="empty-title">Nenhum parcelamento${filterVal!=='todos'?' nessa categoria':''}</div>
      <div class="empty-sub">Detectados automaticamente pelo campo Parcela</div>
    </div></td></tr>`;
    return;
  }

  body.innerHTML = items.map(r => {
    const pct     = Math.round((r.atual / r.total) * 100);
    const safeUid = r.uid.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return `<tr class="${r.status==='quitado'?'quitado':''}">
      <td style="white-space:nowrap;color:var(--muted);font-size:12px">${r.data}</td>
      <td>${r.desc}</td>
      <td><span class="badge b-amber">${r.atual}/${r.total}</span></td>
      <td style="min-width:90px">
        <div class="install-bar">
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
          <span style="font-size:11px;color:var(--muted);min-width:26px">${pct}%</span>
        </div>
      </td>
      <td style="font-weight:500;color:var(--red);white-space:nowrap">${fmtVal(r.valor)}</td>
      <td style="color:${r.status==='quitado'?'var(--muted)':'var(--red)'};white-space:nowrap">
        ${r.status==='quitado'?'—':fmtVal(r.restanteTotal)}</td>
      <td><button class="status-toggle ${r.status}" onclick="toggleStatus('${safeUid}')">
        ${r.status==='quitado'?'✓ Quitado':'● Em aberto'}
      </button></td>
    </tr>`;
  }).join('');
}

// ---------- FATURAS HISTORY ----------

function renderFaturas() {
  const el = document.getElementById('faturas-list');
  if (!faturas.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🧾</div>
      <div class="empty-title">Nenhuma fatura importada</div>
      <div class="empty-sub">Importe seus CSVs para ver o histórico aqui</div>
    </div>`;
    return;
  }
  el.innerHTML = faturas.map(f => `
    <div class="fatura-card">
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.id.replace('.csv','')}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">Venc: ${f.venc} · ${f.count} transações</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:15px;font-weight:500;color:var(--red)">${f.totalStr}</div>
        <span class="badge b-gray" style="margin-top:4px">${f.situacao}</span>
      </div>
    </div>`).join('');
}

// ---------- METRICS ----------

// Métricas da aba Transações seguem a fatura selecionada no filtro.
// Com uma fatura escolhida, "Total da fatura" é o valor oficial do banco
// (inclui juros, IOF e outros encargos que não aparecem como transação).
function updateMetrics() {
  const ff     = (document.getElementById('ffatura') || {}).value || '';
  const fatura = ff ? faturas.find(f => f.id === ff) : null;
  const base   = ff ? allTx.filter(t => t.faturaId === ff) : allTx;

  const debitos  = base.filter(t => t.tipo==='debito').reduce((s,t) => s+Math.abs(t.valor), 0);
  const creditos = base.filter(t => t.tipo==='credito').reduce((s,t) => s+Math.abs(t.valor), 0);
  // Sem filtro: soma dos totais oficiais de todas as faturas importadas.
  const oficiais = fatura ? [fatura] : faturas;
  const total    = oficiais.length && oficiais.every(f => f.total)
    ? oficiais.reduce((s, f) => s + f.total, 0)
    : debitos - creditos;
  document.getElementById('m-total').textContent    = fmtVal(total);
  document.getElementById('m-debitos').textContent  = fmtVal(debitos);
  document.getElementById('m-creditos').textContent = fmtVal(creditos);
  document.getElementById('m-parcels').textContent  = base.filter(t => t.parcela).length;
  document.getElementById('m-count').textContent    = base.length;
}

function updateFaturaFilter() {
  const sel  = document.getElementById('ffatura');
  const prev = sel.value;
  sel.innerHTML = '<option value="">Todas as faturas</option>' +
    faturas.map(f => `<option value="${f.id}">${f.id.replace('.csv','')}</option>`).join('');
  if (faturas.some(f => f.id === prev)) sel.value = prev;
}

function exportCSV() {
  if (!allTx.length) { showToast('Nenhuma transação para exportar','warn',3000); return; }
  const rows = [
    ['Data','Descrição','Parcela','Valor','Tipo','Adicional','Fatura'],
    ...allTx.map(t => [
      t.data, t.desc,
      t.parcela ? `${t.parcela.atual}/${t.parcela.total}` : '',
      t.valor.toFixed(2).replace('.',','),
      t.tipo, t.adicional, t.faturaId,
    ]),
  ];
  const blob = new Blob(['\uFEFF' + rows.map(r => r.join(';')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'faturas_sicredi.csv';
  a.click();
}

// ---------- EDIÇÃO ----------
// Editar carrega o item no formulário de cadastro da própria aba (prefixos
// en / fut / sd); o botão "Adicionar" vira "Salvar alteração" até salvar ou cancelar.

const editing = { en: null, fut: null, sd: null };
const SUBMIT_LABELS = { en: 'Adicionar entrada', fut: 'Adicionar', sd: 'Adicionar saída' };

function setEditMode(prefix, id) {
  editing[prefix] = id;
  document.getElementById(prefix + '-submit').textContent = id === null ? SUBMIT_LABELS[prefix] : 'Salvar alteração';
  document.getElementById(prefix + '-cancel').style.display = id === null ? 'none' : '';
}

function startEdit(prefix, item) {
  document.getElementById(prefix + '-desc').value  = item.desc;
  document.getElementById(prefix + '-tipo').value  = item.tipo;
  document.getElementById(prefix + '-valor').value = item.valor.toFixed(2).replace('.', ',');
  if (prefix === 'fut') document.getElementById('fut-mes').value = item.mesAno;
  else document.getElementById(prefix + '-data').value = item.data;
  document.getElementById(prefix + '-error').style.display = 'none';
  setEditMode(prefix, item.id);
  const descEl = document.getElementById(prefix + '-desc');
  descEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  descEl.focus({ preventScroll: true });
}

// Limpa o formulário e sai do modo de edição (também usado após salvar).
function cancelEdit(prefix) {
  document.getElementById(prefix + '-desc').value  = '';
  document.getElementById(prefix + '-valor').value = '';
  if (prefix !== 'fut') document.getElementById(prefix + '-data').value = todayISO();
  document.getElementById(prefix + '-error').style.display = 'none';
  setEditMode(prefix, null);
}

function editBtn(fn, id) {
  return `<button class="btn-delete btn-edit" onclick="${fn}(${id})" title="Editar">✎</button>`;
}

// ---------- ENTRADAS ----------

function editEntrada(id) {
  const e = entradas.find(x => x.id === id);
  if (e) startEdit('en', e);
}

function addEntrada() {
  const desc  = (document.getElementById('en-desc').value || '').trim();
  const tipo  = document.getElementById('en-tipo').value;
  const valor = parseCurrencyInput(document.getElementById('en-valor').value);
  const data  = document.getElementById('en-data').value || todayISO();
  const errEl = document.getElementById('en-error');

  if (!desc)      { showEnError('Informe uma descrição.'); return; }
  if (valor <= 0) { showEnError('Informe um valor maior que zero.'); return; }
  errEl.style.display = 'none';

  const editId = editing.en;
  if (editId !== null) Object.assign(entradas.find(e => e.id === editId) || {}, { desc, tipo, valor, data });
  else entradas.push({ id: Date.now(), desc, tipo, valor, data });
  saveAll();
  updateEnMetrics();
  renderEntradas();
  renderEnMensal();
  updateSaidaMetrics();

  cancelEdit('en');
  document.getElementById('en-desc').focus();
  showToast(editId !== null ? 'Entrada atualizada ✓' : 'Entrada adicionada ✓', 'ok', 2000);
}

function showEnError(msg) {
  const el = document.getElementById('en-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function deleteEntrada(id) {
  if (!confirm('Excluir esta entrada?')) return;
  entradas = entradas.filter(e => e.id !== id);
  if (editing.en === id) cancelEdit('en');
  saveAll();
  updateEnMetrics();
  renderEntradas();
  renderEnMensal();
  updateSaidaMetrics();
}

// ---------- REPETIR ENTRADAS ----------
// Copia entradas selecionadas de um mês para outro (ex: salário e vales que se
// repetem todo mês). Mantém o mesmo dia — ajustado para o último dia do mês
// de destino quando ele for mais curto (ex: 31/01 → 28/02).

function shiftMes(mesAno, delta) {
  const [y, m] = mesAno.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function repData(dataOrig, mesDestino) {
  const [y, m] = mesDestino.split('-').map(Number);
  const ultimoDia = new Date(y, m, 0).getDate();
  const dia = Math.min(parseInt(dataOrig.slice(8, 10)), ultimoDia);
  return `${mesDestino}-${String(dia).padStart(2, '0')}`;
}

function openRepetir() {
  const to = todayISO().slice(0, 7);
  document.getElementById('rep-to').value   = to;
  document.getElementById('rep-from').value = shiftMes(to, -1);
  const card = document.getElementById('rep-card');
  card.style.display = '';
  renderRepetir();
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeRepetir() {
  document.getElementById('rep-card').style.display = 'none';
}

// Ao trocar o mês de destino, sugere o mês anterior a ele como origem.
function repToChanged() {
  const to = document.getElementById('rep-to').value;
  if (to) document.getElementById('rep-from').value = shiftMes(to, -1);
  renderRepetir();
}

function renderRepetir() {
  const from = document.getElementById('rep-from').value;
  const to   = document.getElementById('rep-to').value;
  const body = document.getElementById('rep-body');

  const list = from
    ? entradas.filter(e => e.data.slice(0,7) === from).sort((a,b) => a.data.localeCompare(b.data))
    : [];

  if (!list.length) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty-state">
      <div class="empty-title">Nenhuma entrada em ${from ? mesAnoLabel(from) : 'mês não selecionado'}</div>
      <div class="empty-sub">Escolha outro mês em "Copiar de"</div>
    </div></td></tr>`;
    updateRepCount();
    return;
  }

  // Entradas com mesma descrição e tipo já lançadas no destino vêm desmarcadas,
  // para não duplicar sem querer.
  const noDestino = new Set(entradas
    .filter(e => e.data.slice(0,7) === to)
    .map(e => e.tipo + '|' + e.desc.toLowerCase()));

  body.innerHTML = list.map(e => {
    const existe = noDestino.has(e.tipo + '|' + e.desc.toLowerCase());
    return `
    <tr data-id="${e.id}" class="${existe ? 'rep-off' : ''}">
      <td><input type="checkbox" ${existe ? '' : 'checked'} onchange="repRowToggle(this)"></td>
      <td style="white-space:nowrap;color:var(--muted);font-size:12px">${to ? isoToBR(repData(e.data, to)) : '—'}</td>
      <td>${e.desc}${existe ? '<span class="rep-tag">já existe no mês</span>' : ''}</td>
      <td><span class="badge b-tipo-${e.tipo}">${TIPO_LABELS[e.tipo]||e.tipo}</span></td>
      <td><input type="text" class="pill" value="${e.valor.toFixed(2).replace('.', ',')}" oninput="maskCurrency(this)"></td>
    </tr>`;
  }).join('');
  updateRepCount();
}

function repRowToggle(cb) {
  cb.closest('tr').classList.toggle('rep-off', !cb.checked);
  updateRepCount();
}

function repToggleAll(on) {
  document.querySelectorAll('#rep-body tr[data-id]').forEach(tr => {
    tr.querySelector('input[type="checkbox"]').checked = on;
    tr.classList.toggle('rep-off', !on);
  });
  updateRepCount();
}

function updateRepCount() {
  const from  = document.getElementById('rep-from').value;
  const to    = document.getElementById('rep-to').value;
  const boxes = document.querySelectorAll('#rep-body tr[data-id] input[type="checkbox"]');
  const n     = [...boxes].filter(b => b.checked).length;
  const btn   = document.getElementById('rep-confirm');
  btn.textContent = `Repetir selecionadas (${n})`;
  btn.disabled    = !n || !to || from === to;
  document.getElementById('rep-all').checked = boxes.length > 0 && n === boxes.length;
}

function confirmRepetir() {
  const to = document.getElementById('rep-to').value;
  if (!to) return;
  const base = Date.now();
  let added = 0;

  document.querySelectorAll('#rep-body tr[data-id]').forEach(tr => {
    if (!tr.querySelector('input[type="checkbox"]').checked) return;
    const orig  = entradas.find(e => e.id === Number(tr.dataset.id));
    const valor = parseCurrencyInput(tr.querySelector('input[type="text"]').value);
    if (!orig || valor <= 0) return;
    entradas.push({ id: base + added, desc: orig.desc, tipo: orig.tipo, valor, data: repData(orig.data, to) });
    added++;
  });

  if (!added) { showToast('Nenhuma entrada com valor válido selecionada', 'warn', 3000); return; }

  saveAll();
  updateEnMetrics();
  renderEntradas();
  renderEnMensal();
  updateSaidaMetrics();
  closeRepetir();
  showToast(`${added} ${added === 1 ? 'entrada copiada' : 'entradas copiadas'} para ${mesAnoLabel(to)} ✓`, 'ok', 2500);
}

// Saldo geral = total de entradas − total da fatura do cartão (débitos − créditos) − total de saídas.
// Usado tanto na aba Entradas quanto na aba Saídas para manter os dois números sempre coerentes.
function calcSaldoGeral(mesFiltro) {
  const totalEntradas = (mesFiltro ? entradas.filter(e => e.data.slice(0,7) === mesFiltro) : entradas)
    .reduce((s,e) => s+e.valor, 0);
  const debitos  = allTx.filter(t => t.tipo==='debito').reduce((s,t) => s+Math.abs(t.valor), 0);
  const creditos = allTx.filter(t => t.tipo==='credito').reduce((s,t) => s+Math.abs(t.valor), 0);
  const totalSaidas = (mesFiltro ? saidas.filter(s => s.data.slice(0,7) === mesFiltro) : saidas)
    .reduce((s,x) => s+x.valor, 0);
  return totalEntradas - (debitos - creditos) - totalSaidas;
}

function updateEnMetrics() {
  const mesFiltro = (document.getElementById('en-filter-mes') || {}).value || '';
  const base = mesFiltro ? entradas.filter(e => e.data.slice(0,7) === mesFiltro) : entradas;

  const total   = base.reduce((s,e) => s+e.valor, 0);
  const salario = base.filter(e => e.tipo==='salario').reduce((s,e) => s+e.valor, 0);
  const vale    = base.filter(e => ['vale_alimentacao','vale_refeicao'].includes(e.tipo)).reduce((s,e) => s+e.valor, 0);
  const outros  = base.filter(e => !['salario','vale_alimentacao','vale_refeicao'].includes(e.tipo)).reduce((s,e) => s+e.valor, 0);

  document.getElementById('en-total').textContent   = fmtVal(total);
  document.getElementById('en-salario').textContent = fmtVal(salario);
  document.getElementById('en-vale').textContent    = fmtVal(vale);
  document.getElementById('en-outros').textContent  = fmtVal(outros);

  const saldoEl = document.getElementById('en-saldo');
  const saldo   = calcSaldoGeral(mesFiltro);
  saldoEl.textContent = fmtVal(saldo);
  saldoEl.className   = 'metric-value ' + (saldo >= 0 ? 'green' : 'red');
}

function renderEnMensal() {
  const el = document.getElementById('en-mensal-body');
  if (!el) return;

  const map = {};
  entradas.forEach(e => {
    const k = e.data.slice(0,7);
    if (!map[k]) map[k] = { mesAno: k, total: 0, salario: 0, vale: 0, outros: 0 };
    map[k].total += e.valor;
    if (e.tipo === 'salario') map[k].salario += e.valor;
    else if (['vale_alimentacao','vale_refeicao'].includes(e.tipo)) map[k].vale += e.valor;
    else map[k].outros += e.valor;
  });

  const rows = Object.values(map).sort((a,b) => b.mesAno.localeCompare(a.mesAno));

  el.innerHTML = !rows.length
    ? `<tr><td colspan="5" style="text-align:center;padding:1.25rem;color:var(--muted);font-size:13px">Nenhuma entrada cadastrada</td></tr>`
    : rows.map(r => `
      <tr style="cursor:pointer" onclick="filterEnByMes('${r.mesAno}')" title="Filtrar por ${mesAnoLabel(r.mesAno)}">
        <td style="font-weight:500">${mesAnoLabel(r.mesAno)}</td>
        <td style="color:var(--green);font-weight:500">${fmtVal(r.total)}</td>
        <td style="color:var(--muted)">${fmtVal(r.salario)}</td>
        <td style="color:var(--muted)">${fmtVal(r.vale)}</td>
        <td style="color:var(--muted)">${fmtVal(r.outros)}</td>
      </tr>`).join('');

  updateEnMesFilter(rows.map(r => r.mesAno));
}

function filterEnByMes(mesAno) {
  const sel = document.getElementById('en-filter-mes');
  if (!sel) return;
  sel.value = sel.value === mesAno ? '' : mesAno;
  updateEnMetrics();
  renderEntradas();
}

function updateEnMesFilter(meses) {
  const sel = document.getElementById('en-filter-mes');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">Todos os meses</option>' +
    meses.map(m => `<option value="${m}">${mesAnoLabel(m)}</option>`).join('');
  if (current && meses.includes(current)) sel.value = current;
}

function sortEnBy(col) {
  if (entSort.col === col) {
    entSort.dir = cycleDir(entSort.dir);
    if (entSort.dir === null) entSort.col = null;
  } else { entSort.col = col; entSort.dir = 'asc'; }
  renderEntradas();
}

function enGetter(e, col) {
  if (col === 'data')  return e.data;
  if (col === 'desc')  return e.desc.toLowerCase();
  if (col === 'tipo')  return e.tipo;
  if (col === 'valor') return e.valor;
  return '';
}

function thEn(col, label) {
  const active = entSort.col === col;
  const icon   = !active ? '↕' : entSort.dir === 'asc' ? '↑' : '↓';
  return `<th style="cursor:pointer;user-select:none;${active?'color:var(--accent-text);':''}" onclick="sortEnBy('${col}')">${label} <span style="font-size:10px;opacity:${active?1:0.4}">${icon}</span></th>`;
}

function renderEntradas() {
  const q    = (document.getElementById('en-search').value || '').toLowerCase();
  const tipo = document.getElementById('en-filter-tipo').value;
  const mes  = (document.getElementById('en-filter-mes') || {}).value || '';

  let list = entradas.filter(e => {
    if (q    && !e.desc.toLowerCase().includes(q)) return false;
    if (tipo && e.tipo !== tipo)                   return false;
    if (mes  && e.data.slice(0,7) !== mes)         return false;
    return true;
  });

  list = entSort.col && entSort.dir
    ? sortData(list, entSort.col, entSort.dir, enGetter)
    : [...list].sort((a,b) => b.data.localeCompare(a.data));

  document.getElementById('en-head').innerHTML =
    thEn('data','Data') + thEn('desc','Descrição') + thEn('tipo','Tipo') +
    thEn('valor','Valor') + '<th style="width:80px"></th>';

  const body = document.getElementById('en-body');
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty-state">
      <div class="empty-icon">${entradas.length?'🔍':'💰'}</div>
      <div class="empty-title">${entradas.length?'Nenhum resultado':'Nenhuma entrada cadastrada'}</div>
      <div class="empty-sub">${entradas.length?'Tente outros filtros':'Use o formulário acima para adicionar recebimentos'}</div>
    </div></td></tr>`;
    return;
  }

  body.innerHTML = list.map(e => `
    <tr>
      <td style="white-space:nowrap;color:var(--muted);font-size:12px">${isoToBR(e.data)}</td>
      <td>${e.desc}</td>
      <td><span class="badge b-tipo-${e.tipo}">${TIPO_LABELS[e.tipo]||e.tipo}</span></td>
      <td style="font-weight:500;color:var(--green);white-space:nowrap">${fmtVal(e.valor)}</td>
      <td style="text-align:center;white-space:nowrap">
        ${editBtn('editEntrada', e.id)}
        <button class="btn-delete" onclick="deleteEntrada(${e.id})" title="Excluir">✕</button>
      </td>
    </tr>`).join('');
}

function exportEntradasJSON() {
  if (!entradas.length) { showToast('Nenhuma entrada para exportar','warn',3000); return; }
  const blob = new Blob([JSON.stringify(entradas, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'entradas_sicredi.json';
  a.click();
}

function importEntradasClick() {
  document.getElementById('en-import-file').click();
}

function importEntradasJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const rd = new FileReader();
  rd.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) { showToast('JSON inválido — esperado um array','warn',4000); return; }
      const existing = new Set(entradas.map(x => x.id));
      let added = 0;
      data.forEach(item => {
        if (item.id && item.desc && item.tipo && item.valor) {
          if (!existing.has(item.id)) { entradas.push(item); added++; }
        }
      });
      saveAll();
      updateEnMetrics();
      renderEntradas();
      renderEnMensal();
      updateSaidaMetrics();
      showToast(`${added} entrada(s) importada(s) ✓`, 'ok', 3000);
    } catch (_) {
      showToast('Erro ao ler o arquivo JSON', 'warn', 4000);
    }
  };
  rd.readAsText(file);
  event.target.value = '';
}

// ---------- ENTRADAS FUTURAS ----------
// Mesma lógica da aba Entradas, porém por mês (sem dia específico) — usada
// para planejar recebimentos que ainda vão acontecer (ex: R$ 300 em Novembro).

function addEntradaFutura() {
  const desc  = (document.getElementById('fut-desc').value || '').trim();
  const tipo  = document.getElementById('fut-tipo').value;
  const valor = parseCurrencyInput(document.getElementById('fut-valor').value);
  const mes   = document.getElementById('fut-mes').value || todayISO().slice(0, 7);

  if (!desc)      { showFutError('Informe uma descrição.'); return; }
  if (valor <= 0) { showFutError('Informe um valor maior que zero.'); return; }
  document.getElementById('fut-error').style.display = 'none';

  const editId = editing.fut;
  if (editId !== null) Object.assign(entradasFuturas.find(e => e.id === editId) || {}, { desc, tipo, valor, mesAno: mes });
  else entradasFuturas.push({ id: Date.now(), desc, tipo, valor, mesAno: mes });
  saveAll();
  renderEntradasFuturas();

  cancelEdit('fut');
  document.getElementById('fut-desc').focus();
  showToast(editId !== null ? 'Entrada futura atualizada ✓' : 'Entrada futura adicionada ✓', 'ok', 2000);
}

function editEntradaFutura(id) {
  const e = entradasFuturas.find(x => x.id === id);
  if (e) startEdit('fut', e);
}

function showFutError(msg) {
  const el = document.getElementById('fut-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function deleteEntradaFutura(id) {
  if (!confirm('Excluir esta entrada futura?')) return;
  entradasFuturas = entradasFuturas.filter(e => e.id !== id);
  if (editing.fut === id) cancelEdit('fut');
  saveAll();
  renderEntradasFuturas();
}

function updateFutMetrics() {
  const mesFiltro = (document.getElementById('fut-filter-mes') || {}).value || '';
  const base = mesFiltro ? entradasFuturas.filter(e => e.mesAno === mesFiltro) : entradasFuturas;

  const total   = base.reduce((s,e) => s+e.valor, 0);
  const salario = base.filter(e => e.tipo==='salario').reduce((s,e) => s+e.valor, 0);
  const vale    = base.filter(e => ['vale_alimentacao','vale_refeicao'].includes(e.tipo)).reduce((s,e) => s+e.valor, 0);
  const outros  = base.filter(e => !['salario','vale_alimentacao','vale_refeicao'].includes(e.tipo)).reduce((s,e) => s+e.valor, 0);

  document.getElementById('fut-total').textContent   = fmtVal(total);
  document.getElementById('fut-salario').textContent = fmtVal(salario);
  document.getElementById('fut-vale').textContent    = fmtVal(vale);
  document.getElementById('fut-outros').textContent  = fmtVal(outros);
}

function updateFutMesFilter(meses) {
  const sel = document.getElementById('fut-filter-mes');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">Todos os meses</option>' +
    meses.map(m => `<option value="${m}">${mesAnoLabel(m)}</option>`).join('');
  if (current && meses.includes(current)) sel.value = current;
}

function sortFutBy(col) {
  if (futSort.col === col) {
    futSort.dir = cycleDir(futSort.dir);
    if (futSort.dir === null) futSort.col = null;
  } else { futSort.col = col; futSort.dir = 'asc'; }
  renderEntradasFuturas();
}

function futGetter(e, col) {
  if (col === 'mes')   return e.mesAno;
  if (col === 'desc')  return e.desc.toLowerCase();
  if (col === 'tipo')  return e.tipo;
  if (col === 'valor') return e.valor;
  return '';
}

function thFut(col, label) {
  const active = futSort.col === col;
  const icon   = !active ? '↕' : futSort.dir === 'asc' ? '↑' : '↓';
  return `<th style="cursor:pointer;user-select:none;${active?'color:var(--accent-text);':''}" onclick="sortFutBy('${col}')">${label} <span style="font-size:10px;opacity:${active?1:0.4}">${icon}</span></th>`;
}

function renderEntradasFuturas() {
  const searchEl = document.getElementById('fut-search');
  const tipoEl   = document.getElementById('fut-filter-tipo');
  const mesEl    = document.getElementById('fut-filter-mes');
  if (!searchEl || !tipoEl) return; // tab ainda não renderizada no DOM

  const q    = (searchEl.value || '').toLowerCase();
  const tipo = tipoEl.value;
  const mes  = (mesEl || {}).value || '';

  let list = entradasFuturas.filter(e => {
    if (q    && !e.desc.toLowerCase().includes(q)) return false;
    if (tipo && e.tipo !== tipo)                   return false;
    if (mes  && e.mesAno !== mes)                  return false;
    return true;
  });

  list = futSort.col && futSort.dir
    ? sortData(list, futSort.col, futSort.dir, futGetter)
    : [...list].sort((a,b) => a.mesAno.localeCompare(b.mesAno));

  document.getElementById('fut-head').innerHTML =
    thFut('mes','Mês') + thFut('desc','Descrição') + thFut('tipo','Tipo') +
    thFut('valor','Valor') + '<th style="width:80px"></th>';

  const body = document.getElementById('fut-body');
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty-state">
      <div class="empty-icon">${entradasFuturas.length?'🔍':'🗓️'}</div>
      <div class="empty-title">${entradasFuturas.length?'Nenhum resultado':'Nenhuma entrada futura cadastrada'}</div>
      <div class="empty-sub">${entradasFuturas.length?'Tente outros filtros':'Use o formulário acima para planejar recebimentos futuros'}</div>
    </div></td></tr>`;
  } else {
    body.innerHTML = list.map(e => `
      <tr>
        <td style="white-space:nowrap;color:var(--muted);font-size:12px">${mesAnoLabel(e.mesAno)}</td>
        <td>${e.desc}</td>
        <td><span class="badge b-tipo-${e.tipo}">${TIPO_LABELS[e.tipo]||e.tipo}</span></td>
        <td style="font-weight:500;color:var(--green);white-space:nowrap">${fmtVal(e.valor)}</td>
        <td style="text-align:center;white-space:nowrap">
          ${editBtn('editEntradaFutura', e.id)}
          <button class="btn-delete" onclick="deleteEntradaFutura(${e.id})" title="Excluir">✕</button>
        </td>
      </tr>`).join('');
  }

  updateFutMetrics();
  updateFutMesFilter([...new Set(entradasFuturas.map(e => e.mesAno))].sort());
}

function exportFuturasJSON() {
  if (!entradasFuturas.length) { showToast('Nenhuma entrada futura para exportar','warn',3000); return; }
  const blob = new Blob([JSON.stringify(entradasFuturas, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'entradas_futuras_sicredi.json';
  a.click();
}

function importFuturasClick() {
  document.getElementById('fut-import-file').click();
}

function importFuturasJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const rd = new FileReader();
  rd.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) { showToast('JSON inválido — esperado um array','warn',4000); return; }
      const existing = new Set(entradasFuturas.map(x => x.id));
      let added = 0;
      data.forEach(item => {
        if (item.id && item.desc && item.tipo && item.valor && item.mesAno) {
          if (!existing.has(item.id)) { entradasFuturas.push(item); added++; }
        }
      });
      saveAll();
      renderEntradasFuturas();
      showToast(`${added} entrada(s) futura(s) importada(s) ✓`, 'ok', 3000);
    } catch (_) {
      showToast('Erro ao ler o arquivo JSON', 'warn', 4000);
    }
  };
  rd.readAsText(file);
  event.target.value = '';
}

// ---------- SAÍDAS ----------
// Despesas pagas fora do cartão (Pix, dinheiro, débito). Entram no saldo geral
// junto com as entradas e a fatura do cartão (ver calcSaldoGeral, na seção de métricas).

function addSaida() {
  const desc  = (document.getElementById('sd-desc').value || '').trim();
  const tipo  = document.getElementById('sd-tipo').value;
  const valor = parseCurrencyInput(document.getElementById('sd-valor').value);
  const data  = document.getElementById('sd-data').value || todayISO();

  if (!desc)      { showSdError('Informe uma descrição.'); return; }
  if (valor <= 0) { showSdError('Informe um valor maior que zero.'); return; }
  document.getElementById('sd-error').style.display = 'none';

  const editId = editing.sd;
  if (editId !== null) Object.assign(saidas.find(s => s.id === editId) || {}, { desc, tipo, valor, data });
  else saidas.push({ id: Date.now(), desc, tipo, valor, data });
  saveAll();
  updateSaidaMetrics();
  renderSaidas();
  renderSdMensal();
  updateEnMetrics(); // saldo da aba Entradas também depende das saídas

  cancelEdit('sd');
  document.getElementById('sd-desc').focus();
  showToast(editId !== null ? 'Saída atualizada ✓' : 'Saída adicionada ✓', 'ok', 2000);
}

function editSaida(id) {
  const s = saidas.find(x => x.id === id);
  if (s) startEdit('sd', s);
}

function showSdError(msg) {
  const el = document.getElementById('sd-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function deleteSaida(id) {
  if (!confirm('Excluir esta saída?')) return;
  saidas = saidas.filter(s => s.id !== id);
  if (editing.sd === id) cancelEdit('sd');
  saveAll();
  updateSaidaMetrics();
  renderSaidas();
  renderSdMensal();
  updateEnMetrics();
}

function updateSaidaMetrics() {
  const totalEl = document.getElementById('sd-total');
  if (!totalEl) return; // aba ainda não presente no DOM

  const mesFiltro = (document.getElementById('sd-filter-mes') || {}).value || '';
  const base = mesFiltro ? saidas.filter(s => s.data.slice(0,7) === mesFiltro) : saidas;

  const total     = base.reduce((s,x) => s+x.valor, 0);
  const fixas     = base.filter(x => SAIDA_FIXAS.includes(x.tipo)).reduce((s,x) => s+x.valor, 0);
  const variaveis = base.filter(x => SAIDA_VARIAVEIS.includes(x.tipo)).reduce((s,x) => s+x.valor, 0);
  const outros    = base.filter(x => !SAIDA_FIXAS.includes(x.tipo) && !SAIDA_VARIAVEIS.includes(x.tipo)).reduce((s,x) => s+x.valor, 0);

  totalEl.textContent                                 = fmtVal(total);
  document.getElementById('sd-fixas').textContent      = fmtVal(fixas);
  document.getElementById('sd-variaveis').textContent  = fmtVal(variaveis);
  document.getElementById('sd-outros').textContent     = fmtVal(outros);

  const saldoEl = document.getElementById('sd-saldo');
  const saldo   = calcSaldoGeral(mesFiltro);
  saldoEl.textContent = fmtVal(saldo);
  saldoEl.className   = 'metric-value ' + (saldo >= 0 ? 'green' : 'red');
}

function renderSdMensal() {
  const el = document.getElementById('sd-mensal-body');
  if (!el) return;

  const map = {};
  saidas.forEach(s => {
    const k = s.data.slice(0,7);
    if (!map[k]) map[k] = { mesAno: k, total: 0, fixas: 0, variaveis: 0, outros: 0 };
    map[k].total += s.valor;
    if (SAIDA_FIXAS.includes(s.tipo))          map[k].fixas += s.valor;
    else if (SAIDA_VARIAVEIS.includes(s.tipo)) map[k].variaveis += s.valor;
    else                                       map[k].outros += s.valor;
  });

  const rows = Object.values(map).sort((a,b) => b.mesAno.localeCompare(a.mesAno));

  el.innerHTML = !rows.length
    ? `<tr><td colspan="5" style="text-align:center;padding:1.25rem;color:var(--muted);font-size:13px">Nenhuma saída cadastrada</td></tr>`
    : rows.map(r => `
      <tr style="cursor:pointer" onclick="filterSdByMes('${r.mesAno}')" title="Filtrar por ${mesAnoLabel(r.mesAno)}">
        <td style="font-weight:500">${mesAnoLabel(r.mesAno)}</td>
        <td style="color:var(--red);font-weight:500">${fmtVal(r.total)}</td>
        <td style="color:var(--muted)">${fmtVal(r.fixas)}</td>
        <td style="color:var(--muted)">${fmtVal(r.variaveis)}</td>
        <td style="color:var(--muted)">${fmtVal(r.outros)}</td>
      </tr>`).join('');

  updateSdMesFilter(rows.map(r => r.mesAno));
}

function filterSdByMes(mesAno) {
  const sel = document.getElementById('sd-filter-mes');
  if (!sel) return;
  sel.value = sel.value === mesAno ? '' : mesAno;
  updateSaidaMetrics();
  renderSaidas();
}

function updateSdMesFilter(meses) {
  const sel = document.getElementById('sd-filter-mes');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">Todos os meses</option>' +
    meses.map(m => `<option value="${m}">${mesAnoLabel(m)}</option>`).join('');
  if (current && meses.includes(current)) sel.value = current;
}

function sortSdBy(col) {
  if (sdSort.col === col) {
    sdSort.dir = cycleDir(sdSort.dir);
    if (sdSort.dir === null) sdSort.col = null;
  } else { sdSort.col = col; sdSort.dir = 'asc'; }
  renderSaidas();
}

function sdGetter(s, col) {
  if (col === 'data')  return s.data;
  if (col === 'desc')  return s.desc.toLowerCase();
  if (col === 'tipo')  return s.tipo;
  if (col === 'valor') return s.valor;
  return '';
}

function thSd(col, label) {
  const active = sdSort.col === col;
  const icon   = !active ? '↕' : sdSort.dir === 'asc' ? '↑' : '↓';
  return `<th style="cursor:pointer;user-select:none;${active?'color:var(--accent-text);':''}" onclick="sortSdBy('${col}')">${label} <span style="font-size:10px;opacity:${active?1:0.4}">${icon}</span></th>`;
}

function renderSaidas() {
  const searchEl = document.getElementById('sd-search');
  const tipoEl   = document.getElementById('sd-filter-tipo');
  if (!searchEl || !tipoEl) return; // aba ainda não presente no DOM

  const q    = (searchEl.value || '').toLowerCase();
  const tipo = tipoEl.value;
  const mes  = (document.getElementById('sd-filter-mes') || {}).value || '';

  let list = saidas.filter(s => {
    if (q    && !s.desc.toLowerCase().includes(q)) return false;
    if (tipo && s.tipo !== tipo)                   return false;
    if (mes  && s.data.slice(0,7) !== mes)         return false;
    return true;
  });

  list = sdSort.col && sdSort.dir
    ? sortData(list, sdSort.col, sdSort.dir, sdGetter)
    : [...list].sort((a,b) => b.data.localeCompare(a.data));

  document.getElementById('sd-head').innerHTML =
    thSd('data','Data') + thSd('desc','Descrição') + thSd('tipo','Categoria') +
    thSd('valor','Valor') + '<th style="width:80px"></th>';

  const body = document.getElementById('sd-body');
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty-state">
      <div class="empty-icon">${saidas.length?'🔍':'💸'}</div>
      <div class="empty-title">${saidas.length?'Nenhum resultado':'Nenhuma saída cadastrada'}</div>
      <div class="empty-sub">${saidas.length?'Tente outros filtros':'Use o formulário acima para lançar despesas fora do cartão'}</div>
    </div></td></tr>`;
    return;
  }

  body.innerHTML = list.map(s => `
    <tr>
      <td style="white-space:nowrap;color:var(--muted);font-size:12px">${isoToBR(s.data)}</td>
      <td>${s.desc}</td>
      <td><span class="badge b-cat-${s.tipo}">${SAIDA_LABELS[s.tipo]||s.tipo}</span></td>
      <td style="font-weight:500;color:var(--red);white-space:nowrap">${fmtVal(s.valor)}</td>
      <td style="text-align:center;white-space:nowrap">
        ${editBtn('editSaida', s.id)}
        <button class="btn-delete" onclick="deleteSaida(${s.id})" title="Excluir">✕</button>
      </td>
    </tr>`).join('');
}

function exportSaidasJSON() {
  if (!saidas.length) { showToast('Nenhuma saída para exportar','warn',3000); return; }
  const blob = new Blob([JSON.stringify(saidas, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'saidas_sicredi.json';
  a.click();
}

function importSaidasClick() {
  document.getElementById('sd-import-file').click();
}

function importSaidasJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const rd = new FileReader();
  rd.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) { showToast('JSON inválido — esperado um array','warn',4000); return; }
      const existing = new Set(saidas.map(x => x.id));
      let added = 0;
      data.forEach(item => {
        if (item.id && item.desc && item.tipo && item.valor && item.data) {
          if (!existing.has(item.id)) { saidas.push(item); added++; }
        }
      });
      saveAll();
      updateSaidaMetrics();
      renderSaidas();
      renderSdMensal();
      updateEnMetrics();
      showToast(`${added} saída(s) importada(s) ✓`, 'ok', 3000);
    } catch (_) {
      showToast('Erro ao ler o arquivo JSON', 'warn', 4000);
    }
  };
  rd.readAsText(file);
  event.target.value = '';
}

// ---------- INIT ----------

loadAll(); // carrega dados do localStorage e depois renderiza
