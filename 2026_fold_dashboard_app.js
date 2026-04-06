/* ── Fold slice data (CVI ratio; no fold weighting) ── */
var activeFoldSlice = '1';
function applyFoldSliceGlobals() {
  var slice = FOLD_SLICE_DATA[activeFoldSlice];
  if (!slice) return;
  PERIODS = slice.PERIODS;
  PERIOD_LABELS = slice.PERIOD_LABELS;
  TS_DAILY = slice.TS_DAILY;
  TS_DAILY_BU = slice.TS_DAILY_BU;
}
applyFoldSliceGlobals();

function syncDrToSliceAllPeriod() {
  var f = document.getElementById('dr-from'), t = document.getElementById('dr-to');
  allDateMin = PERIODS['all'].overall.date_min;
  allDateMax = PERIODS['all'].overall.date_max;
  if (f && t) {
    f.min = allDateMin; f.max = allDateMax; t.min = allDateMin; t.max = allDateMax;
    f.value = allDateMin; t.value = allDateMax;
  }
  activePeriod = 'all';
  var note = document.getElementById('dr-note');
  if (note) note.textContent = 'Showing: ' + (PERIOD_LABELS[activePeriod] || '');
}

function bindFoldSliceSelect() {
  var sel = document.getElementById('fold-slice-select');
  if (!sel) return;
  sel.value = activeFoldSlice;
  sel.addEventListener('change', function() {
    activeFoldSlice = sel.value || '1';
    applyFoldSliceGlobals();
    syncDrToSliceAllPeriod();
    _storeAisMap = null;
    _sfcLookupPid = null;
    _buFold1DeltaByBu = null;
    _buFold1RowByBu = null;
    sliPage = 0;
    renderAll();
    maybeRenderTimeSeries();
  });
}

function maybeRenderTimeSeries() {
  if (document.getElementById('tsOverallChart')) renderTimeSeries();
}

/* ── State ── */
var activePeriod = 'all';
function PD() { return PERIODS[activePeriod]; }

/* ── Utilities ── */
function fmt(n) { return n == null ? '–' : Number(n).toLocaleString('en-IN'); }
function pct(n) { return n == null ? '–' : Number(n).toFixed(2) + '%'; }
function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function sn(path) {
  return (STORE_NAMES && STORE_NAMES[path]) || path;
}
function bpsLabel(ads, org) {
  var v = ((ads - org) * 100).toFixed(0);
  var sign = v >= 0 ? '+' : '';
  var cls = v < 0 ? 'val-bad' : 'val-good';
  return '<span class="' + cls + '">' + sign + v + ' bps vs Organic</span>';
}

var BU_COLORS = { BGM:'#3b82f6', CoreElectronics:'#10b981', EmergingElectronics:'#f59e0b', Furniture:'#a78bfa', Home:'#f472b6', Large:'#22d3ee', Lifestyle:'#fb923c' };
var BU_LIST = ['BGM','CoreElectronics','EmergingElectronics','Furniture','Home','Large','Lifestyle'];
var BUCKET_COLORS = ['#ef4444','#f97316','#f59e0b','#84cc16','#10b981','#06b6d4','#8b5cf6','#ec4899','#a855f7','#e11d48'];

/* ── Date Range Logic ── */
var allDateMin = PERIODS['all'].overall.date_min;
var allDateMax = PERIODS['all'].overall.date_max;

(function initDateRange() {
  var f = document.getElementById('dr-from'), t = document.getElementById('dr-to');
  if (!f || !t) return;
  f.min = allDateMin; f.max = allDateMax; f.value = allDateMin;
  t.min = allDateMin; t.max = allDateMax; t.value = allDateMax;
  f.onchange = t.onchange = onDateRangeChange;
})();

function resetDateRange() {
  var f = document.getElementById('dr-from'), t = document.getElementById('dr-to');
  if (!f || !t) return;
  f.value = allDateMin;
  t.value = allDateMax;
  onDateRangeChange();
}

function onDateRangeChange() {
  var df = document.getElementById('dr-from'), dt = document.getElementById('dr-to');
  if (!df || !dt) return;
  var from = df.value;
  var to = dt.value;
  if (!from || !to || from > to) return;
  var months = {};
  ['01','02','03'].forEach(function(m) {
    var mStart = '2026-' + m + '-01';
    var mEnd = m === '01' ? '2026-01-31' : m === '02' ? '2026-02-28' : '2026-03-31';
    if (from <= mEnd && to >= mStart) months[m] = true;
  });
  var keys = Object.keys(months);
  if (keys.length === 3) { activePeriod = 'all'; }
  else if (keys.length === 1) { activePeriod = '2026-' + keys[0]; }
  else { activePeriod = 'all'; }

  var note = document.getElementById('dr-note');
  var plbl = PERIOD_LABELS[activePeriod] || '';
  if (note) {
    if (keys.length === 2) { note.textContent = 'Showing: Full Period data (covers 2 months)'; }
    else { note.textContent = 'Showing: ' + plbl; }
  }

  _storeAisMap = null;
  _sfcLookupPid = null;
  _buFold1DeltaByBu = null;
  _buFold1RowByBu = null;
  renderAll();
  maybeRenderTimeSeries();
}

/* ── Chart defaults ── */
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(71,85,105,0.3)';
Chart.defaults.font.family = 'Inter, sans-serif';

var r0ChartInstance = null, aisChartInstance = null;
var tsOverallChartInst = null;
var buSmCharts = [];
var currentGlobalBU = 'Overall';
var sliPage = 0;
var storeListSortCol = null, storeListSortDir = 1;
var buSortCol = null, buSortDir = 1;

/* ── Modal ── */
function closeCtModal() {
  document.getElementById('ct-modal-overlay').classList.remove('active');
  var ex = document.getElementById('ct-modal-extras');
  if (ex) ex.innerHTML = '';
  var m = document.querySelector('#ct-modal-overlay .ct-modal');
  if (m) m.classList.remove('ct-modal-wide');
  var mt = document.getElementById('ct-modal-table');
  if (mt) mt.classList.remove('f1bu-drill-table');
  window._gapDrillCtx = null;
}

/** Replace modal table body and clear Overall vs Fold 1 drill styling (re-add in showGapBucketStoresForBu when needed). */
function setCtModalTableHtml(html) {
  var t = document.getElementById('ct-modal-table');
  if (!t) return;
  t.classList.remove('f1bu-drill-table');
  t.innerHTML = html;
}

/* ── Render everything ── */
function renderAll() {
  if (document.getElementById('hdr-period')) renderHeader();
  if (document.getElementById('overall-metrics')) renderOverallMetrics();
  if (document.getElementById('bu-table')) renderBuTable();
  if (document.getElementById('r0Chart')) renderBucketCharts(currentGlobalBU);
  if (document.getElementById('crosstab-metric')) renderCrosstab();
  initSliFilters();
  renderBuFold1Table();
  renderStoreTables();
}

/* ── Header ── */
function renderHeader() {
  var o = PD().overall;
  var ep = document.getElementById('hdr-period'); if(ep) ep.textContent = o.date_min + ' to ' + o.date_max + ' (' + o.n_days + ' days)';
  var es = document.getElementById('hdr-stores'); if(es) es.textContent = fmt(o.stores);
}

/* ── Overall Metrics (matching 04_march: 6 cards, bps on ads) ── */
function renderOverallMetrics() {
  if (!document.getElementById('overall-metrics')) return;
  var o = PD().overall;
  var ctrBps = bpsLabel(o.ads_CTR, o.org_CTR);
  var cabnBps = bpsLabel(o.ads_CABN_clk, o.org_CABN_clk);
  var cards = [
    { label:'R0 Score', value:pct(o.R0), sub:'Fold-weighted relevance', hl:true },
    { label:'AIS', value:pct(o.AIS), sub:'Ad Impression Share', hl:true },
    { label:'Ads CTR', value:pct(o.ads_CTR), sub:ctrBps },
    { label:'Organic CTR', value:pct(o.org_CTR), sub:'Organic click-through rate' },
    { label:'Ads CABN/Click', value:pct(o.ads_CABN_clk), sub:cabnBps },
    { label:'Organic CABN/Click', value:pct(o.org_CABN_clk), sub:'Organic CABN per click' }
  ];
  var h=''; cards.forEach(function(c){
    h+='<div class="metric-card'+(c.hl?' highlight':'')+'"><div class="label">'+c.label+'</div><div class="value">'+c.value+'</div><div class="sub">'+c.sub+'</div></div>';
  });
  document.getElementById('overall-metrics').innerHTML=h;

  var oib = document.getElementById('overall-insight-box');
  if (oib) {
    var ctrG = ((o.org_CTR - o.ads_CTR)*100).toFixed(0);
    var cabnG = ((o.org_CABN_clk - o.ads_CABN_clk)*100).toFixed(0);
    oib.innerHTML =
      '<strong>Overall R0 is '+pct(o.R0)+'</strong> — fold-weighted relevance vs organic. <strong>AIS at '+pct(o.AIS)+'</strong> means ads account for that share of all impressions across search. '+
      'Organic CTR (<strong>'+pct(o.org_CTR)+'</strong>) vs ads CTR (<strong>'+pct(o.ads_CTR)+'</strong>) — gap <strong>'+ctrG+' bps</strong>. '+
      'CABN/click: ads <strong>'+pct(o.ads_CABN_clk)+'</strong> vs organic <strong>'+pct(o.org_CABN_clk)+'</strong> (gap <strong>'+cabnG+' bps</strong>).';
  }
}

/* ── BU Table with Overall row and sorting ── */
var buCols = [
  { key:'bu', label:'BU', align:'', fmt:function(r){ return r._isOverall ? '<strong>Overall</strong>' : '<span class="bu-badge" style="background:'+(BU_COLORS[r.bu]||'#64748b')+'22;color:'+(BU_COLORS[r.bu]||'#64748b')+'">'+r.bu+'</span>'; }},
  { key:'stores', label:'Stores', align:'text-right' },
  { key:'imprShare', label:'Impression Share', align:'text-right' },
  { key:'R0', label:'R0 %', align:'text-right' },
  { key:'AIS', label:'AIS %', align:'text-right' },
  { key:'ads_CTR', label:'Ads CTR %', align:'text-right' },
  { key:'org_CTR', label:'Org CTR %', align:'text-right' },
  { key:'ctrGap', label:'CTR Gap (bps)', align:'text-right' },
  { key:'ads_CABN_clk', label:'Ads CABN/Clk %', align:'text-right' },
  { key:'org_CABN_clk', label:'Org CABN/Clk %', align:'text-right' },
  { key:'cabnGap', label:'CABN Gap (bps)', align:'text-right' }
];

function buildBuRows() {
  var totalImp = PD().overall.all_impressions;
  var buRows = PD().bu_metrics.map(function(b){
    var r = Object.assign({}, b);
    r.ctrGap = (b.ads_CTR - b.org_CTR) * 100;
    r.cabnGap = (b.ads_CABN_clk - b.org_CABN_clk) * 100;
    r.imprShare = (b.all_impressions / totalImp) * 100;
    return r;
  });
  var o = PD().overall;
  var overall = {
    _isOverall: true, bu: '', stores: o.stores, R0: o.R0, AIS: o.AIS,
    ads_CTR: o.ads_CTR, org_CTR: o.org_CTR,
    ads_CABN_clk: o.ads_CABN_clk, org_CABN_clk: o.org_CABN_clk,
    all_impressions: o.all_impressions,
    ctrGap: (o.ads_CTR - o.org_CTR) * 100,
    cabnGap: (o.ads_CABN_clk - o.org_CABN_clk) * 100,
    imprShare: 100
  };
  return { overall: overall, rows: buRows };
}

function renderBuTable() {
  if (!document.getElementById('bu-table')) return;
  var data = buildBuRows();
  var rows = data.rows.slice();
  if (buSortCol !== null) {
    var key = buCols[buSortCol].key;
    rows.sort(function(a, b) {
      var va = key === 'bu' ? a.bu.toLowerCase() : a[key];
      var vb = key === 'bu' ? b.bu.toLowerCase() : b[key];
      if (va < vb) return -1 * buSortDir;
      if (va > vb) return 1 * buSortDir;
      return 0;
    });
  } else {
    rows.sort(function(a, b) { return b.all_impressions - a.all_impressions; });
  }

  var html = '<thead><tr>';
  buCols.forEach(function(col, ci) {
    var arrow = buSortCol === ci ? (buSortDir === 1 ? ' &#9650;' : ' &#9660;') : '';
    html += '<th class="bu-sort-th ' + col.align + '" data-ci="' + ci + '">' + col.label + arrow + '</th>';
  });
  html += '</tr></thead><tbody>';

  function renderRow(b) {
    var gc = b.ctrGap < -150 ? 'val-bad' : b.ctrGap < -50 ? 'val-warn' : 'val-good';
    var cc = b.cabnGap < -150 ? 'val-bad' : b.cabnGap < -50 ? 'val-warn' : 'val-good';
    var label = b._isOverall ? '<strong>Overall</strong>' : '<span class="bu-badge" style="background:' + (BU_COLORS[b.bu]||'#64748b') + '22;color:' + (BU_COLORS[b.bu]||'#64748b') + '">' + b.bu + '</span>';
    return '<tr' + (b._isOverall ? ' style="border-bottom:2px solid var(--border)"' : '') + '><td>' + label + '</td>' +
      '<td class="text-right">' + fmt(b.stores) + '</td><td class="text-right">' + Number(b.imprShare).toFixed(2) + '%</td>' +
      '<td class="text-right">' + pct(b.R0) + '</td><td class="text-right">' + pct(b.AIS) + '</td>' +
      '<td class="text-right">' + pct(b.ads_CTR) + '</td><td class="text-right">' + pct(b.org_CTR) + '</td>' +
      '<td class="text-right ' + gc + '">' + b.ctrGap.toFixed(0) + '</td>' +
      '<td class="text-right">' + pct(b.ads_CABN_clk) + '</td><td class="text-right">' + pct(b.org_CABN_clk) + '</td>' +
      '<td class="text-right ' + cc + '">' + b.cabnGap.toFixed(0) + '</td></tr>';
  }

  html += renderRow(data.overall);
  rows.forEach(function(b) { html += renderRow(b); });
  html += '</tbody>';
  document.getElementById('bu-table').innerHTML = html;

  document.querySelectorAll('#bu-table .bu-sort-th').forEach(function(th) {
    th.onclick = function() {
      var ci = parseInt(th.getAttribute('data-ci'));
      if (buSortCol === ci) { buSortDir *= -1; } else { buSortCol = ci; buSortDir = 1; }
      renderBuTable();
    };
  });

  var bestR0 = rows.slice().sort(function(a,b){return b.R0-a.R0;})[0];
  var worstR0 = rows.slice().sort(function(a,b){return a.R0-b.R0;})[0];
  var highestAIS = rows.slice().sort(function(a,b){return b.AIS-a.AIS;})[0];
  var biggestCtrGap = rows.slice().sort(function(a,b){return a.ctrGap-b.ctrGap;})[0];
  var biggestCabnGap = rows.slice().sort(function(a,b){return a.cabnGap-b.cabnGap;})[0];
  var msgs = [];
  if (bestR0) msgs.push('<strong>' + bestR0.bu + '</strong> leads R0 at <strong>' + pct(bestR0.R0) + '</strong> with ' + fmt(bestR0.stores) + ' stores and ' + Number(bestR0.imprShare).toFixed(1) + '% impression share.');
  if (worstR0 && worstR0.bu !== bestR0.bu) {
    msgs.push('<strong>' + worstR0.bu + '</strong> has the lowest R0 at <strong>' + pct(worstR0.R0) + '</strong>.');
    if (worstR0.R0 < 50) msgs.push('<span style="color:#ef4444">Action: ' + worstR0.bu + ' R0 is below 50% — prioritize relevance audits for top queries in this BU.</span>');
  }
  if (biggestCtrGap && biggestCtrGap.ctrGap < -100) msgs.push('<strong>' + biggestCtrGap.bu + '</strong> has the widest CTR gap (<strong>' + biggestCtrGap.ctrGap.toFixed(0) + ' bps</strong>) — ads CTR significantly lags organic, suggesting ranking or creative quality issues.');
  if (biggestCabnGap && biggestCabnGap.cabnGap < -100) msgs.push('<strong>' + biggestCabnGap.bu + '</strong> has the widest CABN gap (<strong>' + biggestCabnGap.cabnGap.toFixed(0) + ' bps</strong>) — ad clicks convert to cart-adds at a lower rate than organic.');
  if (highestAIS && highestAIS.AIS > 35) msgs.push('<strong>' + highestAIS.bu + '</strong> has the highest AIS at <strong>' + pct(highestAIS.AIS) + '</strong> — monitor if ad saturation is affecting user experience.');
  var bri = document.getElementById('bu-r0-insight');
  if (bri) bri.innerHTML = msgs.join(' ');
}

/* ── Bucket Distribution Charts ── */
function renderBucketCharts(buKey) {
  var bd = PD().BU_BUCKET_DATA[buKey];
  if (!bd) return;
  if (!document.getElementById('r0Chart') || !document.getElementById('aisChart')) return;
  if (r0ChartInstance) r0ChartInstance.destroy();
  if (aisChartInstance) aisChartInstance.destroy();

  r0ChartInstance = new Chart(document.getElementById('r0Chart').getContext('2d'), {
    type:'bar', plugins:[ChartDataLabels], data:{
      labels: bd.r0_dist.map(function(d){return d.bucket;}),
      datasets:[{
        label:'Store Count', data: bd.r0_dist.map(function(d){return d.stores;}),
        order:0, backgroundColor: BUCKET_COLORS.map(function(c){return c+'99';}), borderColor: BUCKET_COLORS,
        borderWidth:1, borderRadius:6, yAxisID:'y',
        datalabels:{anchor:'end',align:'end',color:'#e2e8f0',font:{weight:'bold',size:12},formatter:function(v){return v;}}
      },{
        label:'Impression Share', data: bd.r0_dist.map(function(d){return d.impr_pct;}),
        type:'line', order:1, borderColor:'#22d3ee', backgroundColor:'transparent',
        pointRadius:6, pointHoverRadius:8, pointBackgroundColor:'#22d3ee', pointBorderWidth:2, pointBorderColor:'#0f172a',
        borderWidth:3, yAxisID:'y1', tension:0.35, fill:false,
        datalabels:{display:false}
      }]
    }, options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:25}},
      onClick:function(evt,el){ if(!el.length||el[0].datasetIndex!==0) return; showBucketDrill('r0',bd.r0_dist[el[0].index].bucket,buKey); },
      plugins:{legend:{position:'bottom'},datalabels:{},tooltip:{callbacks:{label:function(ctx){if(ctx.dataset.yAxisID==='y1') return ctx.dataset.label+': '+Number(ctx.raw).toFixed(2)+'%'; return ctx.dataset.label+': '+ctx.raw;}}}},
      scales:{y:{beginAtZero:true,title:{display:true,text:'Store Count'},grid:{color:'rgba(71,85,105,0.2)'}},
        y1:{position:'right',beginAtZero:true,title:{display:true,text:'Impression Share'},grid:{drawOnChartArea:false},ticks:{callback:function(v){return Number(v).toFixed(2)+'%';}}},
        x:{grid:{display:false}}}
    }
  });

  aisChartInstance = new Chart(document.getElementById('aisChart').getContext('2d'), {
    type:'bar', plugins:[ChartDataLabels], data:{
      labels: bd.ais_dist.map(function(d){return d.bucket;}),
      datasets:[{
        label:'Store Count', data: bd.ais_dist.map(function(d){return d.stores;}),
        order:0, backgroundColor: BUCKET_COLORS.map(function(c){return c+'99';}), borderColor: BUCKET_COLORS,
        borderWidth:1, borderRadius:6, yAxisID:'y',
        datalabels:{anchor:'end',align:'end',color:'#e2e8f0',font:{weight:'bold',size:12},formatter:function(v){return v;}}
      },{
        label:'Impression Share', data: bd.ais_dist.map(function(d){return d.impr_pct;}),
        type:'line', order:1, borderColor:'#f472b6', backgroundColor:'transparent',
        pointRadius:6, pointHoverRadius:8, pointBackgroundColor:'#f472b6', pointBorderWidth:2, pointBorderColor:'#0f172a',
        borderWidth:3, yAxisID:'y1', tension:0.35, fill:false,
        datalabels:{display:false}
      }]
    }, options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:25}},
      onClick:function(evt,el){ if(!el.length||el[0].datasetIndex!==0) return; showBucketDrill('ais',bd.ais_dist[el[0].index].bucket,buKey); },
      plugins:{legend:{position:'bottom'},datalabels:{},tooltip:{callbacks:{label:function(ctx){if(ctx.dataset.yAxisID==='y1') return ctx.dataset.label+': '+Number(ctx.raw).toFixed(2)+'%'; return ctx.dataset.label+': '+ctx.raw;}}}},
      scales:{y:{beginAtZero:true,title:{display:true,text:'Store Count'},grid:{color:'rgba(71,85,105,0.2)'}},
        y1:{position:'right',beginAtZero:true,title:{display:true,text:'Impression Share'},grid:{drawOnChartArea:false},ticks:{callback:function(v){return Number(v).toFixed(2)+'%';}}},
        x:{grid:{display:false}}}
    }
  });

  var topR0 = bd.r0_dist.reduce(function(a,b){return b.impr_pct>a.impr_pct?b:a;});
  var topAIS = bd.ais_dist.reduce(function(a,b){return b.impr_pct>a.impr_pct?b:a;});
  var lowR0 = bd.r0_dist.filter(function(d){return d.bucket==='0–20%'||d.bucket==='20–30%'||d.bucket==='30–40%';});
  var lowR0Imp = lowR0.reduce(function(s,d){return s+d.impr_pct;},0);
  var lowR0Stores = lowR0.reduce(function(s,d){return s+d.stores;},0);
  var highAIS = bd.ais_dist.filter(function(d){return d.bucket.indexOf('40–45')>=0 || d.bucket.indexOf('>45')>=0;});
  var highAISImp = highAIS.reduce(function(s,d){return s+d.impr_pct;},0);
  var highAISStores = highAIS.reduce(function(s,d){return s+d.stores;},0);
  var px = buKey === 'Overall' ? '' : '<strong>' + buKey + '</strong>: ';
  var msgs = [];
  msgs.push(px + 'The <strong>' + topR0.bucket + ' R0 bucket</strong> holds the largest impression share at <strong>' + topR0.impr_pct.toFixed(2) + '%</strong> (' + topR0.stores + ' stores).');
  msgs.push('For AIS, the <strong>' + topAIS.bucket + '</strong> bucket dominates at <strong>' + topAIS.impr_pct.toFixed(2) + '%</strong> (' + topAIS.stores + ' stores).');
  if (lowR0Imp > 15) msgs.push('<span style="color:#ef4444">&#9888; Low-relevance stores (R0 &lt; 40%) account for <strong>' + lowR0Imp.toFixed(1) + '%</strong> of impressions (' + lowR0Stores + ' stores) — these need relevance improvement to protect user experience.</span>');
  if (highAISImp > 10) msgs.push('<span style="color:#f59e0b">&#9888; High-AIS stores (&gt;40%) hold <strong>' + highAISImp.toFixed(1) + '%</strong> of impressions (' + highAISStores + ' stores) — review ad load balancing for these stores.</span>');
  var bib = document.getElementById('bucket-insight-box');
  if (bib) bib.innerHTML = msgs.join(' ');
}

(function(){ var s=document.getElementById('global-bu-filter'); if(!s)return; BU_LIST.forEach(function(bu){var o=document.createElement('option');o.value=bu;o.textContent=bu;s.appendChild(o);}); s.onchange=function(){currentGlobalBU=this.value;renderBucketCharts(this.value);renderCrosstab();}; })();

/* ── Bucket drill-down (impression share for BU breakdown) ── */
function showBucketDrill(metric, bucket, buKey) {
  var field = metric === 'r0' ? 'rb' : 'ab';
  var stores = PD().ALL_STORES.filter(function(s){ return s[field] === bucket && (buKey === 'Overall' || s.b === buKey); });
  stores.sort(function(a,b){return b.ti - a.ti;});
  if (buKey === 'Overall') { showBuBreakdown(metric, bucket, stores); }
  else { showStoreModal(metric, bucket, buKey, stores); }
}

function showBuBreakdown(metric, bucket, stores) {
  var label = metric === 'r0' ? 'R0' : 'AIS';
  var globalImp = PD().overall.all_impressions;
  var buMap = {};
  stores.forEach(function(s){
    if (!buMap[s.b]) buMap[s.b] = {bu:s.b, count:0, imp:0};
    buMap[s.b].count++; buMap[s.b].imp += s.ti;
  });
  var rows = Object.values(buMap).sort(function(a,b){return b.imp - a.imp;});
  var maxShare = rows.length ? (rows[0].imp / globalImp * 100) : 1;
  var totalCnt = rows.reduce(function(s,r){return s + r.count;}, 0);

  document.getElementById('ct-modal-title').textContent = label + ' ' + bucket + ' — ' + totalCnt + ' Stores (click BU to see top 10)';
  document.getElementById('ct-modal-subtitle').textContent = 'Sorted by impression share. Click any BU row to drill into its top 10 stores.';

  var html = '<thead><tr><th>BU</th><th style="text-align:right">Stores</th><th style="text-align:right">Impression Share</th></tr></thead><tbody>';
  rows.forEach(function(r){
    var share = (r.imp / globalImp * 100);
    var barW = Math.round(share / maxShare * 100);
    var c = BU_COLORS[r.bu] || '#64748b';
    html += '<tr class="bu-click" onclick="showStoreModal(\'' + metric + '\',\'' + escapeHtml(bucket) + '\',\'' + r.bu + '\',null)" style="cursor:pointer">' +
      '<td><span class="bu-badge" style="background:' + c + '22;color:' + c + '">' + r.bu + '</span>' +
      '<div class="ct-bar" style="width:' + barW + '%;background:' + c + '"></div></td>' +
      '<td style="text-align:right">' + r.count + '</td>' +
      '<td style="text-align:right">' + share.toFixed(2) + '%</td></tr>';
  });
  html += '</tbody>';
  setCtModalTableHtml(html);
  document.getElementById('ct-modal-overlay').classList.add('active');
}

function showStoreModal(metric, bucket, bu, prefiltered) {
  var field = metric === 'r0' ? 'rb' : 'ab';
  var stores = prefiltered || PD().ALL_STORES.filter(function(s){ return s[field] === bucket && s.b === bu; });
  stores.sort(function(a,b){return b.ti - a.ti;});
  var top10 = stores.slice(0, 10);
  var label = metric === 'r0' ? 'R0' : 'AIS';
  var globalImp = PD().overall.all_impressions;

  document.getElementById('ct-modal-title').textContent = 'Top ' + Math.min(10, top10.length) + ' Stores — ' + bu;
  document.getElementById('ct-modal-subtitle').textContent = label + ' Bucket: ' + bucket + ' | ' + stores.length + ' stores, ' + fmt(stores.reduce(function(s,x){return s + x.ti;},0)) + ' impressions';

  // Compact table with BU Fold 1 vs Store Fold 1 comparison
  var html = '<thead><tr><th>#</th><th>Store</th><th>Store Name</th><th>BU F1 R0</th><th>Store F1 R0</th><th>Gap</th><th style="text-align:right">Impressions</th></tr></thead><tbody>';
  top10.forEach(function(s, i){
    var fc = getFoldCmpForStore(s);
    var br = getBuFold1CompareRow(s.b);
    var buR0 = br && br.r0_fold1 != null ? Number(br.r0_fold1).toFixed(2) + '%' : '–';
    var storeR0 = fc && fc.f1 && fc.f1.r0 != null ? Number(fc.f1.r0).toFixed(2) + '%' : '–';
    var gap = storeFold1R0MinusBuFold1R0Pp(s);
    var gapDisplay = gap != null ? (gap >= 0 ? '+' : '') + gap.toFixed(2) + ' pp' : '–';
    var gapClass = gap == null ? '' : gap >= 5 ? 'val-good' : gap <= -5 ? 'val-bad' : 'val-warn';
    
    html += '<tr><td>' + (i+1) + '</td><td style="font-family:monospace;font-size:12px">' + escapeHtml(s.s) + '</td><td>' + escapeHtml(sn(s.s)) + '</td><td>' + buR0 + '</td><td>' + storeR0 + '</td><td class="' + gapClass + '">' + gapDisplay + '</td><td style="text-align:right">' + fmt(s.ti) + '</td></tr>';
  });
  html += '</tbody>';
  setCtModalTableHtml(html);
  document.getElementById('ct-modal-overlay').classList.add('active');
}

/* ── Crosstab ── */
function renderCrosstab() {
  var cm = document.getElementById('crosstab-metric');
  if (!cm) return;
  var metric = cm.value;
  if (!document.getElementById('crosstab-table')) return;
  var isImp = metric === 'imp';
  var cct = document.getElementById('crosstab-chart-title');
  if (cct) cct.textContent = isImp ? 'Impression share %' : 'Store count';

  var ct;
  if (currentGlobalBU === 'Overall') { ct = PD().crosstab; }
  else {
    var stores = PD().ALL_STORES.filter(function(s){return s.b === currentGlobalBU;});
    var totalImp = stores.reduce(function(s,x){return s + x.ti;},0);
    ct = PD().ais_order.map(function(ab){
      var row = {ais_bucket:ab};
      PD().r0_order.forEach(function(rb){
        var m = stores.filter(function(s){return s.ab === ab && s.rb === rb;});
        row[rb + '_count'] = m.length;
        row[rb + '_imp_pct'] = totalImp ? Math.round(10000 * m.reduce(function(s,x){return s + x.ti;},0) / totalImp) / 100 : 0;
      });
      return row;
    });
  }

  var maxVal = 0;
  ct.forEach(function(row){ PD().r0_order.forEach(function(rb){ var v = isImp ? row[rb+'_imp_pct'] : row[rb+'_count']; if(v > maxVal) maxVal = v; }); });

  var r0Ord = PD().r0_order;
  var nCol = r0Ord.length;
  var colTotals = new Array(nCol);
  for (var ci = 0; ci < nCol; ci++) colTotals[ci] = 0;
  var rowTotals = [];
  ct.forEach(function(row){
    var rt = 0;
    r0Ord.forEach(function(rb, j){
      var v = isImp ? row[rb+'_imp_pct'] : row[rb+'_count'];
      rt += v;
      colTotals[j] += v;
    });
    rowTotals.push(rt);
  });

  var html = '<thead><tr><th>AIS \\ R0</th>';
  r0Ord.forEach(function(rb){ html += '<th>' + rb + '</th>'; });
  html += '<th class="heatmap-marginal">Total</th></tr></thead><tbody>';
  ct.forEach(function(row, ri){
    html += '<tr><th>' + row.ais_bucket + '</th>';
    r0Ord.forEach(function(rb){
      var v = isImp ? row[rb+'_imp_pct'] : row[rb+'_count'];
      html += '<td class="ct-clickable" style="background:' + heatColor(v,maxVal) + '" onclick="showCrossDrill(\'' + escapeHtml(row.ais_bucket) + '\',\'' + escapeHtml(rb) + '\')">' + (isImp ? v.toFixed(2)+'%' : v) + '</td>';
    });
    var rtot = rowTotals[ri];
    html += '<td class="heatmap-marginal">' + (isImp ? rtot.toFixed(2)+'%' : rtot) + '</td></tr>';
  });
  html += '<tr class="heatmap-total-row"><th class="heatmap-marginal">Total</th>';
  r0Ord.forEach(function(rb, j){
    var cv = colTotals[j];
    html += '<td class="heatmap-marginal">' + (isImp ? cv.toFixed(2)+'%' : cv) + '</td>';
  });
  var grand = rowTotals.reduce(function(a,b){ return a + b; }, 0);
  html += '<td class="heatmap-marginal">' + (isImp ? grand.toFixed(2)+'%' : grand) + '</td></tr>';
  html += '</tbody>';
  document.getElementById('crosstab-table').innerHTML = html;

  /* ── Cross-Tab Insight ── */
  var ctInsight = document.getElementById('crosstab-insight');
  if (ctInsight) {
    var r0Ord = PD().r0_order, aisOrd = PD().ais_order;
    var topCell = {ab:'',rb:'',v:0}, dangerImp = 0, dangerCnt = 0, idealImp = 0, idealCnt = 0;
    ct.forEach(function(row){
      r0Ord.forEach(function(rb){
        var imp = row[rb+'_imp_pct'] || 0, cnt = row[rb+'_count'] || 0;
        if (imp > topCell.v) { topCell = {ab:row.ais_bucket, rb:rb, v:imp, cnt:cnt}; }
        var rIdx = r0Ord.indexOf(rb), aIdx = aisOrd.indexOf(row.ais_bucket);
        if (rIdx <= 2 && aIdx >= aisOrd.length - 2) { dangerImp += imp; dangerCnt += cnt; }
        if (rIdx >= r0Ord.length - 2 && aIdx <= 2) { idealImp += imp; idealCnt += cnt; }
      });
    });
    var cMsgs = [];
    var buLabel = currentGlobalBU === 'Overall' ? '' : '<strong>' + currentGlobalBU + '</strong>: ';
    cMsgs.push(buLabel + 'Densest cell is <strong>AIS ' + topCell.ab + ' × R0 ' + topCell.rb + '</strong> with <strong>' + (isImp ? topCell.v.toFixed(2) + '% impression share' : topCell.cnt + ' stores') + '</strong>.');
    if (dangerImp > 3) cMsgs.push('<span style="color:#ef4444">&#9888; Low R0 + High AIS zone holds <strong>' + dangerImp.toFixed(1) + '% impressions</strong> (' + dangerCnt + ' stores) — ads are shown heavily but relevance is poor. Priority area for improvement.</span>');
    if (idealImp > 0) cMsgs.push('<span style="color:#10b981">&#10003; High R0 + Low AIS zone holds <strong>' + idealImp.toFixed(1) + '% impressions</strong> (' + idealCnt + ' stores) — good relevance with moderate ad density.</span>');
    ctInsight.innerHTML = cMsgs.join(' ');
  }
}

function heatColor(val,max){ var t = Math.min(val/(max||1),1); if(t<0.1) return 'rgba(30,41,59,0.8)'; var r=Math.round(59+t*196),g=Math.round(130-t*80),b=Math.round(246-t*100); return 'rgba('+r+','+g+','+b+','+(0.15+t*0.55)+')'; }

function showCrossDrill(ab,rb){
  var stores = PD().ALL_STORES.filter(function(s){ return s.ab===ab && s.rb===rb && (currentGlobalBU==='Overall' || s.b===currentGlobalBU); });
  stores.sort(function(a,b){return b.ti-a.ti;});
  var top = stores.slice(0,10);
  var globalImp = PD().overall.all_impressions;
  document.getElementById('ct-modal-title').textContent = 'AIS '+ab+' × R0 '+rb+' — '+stores.length+' stores';
  document.getElementById('ct-modal-subtitle').textContent = 'Top 10 by impressions';
  var html = '<thead><tr><th>#</th><th>Store</th><th>Store Name</th><th>BU</th><th>R0 %</th><th>AIS %</th><th style="text-align:right">Impressions</th><th style="text-align:right">Impr Share</th></tr></thead><tbody>';
  top.forEach(function(s,i){
    var c = s.r>=60?'val-good':s.r<40?'val-bad':'val-warn';
    var share = ((s.ti/globalImp)*100).toFixed(2);
    html += '<tr><td>'+(i+1)+'</td><td style="font-family:monospace;font-size:12px">'+escapeHtml(s.s)+'</td><td>'+escapeHtml(sn(s.s))+'</td><td><span class="bu-badge" style="background:'+(BU_COLORS[s.b]||'#64748b')+'22;color:'+(BU_COLORS[s.b]||'#64748b')+'">'+s.b+'</span></td><td class="'+c+'">'+s.r.toFixed(2)+'%</td><td>'+s.a.toFixed(2)+'%</td><td style="text-align:right">'+fmt(s.ti)+'</td><td style="text-align:right">'+share+'%</td></tr>';
  });
  html += '</tbody>';
  setCtModalTableHtml(html);
  document.getElementById('ct-modal-overlay').classList.add('active');
}

(function bindCrosstabMetric() {
  var el = document.getElementById('crosstab-metric');
  if (el) el.onchange = renderCrosstab;
})();

var SFC_GAP_BUCKETS = [
  'N/A',
  '\u2264 \u22128 pp',
  '\u22128 to \u22126 pp',
  '\u22126 to \u22124 pp',
  '\u22124 to \u22122 pp',
  '\u22122 to 0 pp',
  '0 to 2 pp',
  '2 to 4 pp',
  '4 to 6 pp',
  '6 to 8 pp',
  '8+ pp'
];
var GAP_BUCKETS_ORDER = {};
SFC_GAP_BUCKETS.forEach(function(b, i) { GAP_BUCKETS_ORDER[b] = i; });

/** Store vs BU (Fold 1) R0 gap buckets only: 5 pp bands, \u00b120+ tails. */
var SFC_GAP_BUCKETS_F1BU = [
  'N/A',
  '\u2264 \u221220 pp',
  '\u221220 to \u221215 pp',
  '\u221215 to \u221210 pp',
  '\u221210 to \u22125 pp',
  '\u22125 to 0 pp',
  '0 to 5 pp',
  '5 to 10 pp',
  '10 to 15 pp',
  '15 to 20 pp',
  '20+ pp'
];
var GAP_BUCKETS_ORDER_F1BU = {};
SFC_GAP_BUCKETS_F1BU.forEach(function(b, i) { GAP_BUCKETS_ORDER_F1BU[b] = i; });

function fold1MinusOverallPp(fc) {
  if (!fc || !fc.o || fc.o.r0 == null || !fc.f1 || fc.f1.r0 == null) return null;
  return Number(fc.f1.r0) - Number(fc.o.r0);
}

function gapBucketSignedStoreMinusBu(diff) {
  if (diff == null || isNaN(diff)) return 'N/A';
  if (diff < -8) return SFC_GAP_BUCKETS[1];
  if (diff < -6) return SFC_GAP_BUCKETS[2];
  if (diff < -4) return SFC_GAP_BUCKETS[3];
  if (diff < -2) return SFC_GAP_BUCKETS[4];
  if (diff < 0) return SFC_GAP_BUCKETS[5];
  if (diff < 2) return SFC_GAP_BUCKETS[6];
  if (diff < 4) return SFC_GAP_BUCKETS[7];
  if (diff < 6) return SFC_GAP_BUCKETS[8];
  if (diff < 8) return SFC_GAP_BUCKETS[9];
  return SFC_GAP_BUCKETS[10];
}

function gapBucketStoreMinusBu(buF1MinusO, storeF1MinusO) {
  if (buF1MinusO == null || isNaN(buF1MinusO) || storeF1MinusO == null || isNaN(storeF1MinusO)) return 'N/A';
  return gapBucketSignedStoreMinusBu(storeF1MinusO - buF1MinusO);
}

/** Store Fold 1 R0 (pp) minus same BU's Fold 1 R0 — used for F1-vs-BU gap buckets. */
function storeFold1R0MinusBuFold1R0Pp(st) {
  var fc = getFoldCmpForStore(st);
  var br = getBuFold1CompareRow(st.b);
  if (!fc || !fc.f1 || fc.f1.r0 == null || !br || br.r0_fold1 == null) return null;
  return Number(fc.f1.r0) - Number(br.r0_fold1);
}

function gapBucketSignedF1Bu(diff) {
  if (diff == null || isNaN(diff)) return SFC_GAP_BUCKETS_F1BU[0];
  if (diff <= -20) return SFC_GAP_BUCKETS_F1BU[1];
  if (diff <= -15) return SFC_GAP_BUCKETS_F1BU[2];
  if (diff <= -10) return SFC_GAP_BUCKETS_F1BU[3];
  if (diff <= -5) return SFC_GAP_BUCKETS_F1BU[4];
  if (diff <= 0) return SFC_GAP_BUCKETS_F1BU[5];
  if (diff <= 5) return SFC_GAP_BUCKETS_F1BU[6];
  if (diff <= 10) return SFC_GAP_BUCKETS_F1BU[7];
  if (diff <= 15) return SFC_GAP_BUCKETS_F1BU[8];
  if (diff <= 20) return SFC_GAP_BUCKETS_F1BU[9];
  return SFC_GAP_BUCKETS_F1BU[10];
}

function gapBucketCssClassF1Bu(label) {
  switch (label) {
    case SFC_GAP_BUCKETS_F1BU[0]: return 'sfc-gap-cell sfc-gap-na';
    case SFC_GAP_BUCKETS_F1BU[1]:
    case SFC_GAP_BUCKETS_F1BU[2]: return 'sfc-gap-cell sfc-gap-8p';
    case SFC_GAP_BUCKETS_F1BU[3]:
    case SFC_GAP_BUCKETS_F1BU[4]: return 'sfc-gap-cell sfc-gap-68';
    case SFC_GAP_BUCKETS_F1BU[5]:
    case SFC_GAP_BUCKETS_F1BU[6]: return 'sfc-gap-cell sfc-gap-46';
    case SFC_GAP_BUCKETS_F1BU[7]:
    case SFC_GAP_BUCKETS_F1BU[8]: return 'sfc-gap-cell sfc-gap-24';
    case SFC_GAP_BUCKETS_F1BU[9]:
    case SFC_GAP_BUCKETS_F1BU[10]: return 'sfc-gap-cell sfc-gap-02';
    default: return 'sfc-gap-cell';
  }
}

/** Fill rate buckets (Jan 25–31 window in STORE_FR_JAN25_31); sort order for table. */
var FR_BUCKET_ORDER_JAN = { 'N/A': 0, '0-20': 1, '20-40': 2, '40-50': 3, '50-60': 4, '60-70': 5, '70-80': 6, '80+': 7 };
var FR_BUCKET_FILTER_LIST = ['N/A', '0-20', '20-40', '40-50', '50-60', '60-70', '70-80', '80+'];

function normalizePageBrowseStoreId(s) {
  if (s == null) return '';
  s = String(s).trim();
  if (s.indexOf('./') === 0) s = s.slice(2);
  return s;
}

function getStoreFrJan2531(st) {
  if (typeof STORE_FR_JAN25_31 === 'undefined') return null;
  var k = normalizePageBrowseStoreId(st.s);
  var o = STORE_FR_JAN25_31[k];
  return o || null;
}

function frBucketCssClass(label) {
  switch (label) {
    case 'N/A': return 'fr-bucket-cell fr-bkt-na';
    case '0-20':
    case '20-40': return 'fr-bucket-cell fr-bkt-low';
    case '40-50':
    case '50-60': return 'fr-bucket-cell fr-bkt-mid';
    case '60-70':
    case '70-80': return 'fr-bucket-cell fr-bkt-high';
    case '80+': return 'fr-bucket-cell fr-bkt-top';
    default: return 'fr-bucket-cell';
  }
}

function gapBucketCssClass(label) {
  switch (label) {
    case SFC_GAP_BUCKETS[0]: return 'sfc-gap-cell sfc-gap-na';
    case SFC_GAP_BUCKETS[1]:
    case SFC_GAP_BUCKETS[2]: return 'sfc-gap-cell sfc-gap-8p';
    case SFC_GAP_BUCKETS[3]:
    case SFC_GAP_BUCKETS[4]: return 'sfc-gap-cell sfc-gap-68';
    case SFC_GAP_BUCKETS[5]:
    case SFC_GAP_BUCKETS[6]: return 'sfc-gap-cell sfc-gap-46';
    case SFC_GAP_BUCKETS[7]:
    case SFC_GAP_BUCKETS[8]: return 'sfc-gap-cell sfc-gap-24';
    case SFC_GAP_BUCKETS[9]:
    case SFC_GAP_BUCKETS[10]: return 'sfc-gap-cell sfc-gap-02';
    default: return 'sfc-gap-cell';
  }
}

var sfcR0Detail = false, sfcAisDetail = false;
var _sfcLookupPid = null;
var _buFold1DeltaByBu = null;
var _buFold1RowByBu = null;
var sfcGapDistChartInstance = null;
var sfcGapDistChartInstanceF1Bu = null;

function driverFromCtrCvrPp(ctrPpImpact, cvrPpImpact) {
  var mx = Math.max(Math.abs(ctrPpImpact), Math.abs(cvrPpImpact), 1e-6);
  if (Math.abs(Math.abs(ctrPpImpact) - Math.abs(cvrPpImpact)) / mx < 0.08) return 'tie';
  return Math.abs(ctrPpImpact) > Math.abs(cvrPpImpact) ? 'ctr' : 'cvr';
}

/**
 * Log-variance split (pp) for any signed total: Baseline = Overall, Segment = Fold 1.
 * CTR_Ratio = Ads_CTR/Org_CTR, CVR_Ratio = Ads_CVR/Org_CVR (CVR = CABN/click).
 * CTR_PP = (Log_Var_CTR/Sum)*totalPp; CVR_PP = (Log_Var_CVR/Sum)*totalPp.
 */
function logVarianceCtrCvrPpSplit(fc, totalPpSigned) {
  if (fc == null || totalPpSigned == null || isNaN(Number(totalPpSigned))) return null;
  var o = fc.o, f1 = fc.f1;
  if (!o || !f1) return null;
  if (o.ads_ctr == null || o.org_ctr == null || f1.ads_ctr == null || f1.org_ctr == null) return null;
  if (o.ads_cabn_clk == null || o.org_cabn_clk == null || f1.ads_cabn_clk == null || f1.org_cabn_clk == null) return null;

  var total = Number(totalPpSigned);
  var orgCtrB = Math.max(Number(o.org_ctr), 1e-9);
  var orgCtrS = Math.max(Number(f1.org_ctr), 1e-9);
  var orgCvrB = Math.max(Number(o.org_cabn_clk), 1e-9);
  var orgCvrS = Math.max(Number(f1.org_cabn_clk), 1e-9);

  var ctrRatioBaseline = Number(o.ads_ctr) / orgCtrB;
  var ctrRatioSegment = Number(f1.ads_ctr) / orgCtrS;
  var cvrRatioBaseline = Number(o.ads_cabn_clk) / orgCvrB;
  var cvrRatioSegment = Number(f1.ads_cabn_clk) / orgCvrS;

  if (ctrRatioBaseline <= 0 || ctrRatioSegment <= 0 || cvrRatioBaseline <= 0 || cvrRatioSegment <= 0) return null;

  var logVarCtr = Math.log(ctrRatioSegment) - Math.log(ctrRatioBaseline);
  var logVarCvr = Math.log(cvrRatioSegment) - Math.log(cvrRatioBaseline);
  var sumLv = logVarCtr + logVarCvr;

  var epsSum = 1e-12;
  var ctrPpImpact, cvrPpImpact, driver;
  if (Math.abs(sumLv) < epsSum) {
    ctrPpImpact = total * 0.5;
    cvrPpImpact = total * 0.5;
    driver = 'tie';
  } else {
    ctrPpImpact = (logVarCtr / sumLv) * total;
    cvrPpImpact = (logVarCvr / sumLv) * total;
    driver = driverFromCtrCvrPp(ctrPpImpact, cvrPpImpact);
  }

  return {
    ctrPpImpact: ctrPpImpact,
    cvrPpImpact: cvrPpImpact,
    logVarCtr: logVarCtr,
    logVarCvr: logVarCvr,
    sumLv: sumLv,
    driver: driver
  };
}

/**
 * Log-variance split for gap = R0_store(F1) - R0_BU(F1): baseline = BU Fold 1 ratios, segment = store Fold 1.
 */
function logVarianceCtrCvrPpSplitStoreF1VsBuFold1(fc, buRow, totalPpSigned) {
  if (fc == null || buRow == null || totalPpSigned == null || isNaN(Number(totalPpSigned))) return null;
  var f1 = fc.f1;
  if (!f1) return null;
  if (buRow.ads_ctr_fold1 == null || buRow.org_ctr_fold1 == null || f1.ads_ctr == null || f1.org_ctr == null) return null;
  if (buRow.ads_cabn_clk_fold1 == null || buRow.org_cabn_clk_fold1 == null || f1.ads_cabn_clk == null || f1.org_cabn_clk == null) return null;

  var total = Number(totalPpSigned);
  var orgCtrB = Math.max(Number(buRow.org_ctr_fold1), 1e-9);
  var orgCtrS = Math.max(Number(f1.org_ctr), 1e-9);
  var orgCvrB = Math.max(Number(buRow.org_cabn_clk_fold1), 1e-9);
  var orgCvrS = Math.max(Number(f1.org_cabn_clk), 1e-9);

  var ctrRatioBaseline = Number(buRow.ads_ctr_fold1) / orgCtrB;
  var ctrRatioSegment = Number(f1.ads_ctr) / orgCtrS;
  var cvrRatioBaseline = Number(buRow.ads_cabn_clk_fold1) / orgCvrB;
  var cvrRatioSegment = Number(f1.ads_cabn_clk) / orgCvrS;

  if (ctrRatioBaseline <= 0 || ctrRatioSegment <= 0 || cvrRatioBaseline <= 0 || cvrRatioSegment <= 0) return null;

  var logVarCtr = Math.log(ctrRatioSegment) - Math.log(ctrRatioBaseline);
  var logVarCvr = Math.log(cvrRatioSegment) - Math.log(cvrRatioBaseline);
  var sumLv = logVarCtr + logVarCvr;

  var epsSum = 1e-12;
  var ctrPpImpact, cvrPpImpact, driver;
  if (Math.abs(sumLv) < epsSum) {
    ctrPpImpact = total * 0.5;
    cvrPpImpact = total * 0.5;
    driver = 'tie';
  } else {
    ctrPpImpact = (logVarCtr / sumLv) * total;
    cvrPpImpact = (logVarCvr / sumLv) * total;
    driver = driverFromCtrCvrPp(ctrPpImpact, cvrPpImpact);
  }

  return {
    ctrPpImpact: ctrPpImpact,
    cvrPpImpact: cvrPpImpact,
    logVarCtr: logVarCtr,
    logVarCvr: logVarCvr,
    sumLv: sumLv,
    driver: driver
  };
}

/**
 * Log-variance attribution of R0 (pp): total = R0(Overall) - R0(Fold 1).
 */
function r0LogVarianceAttribution(fc) {
  var o = fc && fc.o, f1 = fc && fc.f1;
  if (!o || !f1 || o.r0 == null || f1.r0 == null) return null;
  var totalPpDrop = Number(o.r0) - Number(f1.r0);
  var split = logVarianceCtrCvrPpSplit(fc, totalPpDrop);
  if (!split) return null;
  return Object.assign({ totalPpDrop: totalPpDrop }, split);
}

function gapDriverCtrVsCvr(fc) {
  var a = r0LogVarianceAttribution(fc);
  if (!a) return 'na';
  return a.driver;
}

function gapDriverCellHtml(fc) {
  var d = gapDriverCtrVsCvr(fc);
  if (d === 'ctr') return '<span class="gap-drv-ctr">CTR</span>';
  if (d === 'cvr') return '<span class="gap-drv-cvr">CVR</span>';
  if (d === 'tie') return '<span class="gap-drv-tie">Tie</span>';
  return '<span style="color:var(--text3)">\u2014</span>';
}

function gapDriverCountIncr(counts, fc) {
  var d = gapDriverCtrVsCvr(fc);
  if (d === 'ctr') counts.ctr++;
  else if (d === 'cvr') counts.cvr++;
  else if (d === 'tie') counts.tie++;
  else counts.na++;
}

function gapDriverCountIncrF1Bu(counts, st) {
  var fc = getFoldCmpForStore(st);
  var br = getBuFold1CompareRow(st.b);
  var gap = storeFold1R0MinusBuFold1R0Pp(st);
  if (!fc || !br || gap == null || isNaN(gap)) { counts.na++; return; }
  var sp = logVarianceCtrCvrPpSplitStoreF1VsBuFold1(fc, br, gap);
  if (!sp) { counts.na++; return; }
  if (sp.driver === 'ctr') counts.ctr++;
  else if (sp.driver === 'cvr') counts.cvr++;
  else counts.tie++;
}

function gapDriverCellHtmlF1Bu(st) {
  var fc = getFoldCmpForStore(st);
  var br = getBuFold1CompareRow(st.b);
  var gap = storeFold1R0MinusBuFold1R0Pp(st);
  if (!fc || !br || gap == null || isNaN(gap)) return '<span style="color:var(--text3)">\u2014</span>';
  var sp = logVarianceCtrCvrPpSplitStoreF1VsBuFold1(fc, br, gap);
  if (!sp) return '<span style="color:var(--text3)">\u2014</span>';
  if (sp.driver === 'ctr') return '<span class="gap-drv-ctr">CTR</span>';
  if (sp.driver === 'cvr') return '<span class="gap-drv-cvr">CABN/clk</span>';
  return '<span class="gap-drv-tie">Tie</span>';
}

function getBuDeltaPp(bu) {
  if (typeof BU_FOLD1_COMPARE_BY_PERIOD === 'undefined') return null;
  if (_buFold1DeltaByBu === null || _buFold1DeltaByBu._pid !== activePeriod) {
    _buFold1DeltaByBu = { _pid: activePeriod };
    (BU_FOLD1_COMPARE_BY_PERIOD[activePeriod] || []).forEach(function(r) {
      if (r.r0_fold1 != null && r.r0_overall != null) {
        _buFold1DeltaByBu[r.bu] = Number(r.r0_fold1) - Number(r.r0_overall);
      } else if (r.delta_pp != null) {
        _buFold1DeltaByBu[r.bu] = -Number(r.delta_pp);
      } else {
        _buFold1DeltaByBu[r.bu] = null;
      }
    });
  }
  var v = _buFold1DeltaByBu[bu];
  return v != null && !isNaN(v) ? Number(v) : null;
}

function getBuFold1CompareRow(bu) {
  if (typeof BU_FOLD1_COMPARE_BY_PERIOD === 'undefined') return null;
  if (_buFold1RowByBu === null || _buFold1RowByBu._pid !== activePeriod) {
    _buFold1RowByBu = { _pid: activePeriod };
    (BU_FOLD1_COMPARE_BY_PERIOD[activePeriod] || []).forEach(function(r) {
      _buFold1RowByBu[r.bu] = r;
    });
  }
  return _buFold1RowByBu[bu] || null;
}

function fmtBuDeltaPp(v) {
  if (v == null || isNaN(Number(v))) return '\u2013';
  var n = Number(v);
  return (n > 0 ? '+' : '') + n.toFixed(2) + ' pp';
}

/** Delta coloring: R0 F1−O negative = Fold 1 weaker (bad); AIS F1−O positive = more ad share in F1 (warn). */
function buDeltaClass(pp, flavor) {
  if (pp == null || isNaN(Number(pp))) return '';
  var n = Number(pp);
  if (flavor === 'r0') return n < 0 ? 'val-bad' : (n > 0 ? 'val-good' : '');
  if (flavor === 'ais') return n > 0 ? 'val-warn' : (n < 0 ? 'val-good' : '');
  return n < 0 ? 'val-bad' : (n > 0 ? 'val-good' : '');
}

function r0LevelClass(r0) {
  if (r0 == null || isNaN(Number(r0))) return '';
  var v = Number(r0);
  if (v >= 60) return 'val-good';
  if (v < 40) return 'val-bad';
  return 'val-warn';
}

function buFold1WeightedAvg(rows, key) {
  var num = 0, wsum = 0;
  rows.forEach(function(r) {
    var w = r.all_impressions || 0;
    var v = r[key];
    if (v != null && !isNaN(Number(v)) && w > 0) {
      num += Number(v) * w;
      wsum += w;
    }
  });
  return wsum > 0 ? num / wsum : null;
}

function renderBuFold1Table() {
  var tbl = document.getElementById('table-bu-fold1-delta');
  if (!tbl || typeof BU_FOLD1_COMPARE_BY_PERIOD === 'undefined') return;
  var rows = BU_FOLD1_COMPARE_BY_PERIOD[activePeriod] || [];
  var totalImp = rows.reduce(function(acc, r) { return acc + (r.all_impressions || 0); }, 0);
  var sorted = rows.slice().sort(function(a, b) { return (b.all_impressions || 0) - (a.all_impressions || 0); });
  var g3 = ' colspan="3" class="text-center sfc-group"';
  var html = '<thead><tr><th rowspan="2">BU</th><th rowspan="2" class="text-right">Impr share %</th>';
  html += '<th' + g3 + '>R0</th><th' + g3 + '>AIS</th><th' + g3 + '>Ads CTR</th><th' + g3 + '>Org CTR</th><th' + g3 + '>Ads CABN/clk</th><th' + g3 + '>Org CABN/clk</th></tr>';
  html += '<tr><th class="text-right">BU Fold 1</th><th class="text-right">Store Fold 1</th><th class="text-right">Delta</th>';
  html += '<th class="text-right">BU Fold 1</th><th class="text-right">Store Fold 1</th><th class="text-right">Delta</th>';
  html += '<th class="text-right">BU Fold 1</th><th class="text-right">Store Fold 1</th><th class="text-right">Delta</th>';
  html += '<th class="text-right">BU Fold 1</th><th class="text-right">Store Fold 1</th><th class="text-right">Delta</th>';
  html += '<th class="text-right">BU Fold 1</th><th class="text-right">Store Fold 1</th><th class="text-right">Delta</th>';
  html += '<th class="text-right">BU Fold 1</th><th class="text-right">Store Fold 1</th><th class="text-right">Delta</th></tr></thead><tbody>';
  if (sorted.length && totalImp > 0) {
    // Use BU Fold 1 vs Store Fold 1 comparison
    var fold1Data = PD().overall;
    var w = function(k) { return buFold1WeightedAvg(sorted, k); };
    var buR0 = w('r0_fold1'), storeR0 = fold1Data.R0;
    var r0Delta = (buR0 != null && storeR0 != null) ? (storeR0 - buR0) : null;
    var buAis = w('ais_fold1'), storeAis = fold1Data.AIS;
    var aisDelta = (buAis != null && storeAis != null) ? (storeAis - buAis) : null;
    var buAdsCtr = w('ads_ctr_fold1'), storeAdsCtr = fold1Data.ads_CTR;
    var adsCtrDelta = (buAdsCtr != null && storeAdsCtr != null) ? (storeAdsCtr - buAdsCtr) : null;
    var buOrgCtr = w('org_ctr_fold1'), storeOrgCtr = fold1Data.org_CTR;
    var orgCtrDelta = (buOrgCtr != null && storeOrgCtr != null) ? (storeOrgCtr - buOrgCtr) : null;
    var buAdsCabn = w('ads_cabn_clk_fold1'), storeAdsCabn = fold1Data.ads_CABN_clk;
    var adsCabnDelta = (buAdsCabn != null && storeAdsCabn != null) ? (storeAdsCabn - buAdsCabn) : null;
    var buOrgCabn = w('org_cabn_clk_fold1'), storeOrgCabn = fold1Data.org_CABN_clk;
    var orgCabnDelta = (buOrgCabn != null && storeOrgCabn != null) ? (storeOrgCabn - buOrgCabn) : null;
    function pctCell(x) { return x != null ? Number(x).toFixed(2) + '%' : '\u2013'; }
    html += '<tr style="background:rgba(51,65,85,0.45);font-weight:600"><td><strong>Overall</strong></td>';
    html += '<td class="text-right">100.00%</td>';
    html += '<td class="text-right ' + r0LevelClass(buR0) + '">' + pctCell(buR0) + '</td><td class="text-right ' + r0LevelClass(storeR0) + '">' + pctCell(storeR0) + '</td><td class="text-right ' + buDeltaClass(r0Delta, 'r0') + '">' + fmtBuDeltaPp(r0Delta) + '</td>';
    html += '<td class="text-right">' + pctCell(buAis) + '</td><td class="text-right">' + pctCell(storeAis) + '</td><td class="text-right ' + buDeltaClass(aisDelta, 'ais') + '">' + fmtBuDeltaPp(aisDelta) + '</td>';
    html += '<td class="text-right">' + pctCell(buAdsCtr) + '</td><td class="text-right">' + pctCell(storeAdsCtr) + '</td><td class="text-right ' + buDeltaClass(adsCtrDelta, 'metric') + '">' + fmtBuDeltaPp(adsCtrDelta) + '</td>';
    html += '<td class="text-right">' + pctCell(buOrgCtr) + '</td><td class="text-right">' + pctCell(storeOrgCtr) + '</td><td class="text-right ' + buDeltaClass(orgCtrDelta, 'metric') + '">' + fmtBuDeltaPp(orgCtrDelta) + '</td>';
    html += '<td class="text-right">' + pctCell(buAdsCabn) + '</td><td class="text-right">' + pctCell(storeAdsCabn) + '</td><td class="text-right ' + buDeltaClass(adsCabnDelta, 'metric') + '">' + fmtBuDeltaPp(adsCabnDelta) + '</td>';
    html += '<td class="text-right">' + pctCell(buOrgCabn) + '</td><td class="text-right">' + pctCell(storeOrgCabn) + '</td><td class="text-right ' + buDeltaClass(orgCabnDelta, 'metric') + '">' + fmtBuDeltaPp(orgCabnDelta) + '</td></tr>';
  }
  sorted.forEach(function(r) {
    var col = BU_COLORS[r.bu] || '#64748b';
    var sh = totalImp && r.all_impressions ? ((r.all_impressions / totalImp) * 100).toFixed(2) : '0';
    var buR0 = r.r0_fold1 != null ? Number(r.r0_fold1).toFixed(2) + '%' : '\u2013';
    var storeR0 = r.r0_overall != null ? Number(r.r0_overall).toFixed(2) + '%' : '\u2013';
    var r0Delta = (r.r0_overall != null && r.r0_fold1 != null) ? (Number(r.r0_overall) - Number(r.r0_fold1)) : null;
    var rdp = fmtBuDeltaPp(r0Delta);
    function pctBUStore(kbu, kstore) {
      var bu = r[kbu], store = r[kstore];
      return [
        bu != null ? Number(bu).toFixed(2) + '%' : '\u2013',
        store != null ? Number(store).toFixed(2) + '%' : '\u2013'
      ];
    }
    var aisP = pctBUStore('ais_fold1', 'ais_overall');
    var adsCtr = pctBUStore('ads_ctr_fold1', 'ads_ctr_overall');
    var orgCtr = pctBUStore('org_ctr_fold1', 'org_ctr_overall');
    var adsCab = pctBUStore('ads_cabn_clk_fold1', 'ads_cabn_clk_overall');
    var orgCab = pctBUStore('org_cabn_clk_fold1', 'org_cabn_clk_overall');
    html += '<tr><td><span class="bu-badge" style="background:' + col + '22;color:' + col + '">' + escapeHtml(r.bu) + '</span></td>';
    html += '<td class="text-right">' + sh + '%</td>';
    html += '<td class="text-right ' + r0LevelClass(r.r0_fold1) + '">' + buR0 + '</td><td class="text-right ' + r0LevelClass(r.r0_overall) + '">' + storeR0 + '</td><td class="text-right ' + buDeltaClass(r0Delta, 'r0') + '">' + rdp + '</td>';
    html += '<td class="text-right">' + aisP[0] + '</td><td class="text-right">' + aisP[1] + '</td><td class="text-right ' + buDeltaClass(r.ais_delta_pp, 'ais') + '">' + fmtBuDeltaPp(r.ais_delta_pp) + '</td>';
    html += '<td class="text-right">' + adsCtr[0] + '</td><td class="text-right">' + adsCtr[1] + '</td><td class="text-right ' + buDeltaClass(r.ads_ctr_delta_pp, 'metric') + '">' + fmtBuDeltaPp(r.ads_ctr_delta_pp) + '</td>';
    html += '<td class="text-right">' + orgCtr[0] + '</td><td class="text-right">' + orgCtr[1] + '</td><td class="text-right ' + buDeltaClass(r.org_ctr_delta_pp, 'metric') + '">' + fmtBuDeltaPp(r.org_ctr_delta_pp) + '</td>';
    html += '<td class="text-right">' + adsCab[0] + '</td><td class="text-right">' + adsCab[1] + '</td><td class="text-right ' + buDeltaClass(r.ads_cabn_clk_delta_pp, 'metric') + '">' + fmtBuDeltaPp(r.ads_cabn_clk_delta_pp) + '</td>';
    html += '<td class="text-right">' + orgCab[0] + '</td><td class="text-right">' + orgCab[1] + '</td><td class="text-right ' + buDeltaClass(r.org_cabn_clk_delta_pp, 'metric') + '">' + fmtBuDeltaPp(r.org_cabn_clk_delta_pp) + '</td></tr>';
  });
  html += '</tbody>';
  tbl.innerHTML = html;
}

function renderGapBucketDistribution(filtered, globalImp) {
  var canvas = document.getElementById('sfc-gap-bucket-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  var gImp = globalImp != null ? globalImp : ((PD().overall && PD().overall.all_impressions) || 1);
  var gapChartBuckets = SFC_GAP_BUCKETS.slice(1);
  var counts = {};
  var impSum = {};
  gapChartBuckets.forEach(function(b) { counts[b] = 0; impSum[b] = 0; });
  filtered.forEach(function(s) {
    var fc = getFoldCmpForStore(s);
    var d = fold1MinusOverallPp(fc);
    var buD = getBuDeltaPp(s.b);
    var gb = gapBucketStoreMinusBu(buD, d);
    if (gb === 'N/A') return;
    if (Object.prototype.hasOwnProperty.call(counts, gb)) {
      counts[gb]++;
      impSum[gb] += (s.ti || 0);
    }
  });
  var totalImpBucketed = gapChartBuckets.reduce(function(a, b) { return a + impSum[b]; }, 0);
  var classifiableStores = gapChartBuckets.reduce(function(a, b) { return a + counts[b]; }, 0);
  var countData = gapChartBuckets.map(function(b) { return counts[b]; });
  var shareData = gapChartBuckets.map(function(b) {
    return totalImpBucketed > 0 ? (100 * impSum[b] / totalImpBucketed) : 0;
  });
  var barColors = BUCKET_COLORS.slice(0, gapChartBuckets.length);
  if (sfcGapDistChartInstance) {
    sfcGapDistChartInstance.destroy();
    sfcGapDistChartInstance = null;
  }
  sfcGapDistChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    plugins: [ChartDataLabels],
    data: {
      labels: gapChartBuckets,
      datasets: [{
        label: 'Store count',
        data: countData,
        order: 0,
        backgroundColor: barColors.map(function(c) { return c + '99'; }),
        borderColor: barColors,
        borderWidth: 1,
        borderRadius: 6,
        yAxisID: 'y',
        datalabels: {
          anchor: 'end',
          align: 'end',
          color: '#e2e8f0',
          font: { weight: 'bold', size: 11 },
          formatter: function(v) { return v; }
        }
      }, {
        label: 'Impression share %',
        data: shareData,
        type: 'line',
        order: 1,
        borderColor: '#22d3ee',
        backgroundColor: 'transparent',
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: '#22d3ee',
        pointBorderWidth: 2,
        pointBorderColor: '#0f172a',
        borderWidth: 3,
        yAxisID: 'y1',
        tension: 0.35,
        fill: false,
        datalabels: { display: false }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 22 } },
      interaction: { mode: 'index', intersect: false },
      onHover: function(evt, els) {
        var el = evt.native && evt.native.target;
        if (el && el.style) el.style.cursor = (els && els.length) ? 'pointer' : 'default';
      },
      onClick: function(evt, els) {
        if (!els || !els.length) return;
        if (els[0].datasetIndex !== 0) return;
        var idx = els[0].index;
        if (idx < 0 || idx >= gapChartBuckets.length) return;
        openGapBucketStoresModal(gapChartBuckets[idx], filtered, gImp);
      },
      plugins: {
        legend: { position: 'bottom' },
        datalabels: {},
        tooltip: {
          callbacks: {
            label: function(ctx) {
              if (ctx.dataset.yAxisID === 'y1') {
                return ctx.dataset.label + ': ' + Number(ctx.raw).toFixed(2) + '%';
              }
              return ctx.dataset.label + ': ' + ctx.raw;
            },
            afterBody: function(items) {
              if (!items || !items.length) return [];
              var i = items[0].dataIndex;
              var c = countData[i] || 0;
              var pctSt = classifiableStores ? ((100 * c / classifiableStores).toFixed(1)) : '0';
              return ['% of bucketed stores: ' + pctSt + '%'];
            }
          }
        }
      },
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 32, font: { size: 10 } }, grid: { display: false } },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Store count' },
          grid: { color: 'rgba(71,85,105,0.2)' }
        },
        y1: {
          position: 'right',
          beginAtZero: true,
          title: { display: true, text: 'Impression share %' },
          grid: { drawOnChartArea: false },
          ticks: { callback: function(v) { return Number(v).toFixed(1) + '%'; } }
        }
      }
    }
  });
}

function renderGapBucketDistributionF1Bu(filtered, globalImp) {
  var canvas = document.getElementById('sfc-gap-bucket-chart-f1bu');
  if (!canvas || typeof Chart === 'undefined') return;
  var gImp = globalImp != null ? globalImp : ((PD().overall && PD().overall.all_impressions) || 1);
  var gapChartBuckets = SFC_GAP_BUCKETS_F1BU.slice(1);
  var counts = {};
  var impSum = {};
  gapChartBuckets.forEach(function(b) { counts[b] = 0; impSum[b] = 0; });
  filtered.forEach(function(s) {
    var gb = gapBucketSignedF1Bu(storeFold1R0MinusBuFold1R0Pp(s));
    if (gb === 'N/A') return;
    if (Object.prototype.hasOwnProperty.call(counts, gb)) {
      counts[gb]++;
      impSum[gb] += (s.ti || 0);
    }
  });
  var totalImpBucketed = gapChartBuckets.reduce(function(a, b) { return a + impSum[b]; }, 0);
  var classifiableStores = gapChartBuckets.reduce(function(a, b) { return a + counts[b]; }, 0);
  var countData = gapChartBuckets.map(function(b) { return counts[b]; });
  var shareData = gapChartBuckets.map(function(b) {
    return totalImpBucketed > 0 ? (100 * impSum[b] / totalImpBucketed) : 0;
  });
  var barColors = BUCKET_COLORS.slice(0, gapChartBuckets.length);
  if (sfcGapDistChartInstanceF1Bu) {
    sfcGapDistChartInstanceF1Bu.destroy();
    sfcGapDistChartInstanceF1Bu = null;
  }
  sfcGapDistChartInstanceF1Bu = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    plugins: [ChartDataLabels],
    data: {
      labels: gapChartBuckets,
      datasets: [{
        label: 'Store count',
        data: countData,
        order: 0,
        backgroundColor: barColors.map(function(c) { return c + '99'; }),
        borderColor: barColors,
        borderWidth: 1,
        borderRadius: 6,
        yAxisID: 'y',
        datalabels: {
          anchor: 'end',
          align: 'end',
          color: '#e2e8f0',
          font: { weight: 'bold', size: 11 },
          formatter: function(v) { return v; }
        }
      }, {
        label: 'Impression share %',
        data: shareData,
        type: 'line',
        order: 1,
        borderColor: '#e879f9',
        backgroundColor: 'transparent',
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: '#e879f9',
        pointBorderWidth: 2,
        pointBorderColor: '#0f172a',
        borderWidth: 3,
        yAxisID: 'y1',
        tension: 0.35,
        fill: false,
        datalabels: { display: false }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 22 } },
      interaction: { mode: 'index', intersect: false },
      onHover: function(evt, els) {
        var el = evt.native && evt.native.target;
        if (el && el.style) el.style.cursor = (els && els.length) ? 'pointer' : 'default';
      },
      onClick: function(evt, els) {
        if (!els || !els.length) return;
        if (els[0].datasetIndex !== 0) return;
        var idx = els[0].index;
        if (idx < 0 || idx >= gapChartBuckets.length) return;
        openGapBucketStoresModalF1Bu(gapChartBuckets[idx], filtered, gImp);
      },
      plugins: {
        legend: { position: 'bottom' },
        datalabels: {},
        tooltip: {
          callbacks: {
            label: function(ctx) {
              if (ctx.dataset.yAxisID === 'y1') {
                return ctx.dataset.label + ': ' + Number(ctx.raw).toFixed(2) + '%';
              }
              return ctx.dataset.label + ': ' + ctx.raw;
            },
            afterBody: function(items) {
              if (!items || !items.length) return [];
              var i = items[0].dataIndex;
              var c = countData[i] || 0;
              var pctSt = classifiableStores ? ((100 * c / classifiableStores).toFixed(1)) : '0';
              return ['% of bucketed stores: ' + pctSt + '%'];
            }
          }
        }
      },
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 32, font: { size: 10 } }, grid: { display: false } },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Store count' },
          grid: { color: 'rgba(71,85,105,0.2)' }
        },
        y1: {
          position: 'right',
          beginAtZero: true,
          title: { display: true, text: 'Impression share %' },
          grid: { drawOnChartArea: false },
          ticks: { callback: function(v) { return Number(v).toFixed(1) + '%'; } }
        }
      }
    }
  });
}

function getFoldCmpForStore(st) {
  if (typeof STORE_FOLD_COMPARE_BY_PERIOD === 'undefined') return null;
  if (_sfcLookupPid !== activePeriod) {
    _sfcLookupPid = activePeriod;
    window._sfcByStore = {};
    (STORE_FOLD_COMPARE_BY_PERIOD[activePeriod] || []).forEach(function(r) { _sfcByStore[r.s] = r.fc; });
  }
  return (window._sfcByStore && _sfcByStore[st.s]) || null;
}

function numOrNeg(v) {
  return v != null && !isNaN(v) ? Number(v) : -1e9;
}

function cmpSortVal(s, key, globalImp) {
  var g = globalImp != null ? globalImp : ((PD().overall && PD().overall.all_impressions) || 1);
  var fc = getFoldCmpForStore(s);
  var d = fold1MinusOverallPp(fc);
  var buD = getBuDeltaPp(s.b);
  switch (key) {
    case 'b': return s.b;
    case 's': return s.s;
    case 'sname': return sn(s.s);
    case 'r': return numOrNeg(s.r);
    case 'a': return numOrNeg(s.a);
    case 'share': return numOrNeg((s.ti / g) * 100);
    case 'ac': return numOrNeg(s.ac);
    case 'oc': return numOrNeg(s.oc);
    case 'acb': return numOrNeg(s.acb);
    case 'ocb': return numOrNeg(s.ocb);
    case 'ai': return numOrNeg(s.ai);
    case 'oi': return numOrNeg(s.oi);
    case 'ti': return numOrNeg(s.ti);
    case 'ak': return numOrNeg(s.ak);
    case 'ok': return numOrNeg(s.ok);
    case 'acn': return numOrNeg(s.acn);
    case 'ocn': return numOrNeg(s.ocn);
    case 'sd': return numOrNeg(d);
    case 'bud': return numOrNeg(buD);
    case 'bu_ms':
      return (buD != null && !isNaN(buD) && d != null && !isNaN(d)) ? numOrNeg(d - buD) : -1e9;
    case 'gapk': {
      var lab = gapBucketStoreMinusBu(buD, d);
      return Object.prototype.hasOwnProperty.call(GAP_BUCKETS_ORDER, lab) ? GAP_BUCKETS_ORDER[lab] : -1;
    }
    case 'or0': return fc && fc.o && fc.o.r0 != null ? numOrNeg(fc.o.r0) : -1e9;
    case 'oais': return fc && fc.o && fc.o.ais != null ? numOrNeg(fc.o.ais) : -1e9;
    case 'f1r0': return fc && fc.f1 && fc.f1.r0 != null ? numOrNeg(fc.f1.r0) : -1e9;
    case 'f1ais': return fc && fc.f1 && fc.f1.ais != null ? numOrNeg(fc.f1.ais) : -1e9;
    case 'oadctr': return fc && fc.o && fc.o.ads_ctr != null ? numOrNeg(fc.o.ads_ctr) : -1e9;
    case 'oadscabn': return fc && fc.o && fc.o.ads_cabn_clk != null ? numOrNeg(fc.o.ads_cabn_clk) : -1e9;
    case 'f1adctr': return fc && fc.f1 && fc.f1.ads_ctr != null ? numOrNeg(fc.f1.ads_ctr) : -1e9;
    case 'f1adscabn': return fc && fc.f1 && fc.f1.ads_cabn_clk != null ? numOrNeg(fc.f1.ads_cabn_clk) : -1e9;
    case 'oorgctr': return fc && fc.o && fc.o.org_ctr != null ? numOrNeg(fc.o.org_ctr) : -1e9;
    case 'oorgcabn': return fc && fc.o && fc.o.org_cabn_clk != null ? numOrNeg(fc.o.org_cabn_clk) : -1e9;
    case 'f1orgctr': return fc && fc.f1 && fc.f1.org_ctr != null ? numOrNeg(fc.f1.org_ctr) : -1e9;
    case 'f1orgcabn': return fc && fc.f1 && fc.f1.org_cabn_clk != null ? numOrNeg(fc.f1.org_cabn_clk) : -1e9;
    case 'gap_ctr': {
      var d0 = fold1MinusOverallPp(fc), b0 = getBuDeltaPp(s.b);
      var g0 = (d0 != null && b0 != null) ? (d0 - b0) : null;
      var sp0 = (g0 != null && fc) ? logVarianceCtrCvrPpSplit(fc, g0) : null;
      return sp0 ? numOrNeg(sp0.ctrPpImpact) : -1e9;
    }
    case 'gap_cvr': {
      var d1 = fold1MinusOverallPp(fc), b1 = getBuDeltaPp(s.b);
      var g1 = (d1 != null && b1 != null) ? (d1 - b1) : null;
      var sp1 = (g1 != null && fc) ? logVarianceCtrCvrPpSplit(fc, g1) : null;
      return sp1 ? numOrNeg(sp1.cvrPpImpact) : -1e9;
    }
    case 'gap_pri': {
      var d2 = fold1MinusOverallPp(fc), b2 = getBuDeltaPp(s.b);
      var g2 = (d2 != null && b2 != null) ? (d2 - b2) : null;
      var sp2 = (g2 != null && fc) ? logVarianceCtrCvrPpSplit(fc, g2) : null;
      if (!sp2) return 3;
      return sp2.driver === 'ctr' ? 0 : (sp2.driver === 'cvr' ? 1 : 2);
    }
    case 'f1bu_s_r0': return fc && fc.f1 && fc.f1.r0 != null ? numOrNeg(fc.f1.r0) : -1e9;
    case 'f1bu_b_r0': {
      var brF = getBuFold1CompareRow(s.b);
      return brF && brF.r0_fold1 != null ? numOrNeg(brF.r0_fold1) : -1e9;
    }
    case 'f1bu_ms': return numOrNeg(storeFold1R0MinusBuFold1R0Pp(s));
    case 'f1bu_gapk': {
      var labF = gapBucketSignedF1Bu(storeFold1R0MinusBuFold1R0Pp(s));
      return Object.prototype.hasOwnProperty.call(GAP_BUCKETS_ORDER_F1BU, labF) ? GAP_BUCKETS_ORDER_F1BU[labF] : -1;
    }
    case 'f1bu_ctr': {
      var gf = storeFold1R0MinusBuFold1R0Pp(s);
      var brC = getBuFold1CompareRow(s.b);
      var spC = (gf != null && fc && brC) ? logVarianceCtrCvrPpSplitStoreF1VsBuFold1(fc, brC, gf) : null;
      return spC ? numOrNeg(spC.ctrPpImpact) : -1e9;
    }
    case 'f1bu_cvr': {
      var gf2 = storeFold1R0MinusBuFold1R0Pp(s);
      var brV = getBuFold1CompareRow(s.b);
      var spV = (gf2 != null && fc && brV) ? logVarianceCtrCvrPpSplitStoreF1VsBuFold1(fc, brV, gf2) : null;
      return spV ? numOrNeg(spV.cvrPpImpact) : -1e9;
    }
    case 'f1bu_pri': {
      var gf3 = storeFold1R0MinusBuFold1R0Pp(s);
      var brP = getBuFold1CompareRow(s.b);
      var spP = (gf3 != null && fc && brP) ? logVarianceCtrCvrPpSplitStoreF1VsBuFold1(fc, brP, gf3) : null;
      if (!spP) return 3;
      return spP.driver === 'ctr' ? 0 : (spP.driver === 'cvr' ? 1 : 2);
    }
    case 'fr_jan_pct': {
      var frd = getStoreFrJan2531(s);
      return frd && frd.fr != null && !isNaN(frd.fr) ? numOrNeg(frd.fr) : -1e9;
    }
    case 'fr_jan_buck': {
      var frb = getStoreFrJan2531(s);
      var labB = frb && frb.bucket ? frb.bucket : 'N/A';
      return Object.prototype.hasOwnProperty.call(FR_BUCKET_ORDER_JAN, labB) ? FR_BUCKET_ORDER_JAN[labB] : -1;
    }
    default: return numOrNeg(s.ti);
  }
}

function storeListSortBy(col) {
  if (storeListSortCol === col) storeListSortDir *= -1;
  else { storeListSortCol = col; storeListSortDir = 1; }
  sliPage = 0;
  renderStoreTables();
}

function sfcSortThRow2(key, label, cls) {
  var arrow = storeListSortCol === key ? (storeListSortDir === 1 ? ' &#9650;' : ' &#9660;') : '';
  var c = 'cmp-sort text-right' + (cls ? ' ' + cls : '');
  return '<th class="' + c + '" onclick="storeListSortBy(\'' + key + '\')">' + escapeHtml(label) + arrow + '</th>';
}

function sfcSortThRowspan2(key, label, cls) {
  var arrow = storeListSortCol === key ? (storeListSortDir === 1 ? ' &#9650;' : ' &#9660;') : '';
  var c = 'cmp-sort' + (cls ? ' ' + cls : '');
  return '<th rowspan="2" class="' + c + '" onclick="storeListSortBy(\'' + key + '\')">' + label + arrow + '</th>';
}

/* ── Store-Level Table (with Store Name) ── */
function renderStoreTables() {
  var stores = PD().ALL_STORES;
  var bus = msGetSelected('sli-bu'), r0s = msGetSelected('sli-r0'), aiss = msGetSelected('sli-ais');
  var snames = msGetSelected('sli-sname');
  var gapSel = null;
  var gapEl = document.getElementById('cmp-f-gap');
  if (gapEl) gapSel = msGetSelected('cmp-f-gap');
  var gapSelF1bu = null;
  var gapElF1bu = document.getElementById('cmp-f-gap-f1bu');
  if (gapElF1bu) gapSelF1bu = msGetSelected('cmp-f-gap-f1bu');
  var frBuckSel = null;
  var frBuckEl = document.getElementById('cmp-f-fr-bucket');
  if (frBuckEl) frBuckSel = msGetSelected('cmp-f-fr-bucket');

  var globalImp = PD().overall.all_impressions;

  var filtered = stores.filter(function(s){
    if(bus.indexOf(s.b)===-1) return false;
    if(r0s.indexOf(s.rb)===-1) return false;
    if(aiss.indexOf(s.ab)===-1) return false;
    if(snames && snames.indexOf(sn(s.s))===-1) return false;
    if (gapSel && gapSel.length) {
      var fc = getFoldCmpForStore(s);
      var d = fold1MinusOverallPp(fc);
      var buD = getBuDeltaPp(s.b);
      var gb = gapBucketStoreMinusBu(buD, d);
      if (gapSel.indexOf(gb) === -1) return false;
    }
    if (gapSelF1bu && gapSelF1bu.length) {
      var gbF = gapBucketSignedF1Bu(storeFold1R0MinusBuFold1R0Pp(s));
      if (gapSelF1bu.indexOf(gbF) === -1) return false;
    }
    if (frBuckSel && frBuckSel.length) {
      var frdF = getStoreFrJan2531(s);
      var bkF = frdF && frdF.bucket ? frdF.bucket : 'N/A';
      if (frBuckSel.indexOf(bkF) === -1) return false;
    }
    return true;
  });

  if (storeListSortCol) {
    var k = storeListSortCol, dir = storeListSortDir;
    var strKeys = { b: 1, s: 1, sname: 1 };
    filtered.sort(function(a, b) {
      var va = cmpSortVal(a, k, globalImp), vb = cmpSortVal(b, k, globalImp);
      if (strKeys[k]) return String(va).localeCompare(String(vb)) * dir;
      return (Number(va) - Number(vb)) * dir;
    });
  } else {
    filtered.sort(function(a,b){ return b.ti - a.ti; });
  }

  var topnEl = document.getElementById('sli-topn');
  var topn = topnEl ? parseInt(topnEl.value, 10) : 30;
  if (isNaN(topn)) topn = 30;
  var total = filtered.length;
  var pageSize = topn > 0 ? topn : total;
  var start = sliPage * pageSize;
  var end = Math.min(start + pageSize, total);
  var page = filtered.slice(start, end);

  function sh(key,label,cls){
    var arrow = storeListSortCol===key?(storeListSortDir===1?' &#9650;':' &#9660;'):'';
    return '<th'+(cls?' class="'+cls+'"':'')+' style="cursor:pointer;white-space:nowrap" onclick="storeListSortBy(\''+key+'\')">'+label+arrow+'</th>';
  }
  var html = '<thead><tr><th>#</th>'+sh('b','BU')+sh('s','Store')+sh('sname','Store Name')+sh('r','R0 %','text-right')+sh('a','AIS %','text-right')+sh('share','Impr Share','text-right')+sh('ac','Ads CTR %','text-right')+sh('oc','Org CTR %','text-right')+sh('acb','Ads CABN/Clk %','text-right')+sh('ocb','Org CABN/Clk %','text-right')+sh('ai','Ads Imp','text-right')+sh('oi','Org Imp','text-right')+sh('ti','All Imp','text-right')+sh('ak','Ads Clicks','text-right')+sh('ok','Org Clicks','text-right')+sh('acn','Ads CABN','text-right')+sh('ocn','Org CABN','text-right')+'</tr></thead><tbody>';
  page.forEach(function(s,i){
    var r0c = s.r>=60?'val-good':s.r<40?'val-bad':'val-warn';
    var c = BU_COLORS[s.b]||'#64748b';
    var share = ((s.ti/globalImp)*100).toFixed(2);
    html += '<tr><td>'+(start+i+1)+'</td>';
    html += '<td><span class="bu-badge" style="background:'+c+'22;color:'+c+'">'+s.b+'</span></td>';
    html += '<td style="font-family:monospace;font-size:12px">'+escapeHtml(s.s)+'</td>';
    html += '<td>'+escapeHtml(sn(s.s))+'</td>';
    html += '<td class="text-right '+r0c+'">'+s.r.toFixed(2)+'%</td>';
    html += '<td class="text-right">'+s.a.toFixed(2)+'%</td>';
    html += '<td class="text-right">'+share+'%</td>';
    html += '<td class="text-right">'+pct(s.ac)+'</td><td class="text-right">'+pct(s.oc)+'</td>';
    html += '<td class="text-right">'+pct(s.acb)+'</td><td class="text-right">'+pct(s.ocb)+'</td>';
    html += '<td class="text-right">'+fmt(s.ai)+'</td><td class="text-right">'+fmt(s.oi)+'</td><td class="text-right">'+fmt(s.ti)+'</td>';
    html += '<td class="text-right">'+fmt(s.ak)+'</td><td class="text-right">'+fmt(s.ok)+'</td>';
    html += '<td class="text-right">'+fmt(s.acn)+'</td><td class="text-right">'+fmt(s.ocn)+'</td></tr>';
  });
  html += '</tbody>';
  var tblStores = document.getElementById('table-stores');
  if (tblStores) tblStores.innerHTML = html;

  var totalPages = Math.ceil(total / pageSize);
  var pager = document.getElementById('sli-pager');
  if (pager) {
    if (totalPages > 1 && topn > 0) {
      pager.style.display = 'flex';
      pager.innerHTML = '<button onclick="sliPage--;renderStoreTables()"' + (sliPage===0?' disabled':'') + '>&#171; Prev</button><span>Page '+(sliPage+1)+' of '+totalPages+' ('+total+' stores)</span><button onclick="sliPage++;renderStoreTables()"'+(sliPage>=totalPages-1?' disabled':'')+'>Next &#187;</button>';
    } else { pager.style.display = 'none'; }
  }

  if (document.getElementById('sfc-gap-bucket-chart')) renderGapBucketDistribution(filtered, globalImp);
  if (document.getElementById('table-store-fold-compare')) renderStoreFoldCompare(page, globalImp, start);
  if (document.getElementById('sfc-gap-bucket-chart-f1bu')) renderGapBucketDistributionF1Bu(filtered, globalImp);
  if (document.getElementById('table-store-fold-compare-f1bu')) renderStoreFoldCompareF1Bu(page, globalImp, start);
}

function toggleSfcR0Detail() {
  sfcR0Detail = !sfcR0Detail;
  var b = document.getElementById('btn-sfc-r0');
  if (b) b.classList.toggle('active', sfcR0Detail);
  renderStoreTables();
}
function toggleSfcAisDetail() {
  sfcAisDetail = !sfcAisDetail;
  var b = document.getElementById('btn-sfc-ais');
  if (b) b.classList.toggle('active', sfcAisDetail);
  renderStoreTables();
}

function fmtSegR0(x) {
  if (!x || x.r0 == null) return '–';
  return Number(x.r0).toFixed(2) + '%';
}
function fmtSegAis(x) {
  if (!x) return '–';
  return Number(x.ais).toFixed(2) + '%';
}
function fmtPctPlain(n) {
  if (n == null || n === '' || isNaN(n)) return '–';
  return Number(n).toFixed(2) + '%';
}

/** Six metrics per segment (Overall / Fold 1): R0, AIS, ad/org CTR, ad/org CABN/clk. */
function foldCompareSixCellsForSeg(fc, segKey) {
  var x = fc ? fc[segKey] : null;
  var h = '';
  h += '<td class="text-right ' + r0LevelClass(x && x.r0) + '">' + fmtSegR0(x) + '</td>';
  h += '<td class="text-right">' + fmtSegAis(x) + '</td>';
  h += '<td class="text-right">' + fmtPctPlain(x && x.ads_ctr) + '</td>';
  h += '<td class="text-right">' + fmtPctPlain(x && x.org_ctr) + '</td>';
  h += '<td class="text-right">' + fmtPctPlain(x && x.ads_cabn_clk) + '</td>';
  h += '<td class="text-right">' + fmtPctPlain(x && x.org_cabn_clk) + '</td>';
  return h;
}

/**
 * R0 gap vs BU Fold1, gap bucket, Delta to CTR, Delta to CABN, Primary Factor — same markup as main Overall vs Fold 1 store table.
 * gapSplit from logVarianceCtrCvrPpSplitStoreF1VsBuFold1(fc, br, gap).
 */
function htmlF1BuAttributionCells(gap, gapSplit) {
  var gb = gapBucketSignedF1Bu(gap);
  var gcls = gapBucketCssClassF1Bu(gb);
  var priLab = '\u2013';
  var priCls = '';
  if (gapSplit) {
    if (gapSplit.driver === 'ctr') { priLab = 'CTR'; priCls = ' sfc-gap-pri-ctr'; }
    else if (gapSplit.driver === 'cvr') { priLab = 'CABN/clk'; priCls = ' sfc-gap-pri-cvr'; }
    else { priLab = 'Tie'; priCls = ' sfc-gap-pri-tie'; }
  }
  var h = '';
  h += '<td class="text-right ' + buDeltaClass(gap, 'r0') + '">' + (gap == null || isNaN(gap) ? '\u2013' : ((gap > 0 ? '+' : '') + gap.toFixed(2) + ' pp')) + '</td>';
  h += '<td class="' + gcls + '">' + escapeHtml(gb) + '</td>';
  h += '<td class="text-right ' + (gapSplit ? buDeltaClass(gapSplit.ctrPpImpact, 'r0') : '') + '">' +
    (!gapSplit ? '\u2013' : ((gapSplit.ctrPpImpact > 0 ? '+' : '') + gapSplit.ctrPpImpact.toFixed(2) + ' pp')) + '</td>';
  h += '<td class="text-right ' + (gapSplit ? buDeltaClass(gapSplit.cvrPpImpact, 'r0') : '') + '">' +
    (!gapSplit ? '\u2013' : ((gapSplit.cvrPpImpact > 0 ? '+' : '') + gapSplit.cvrPpImpact.toFixed(2) + ' pp')) + '</td>';
  h += '<td class="text-right' + priCls + '">' + priLab + '</td>';
  return h;
}

/** Gap-chart drill: bar → BU breakdown → top 20 stores per BU (by impression share). */
window._gapDrillCtx = null;

function gapBucketStoreDetailTableHtml(top, g) {
  var nCol = 16;
  var h = '<thead><tr><th>#</th><th>Store Id</th><th>Store Name</th><th class="text-right">Impr share %</th>';
  h += '<th class="text-right">Overall R0</th><th class="text-right">Fold 1 R0</th><th class="text-right">\u0394 (F1\u2212O) pp</th>';
  h += '<th class="text-right" title="Log-variance R0: larger |CTR_PP_Impact| vs |CVR_PP_Impact|">Driver</th>';
  h += '<th class="text-right">Ads CTR O</th><th class="text-right">Ads CTR F1</th>';
  h += '<th class="text-right">Org CTR O</th><th class="text-right">Org CTR F1</th>';
  h += '<th class="text-right">Ads CABN/clk O</th><th class="text-right">Ads CABN/clk F1</th>';
  h += '<th class="text-right">Org CABN/clk O</th><th class="text-right">Org CABN/clk F1</th>';
  h += '</tr></thead><tbody>';
  if (!top.length) {
    h += '<tr><td colspan="' + nCol + '" style="color:var(--text3)">No stores in this BU for the current bucket and filters.</td></tr>';
  } else {
    var split = { ctr: 0, cvr: 0, tie: 0, na: 0 };
    top.forEach(function(st, i) {
      var fc = getFoldCmpForStore(st);
      gapDriverCountIncr(split, fc);
      var d = fold1MinusOverallPp(fc);
      var share = g ? ((st.ti / g) * 100).toFixed(2) : '0';
      var o = fc && fc.o, f1 = fc && fc.f1;
      h += '<tr><td>' + (i + 1) + '</td>';
      h += '<td style="font-family:monospace;font-size:11px">' + escapeHtml(st.s) + '</td>';
      h += '<td>' + escapeHtml(sn(st.s)) + '</td>';
      h += '<td class="text-right">' + share + '%</td>';
      h += '<td class="text-right ' + r0LevelClass(o && o.r0) + '">' + fmtSegR0(o) + '</td>';
      h += '<td class="text-right ' + r0LevelClass(f1 && f1.r0) + '">' + fmtSegR0(f1) + '</td>';
      h += '<td class="text-right ' + buDeltaClass(d, 'r0') + '">' + (d == null || isNaN(d) ? '\u2013' : ((d > 0 ? '+' : '') + d.toFixed(2) + ' pp')) + '</td>';
      h += '<td class="text-right">' + gapDriverCellHtml(fc) + '</td>';
      h += '<td class="text-right">' + fmtPctPlain(o && o.ads_ctr) + '</td>';
      h += '<td class="text-right">' + fmtPctPlain(f1 && f1.ads_ctr) + '</td>';
      h += '<td class="text-right">' + fmtPctPlain(o && o.org_ctr) + '</td>';
      h += '<td class="text-right">' + fmtPctPlain(f1 && f1.org_ctr) + '</td>';
      h += '<td class="text-right">' + fmtPctPlain(o && o.ads_cabn_clk) + '</td>';
      h += '<td class="text-right">' + fmtPctPlain(f1 && f1.ads_cabn_clk) + '</td>';
      h += '<td class="text-right">' + fmtPctPlain(o && o.org_cabn_clk) + '</td>';
      h += '<td class="text-right">' + fmtPctPlain(f1 && f1.org_cabn_clk) + '</td>';
      h += '</tr>';
    });
    var n = top.length;
    h += '<tr style="border-top:1px solid var(--border)"><td colspan="' + nCol + '" style="font-size:11px;color:var(--text3);padding-top:10px">' +
      '<strong>Driver split</strong> (' + n + ' store' + (n === 1 ? '' : 's') + ' in this view): ' +
      '<span class="gap-drv-ctr">CTR ' + split.ctr + '</span> \u00b7 ' +
      '<span class="gap-drv-cvr">CVR ' + split.cvr + '</span> \u00b7 ' +
      '<span class="gap-drv-tie">Tie ' + split.tie + '</span> \u00b7 N/A ' + split.na +
      '</td></tr>';
  }
  h += '</tbody>';
  return h;
}

function toggleDetailColumns(element, type) {
  var table = element.closest('table');
  if (!table) return;
  
  // Toggle the detail columns
  var detailCols = table.querySelectorAll('.detail-cols.' + type + '-cols');
  var isVisible = detailCols.length > 0 && detailCols[0].style.display !== 'none';
  
  // Hide all detail columns first
  table.querySelectorAll('.detail-cols').forEach(function(col) {
    col.style.display = 'none';
  });
  
  // Show/hide the clicked type columns
  detailCols.forEach(function(col) {
    col.style.display = isVisible ? 'none' : '';
  });
  
  // Update arrow indicators
  table.querySelectorAll('.clickable-col').forEach(function(col) {
    var colType = col.getAttribute('onclick').match(/'([^']+)'/)[1];
    if (colType === type) {
      col.textContent = col.textContent.replace('↓', isVisible ? '↓' : '↑');
    } else {
      col.textContent = col.textContent.replace(/[↓↑]/, '↓');
    }
  });
}

function gapBucketStoreDetailTableHtmlF1Bu(top, g) {
  var h = '<table class="f1bu-detail-table"><thead><tr>';
  h += '<th rowspan="2">#</th>';
  h += '<th rowspan="2">BU</th>';
  h += '<th rowspan="2">Store_id</th>';
  h += '<th rowspan="2">Store_name</th>';
  h += '<th rowspan="2" class="text-right">FR</th>';
  h += '<th rowspan="2">FR Bucket</th>';
  h += '<th rowspan="2" class="text-right">Impre_share</th>';
  h += '<th rowspan="2" class="text-right">R0<br>Gap</th>';
  h += '<th rowspan="2">Gap<br>Bucket</th>';
  h += '<th rowspan="2" class="text-right">Gap Assigned<br>to CTR</th>';
  h += '<th rowspan="2" class="text-right">Gap Assigned<br>to CVR</th>';
  h += '<th rowspan="2" class="text-right">Primary<br>Factor</th>';
  h += '<th colspan="6" class="sfc-group">Store Fold 1</th><th colspan="6" class="sfc-group">BU Fold 1</th></tr>';
  h += '<tr><th class="text-right">R0</th><th class="text-right">AIS</th><th class="text-right">Ads CTR</th><th class="text-right">Org CTR</th><th class="text-right">Ads CABN/clk</th><th class="text-right">Org CABN/clk</th>';
  h += '<th class="text-right">R0</th><th class="text-right">AIS</th><th class="text-right">Ads CTR</th><th class="text-right">Org CTR</th><th class="text-right">Ads CABN/clk</th><th class="text-right">Org CABN/clk</th></tr></thead><tbody>';
  
  if (!top.length) {
    h += '<tr><td colspan="22" style="color:var(--text3)">No stores in this BU for the current bucket and filters.</td></tr>';
  } else {
    top.forEach(function(st, i) {
      var fc = getFoldCmpForStore(st);
      var br = getBuFold1CompareRow(st.b);
      var c = BU_COLORS[st.b] || '#64748b';
      var gap = storeFold1R0MinusBuFold1R0Pp(st);
      var gapSplit = (gap != null && !isNaN(gap) && fc && br) ? logVarianceCtrCvrPpSplitStoreF1VsBuFold1(fc, br, gap) : null;
      var frRow = getStoreFrJan2531(st);
      var frPct = frRow && frRow.fr != null && !isNaN(frRow.fr) ? frRow.fr : null;
      var frBuck = frRow && frRow.bucket ? frRow.bucket : 'N/A';
      var share = g ? ((st.ti / g) * 100).toFixed(2) : '0';
      
      h += '<tr><td>' + (i + 1) + '</td>';
      h += '<td><span class="bu-badge" style="background:' + c + '22;color:' + c + '">' + escapeHtml(st.b) + '</span></td>';
      h += '<td style="font-family:monospace;font-size:11px">' + escapeHtml(st.s) + '</td>';
      h += '<td>' + escapeHtml(sn(st.s)) + '</td>';
      h += '<td class="text-right">' + (frPct == null ? '\u2013' : frPct.toFixed(2) + '%') + '</td>';
      h += '<td class="' + frBucketCssClass(frBuck) + '">' + escapeHtml(frBuck) + '</td>';
      h += '<td class="text-right">' + share + '%</td>';
      h += htmlF1BuAttributionCells(gap, gapSplit);
      h += foldCompareSixCellsForSeg(fc, 'f1');
      h += buFold1SixCells(br);
      h += '</tr>';
    });
  }
  h += '</tbody></table>';
  return h;
}

function toggleColumnGroup(header, group) {
  var table = header.closest('table');
  if (!table) return;
  
  var isVisible = table.querySelector('.col-' + group).style.display !== 'none';
  
  table.querySelectorAll('.col-' + group).forEach(function(cell) {
    cell.style.display = isVisible ? 'none' : '';
  });
  
  // Update arrow indicator
  var arrow = isVisible ? '▼' : '▲';
  table.querySelectorAll('.col-' + group + '.clickable-header').forEach(function(h) {
    var currentText = h.textContent;
    h.textContent = currentText.replace(/[▼▲]/, arrow);
  });
}

function renderGapBucketBuModal() {
  var ctx = window._gapDrillCtx;
  if (!ctx) return;
  var g = ctx.g;
  var inBucket = ctx.inBucket;
  var modeF1bu = ctx.mode === 'f1bu';
  var modal = document.querySelector('#ct-modal-overlay .ct-modal');
  if (modal) {
    if (inBucket.length) modal.classList.add('ct-modal-wide');
    else modal.classList.remove('ct-modal-wide');
  }
  var buMap = {};
  inBucket.forEach(function(s) {
    if (!buMap[s.b]) {
      buMap[s.b] = { bu: s.b, count: 0, imp: 0, ctr: 0, cvr: 0, tie: 0, na: 0 };
    }
    var r = buMap[s.b];
    r.count++;
    r.imp += s.ti;
    if (modeF1bu) gapDriverCountIncrF1Bu(r, s);
    else gapDriverCountIncr(r, getFoldCmpForStore(s));
  });
  var rows = Object.values(buMap).sort(function(a, b) { return b.imp - a.imp; });
  var maxShare = rows.length ? (rows[0].imp / g * 100) : 1;

  document.getElementById('ct-modal-title').textContent =
    (modeF1bu ? 'Overall vs Fold 1 \u00b7 gap bucket: ' : 'Gap bucket: ') + ctx.bucket + ' \u2014 by BU';
  document.getElementById('ct-modal-subtitle').textContent =
    inBucket.length + ' store(s) with current filters. BU rows sorted by impression share. ' +
    (modeF1bu
      ? 'CTR / CABN\u00b7clk / Tie counts use log-variance split of the store vs BU Fold\u00a01 R0 gap (baseline = BU Fold\u00a01). Click a BU for top 20 stores.'
      : 'CTR/CVR/Tie counts use log-variance R0 attribution (same as store table Primary). Click a BU for top 20 stores.');

  var html = '<thead><tr><th>BU</th><th class="text-right">Stores</th>' +
    '<th class="text-right" title="Larger |CTR attributed pp|">CTR</th>' +
    '<th class="text-right" title="Larger |CABN/clk attributed pp|">' + (modeF1bu ? 'CABN/clk' : 'CVR') + '</th>' +
    '<th class="text-right">Tie</th><th class="text-right">N/A</th>' +
    '<th class="text-right">Impr share %</th></tr></thead><tbody>';
  rows.forEach(function(r) {
    var share = (r.imp / g * 100);
    var barW = maxShare > 0 ? Math.round(share / maxShare * 100) : 0;
    var c = BU_COLORS[r.bu] || '#64748b';
    html += '<tr class="bu-click" onclick=\'showGapBucketStoresForBu(' + JSON.stringify(r.bu) + ')\' style="cursor:pointer">' +
      '<td><span class="bu-badge" style="background:' + c + '22;color:' + c + '">' + escapeHtml(r.bu) + '</span>' +
      '<div class="ct-bar" style="width:' + barW + '%;background:' + c + '"></div></td>' +
      '<td class="text-right">' + r.count + '</td>' +
      '<td class="text-right"><span class="gap-drv-ctr">' + r.ctr + '</span></td>' +
      '<td class="text-right"><span class="gap-drv-cvr">' + r.cvr + '</span></td>' +
      '<td class="text-right"><span class="gap-drv-tie">' + r.tie + '</span></td>' +
      '<td class="text-right" style="color:var(--text3)">' + r.na + '</td>' +
      '<td class="text-right">' + share.toFixed(2) + '%</td></tr>';
  });
  if (!rows.length) {
    html += '<tr><td colspan="7" style="color:var(--text3)">No bucketed stores for this selection.</td></tr>';
  }
  html += '</tbody>';
  setCtModalTableHtml(html);
  var ex = document.getElementById('ct-modal-extras');
  if (ex) {
    if (inBucket.length) {
      ex.innerHTML =
        '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">' +
        '<p style="font-size:11px;color:var(--text3);margin:0;max-width:720px;line-height:1.55">' +
        (modeF1bu
        ? '<strong>Overall vs Fold 1 gap (log-variance)</strong> — Baseline = BU Fold&nbsp;1 ads/org CTR and CABN/click ratios; segment = store Fold&nbsp;1. ' +
          '<code>Total = R0_store(F1) \u2212 R0_BU(F1)</code> (pp). Split uses the same ratio math as the main gap view, scaled to that total. ' +
          'Each store is tagged <strong>CTR</strong> / <strong>CABN/clk</strong> / <strong>Tie</strong> by larger <code>|attributed pp|</code>; <strong>N/A</strong> if data missing.</p></div>'
        : '<strong>R0 attribution (log-variance)</strong> — Baseline = Overall, segment = Fold&nbsp;1. ' +
          '<code>Total_PP_Drop = R0(Overall) \u2212 R0(Fold\u00a01)</code>. ' +
          '<code>CTR_Ratio = Ads CTR / Org CTR</code>, <code>CVR_Ratio = Ads CVR / Org CVR</code> (CVR = CABN/click). ' +
          '<code>CTR_PP_Impact = (Log_Var_CTR/Sum)\u00d7Total_PP_Drop</code> (CVR analog). ' +
          'Each store is tagged <strong>CTR</strong> / <strong>CVR</strong> / <strong>Tie</strong> by larger <code>|attributed pp|</code> (or tie if ~equal / Sum\u22480); <strong>N/A</strong> if data missing.</p></div>');
    } else {
      ex.innerHTML = '';
    }
  }
  document.getElementById('ct-modal-overlay').classList.add('active');
}

function showGapBucketStoresForBu(bu) {
  var ctx = window._gapDrillCtx;
  if (!ctx) return;
  var g = ctx.g;
  var modeF1bu = ctx.mode === 'f1bu';
  var stores = ctx.inBucket.filter(function(s) { return s.b === bu; });
  stores.sort(function(a, b) { return b.ti - a.ti; });
  var top = stores.slice(0, 20);
  var modal = document.querySelector('#ct-modal-overlay .ct-modal');
  if (modal) modal.classList.add('ct-modal-wide');
  document.getElementById('ct-modal-title').textContent =
    (modeF1bu ? 'Overall vs Fold 1: ' : 'Gap: ') + ctx.bucket + ' — ' + bu + ' · top ' + (top.length ? Math.min(20, top.length) : 0) + ' by impr share';
  document.getElementById('ct-modal-subtitle').textContent =
    stores.length + ' store(s) in this BU and bucket; ranked by impression share % vs fold-slice overall total. Showing up to 20. ' +
    (modeF1bu
      ? 'We are comparing Store Level Fold 1 vs BU Level Fold 1 and CVR = CABN/Click. Primary Factor = CABN/clk vs CTR split for the store vs BU Fold\u00a01 gap; footer summarizes CTR / CABN\u00b7clk / Tie / N/A.'
      : 'Driver = same log-variance R0 tag as main table; footer summarizes CTR / CVR / Tie / N/A for rows above.');
  setCtModalTableHtml(modeF1bu ? gapBucketStoreDetailTableHtmlF1Bu(top, g) : gapBucketStoreDetailTableHtml(top, g));
  var drillTbl = document.getElementById('ct-modal-table');
  if (drillTbl && modeF1bu) drillTbl.classList.add('f1bu-drill-table');
  var ex = document.getElementById('ct-modal-extras');
  if (ex) {
    if (modeF1bu) {
      ex.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:14px">' +
        '<button type="button" class="csv-dl-btn" onclick="downloadTableCSV(\'ct-modal-table\',\'f1bu_gap_drill_stores.csv\')">Download CSV</button>' +
        '<button type="button" class="ts-btn" onclick="renderGapBucketBuModal()">\u2190 Back to BU list</button></div>';
    } else {
      ex.innerHTML = '<p style="margin-top:14px"><button type="button" class="ts-btn" onclick="renderGapBucketBuModal()">\u2190 Back to BU list</button></p>';
    }
  }
}

function openGapBucketStoresModal(bucketLabel, filtered, globalImp) {
  var g = globalImp != null && globalImp > 0 ? globalImp : ((PD().overall && PD().overall.all_impressions) || 1);
  var inBucket = filtered.filter(function(s) {
    var fc = getFoldCmpForStore(s);
    var d = fold1MinusOverallPp(fc);
    var buD = getBuDeltaPp(s.b);
    return gapBucketStoreMinusBu(buD, d) === bucketLabel;
  });
  window._gapDrillCtx = { bucket: bucketLabel, filtered: filtered, g: g, inBucket: inBucket, mode: 'f1delta' };
  renderGapBucketBuModal();
}

function openGapBucketStoresModalF1Bu(bucketLabel, filtered, globalImp) {
  var g = globalImp != null && globalImp > 0 ? globalImp : ((PD().overall && PD().overall.all_impressions) || 1);
  var inBucket = filtered.filter(function(s) {
    return gapBucketSignedF1Bu(storeFold1R0MinusBuFold1R0Pp(s)) === bucketLabel;
  });
  window._gapDrillCtx = { bucket: bucketLabel, filtered: filtered, g: g, inBucket: inBucket, mode: 'f1bu' };
  renderGapBucketBuModal();
}

function renderStoreFoldCompare(page, globalImp, start) {
  var tbl = document.getElementById('table-store-fold-compare');
  if (!tbl) return;
  var segs = [{ k: 'o', lab: 'Overall' }, { k: 'f1', lab: 'Fold 1' }];
  var r0OrgExtra = sfcR0Detail ? 2 : 0;
  var aisExtra = sfcAisDetail ? 2 : 0;
  var perSeg = 2 + 2 + r0OrgExtra + aisExtra;
  var h1 = '<tr><th rowspan="2">#</th>';
  h1 += sfcSortThRowspan2('b', 'BU');
  h1 += sfcSortThRowspan2('s', 'Store');
  h1 += sfcSortThRowspan2('sname', 'Store Name');
  h1 += sfcSortThRowspan2('share', 'Impr share %', 'text-right');
  h1 += sfcSortThRowspan2('sd', 'Store \u0394 (F1\u2212O) pp', 'text-right');
  h1 += sfcSortThRowspan2('bud', 'BU \u0394 (F1\u2212O) pp', 'text-right');
  h1 += sfcSortThRowspan2('bu_ms', 'Store \u2212 BU pp', 'text-right');
  h1 += sfcSortThRowspan2('gapk', 'Gap bucket');
  h1 += sfcSortThRowspan2('gap_ctr', '\u0394\u2192 CTR pp', 'text-right');
  h1 += sfcSortThRowspan2('gap_cvr', '\u0394\u2192 CVR pp', 'text-right');
  h1 += sfcSortThRowspan2('gap_pri', 'Primary', 'text-right');
  segs.forEach(function(sg) {
    h1 += '<th colspan="' + perSeg + '" class="sfc-group">' + escapeHtml(sg.lab) + '</th>';
  });
  h1 += '</tr><tr>';
  segs.forEach(function(sg) {
    var isO = sg.k === 'o';
    h1 += sfcSortThRow2(isO ? 'or0' : 'f1r0', 'R0 %');
    h1 += sfcSortThRow2(isO ? 'oais' : 'f1ais', 'AIS %');
    h1 += sfcSortThRow2(isO ? 'oadctr' : 'f1adctr', 'Ads CTR');
    h1 += sfcSortThRow2(isO ? 'oadscabn' : 'f1adscabn', 'Ads CABN/clk');
    if (sfcR0Detail) {
      h1 += sfcSortThRow2(isO ? 'oorgctr' : 'f1orgctr', 'Org CTR');
      h1 += sfcSortThRow2(isO ? 'oorgcabn' : 'f1orgcabn', 'Org CABN/clk');
    }
    if (sfcAisDetail) {
      h1 += '<th class="text-right">Ads imp</th><th class="text-right">Org imp</th>';
    }
  });
  h1 += '</tr>';
  var body = '';
  page.forEach(function(st, i) {
    var fc = getFoldCmpForStore(st);
    var d = fold1MinusOverallPp(fc);
    var buD = getBuDeltaPp(st.b);
    var gb = gapBucketStoreMinusBu(buD, d);
    var gcls = gapBucketCssClass(gb);
    var share = globalImp ? ((st.ti / globalImp) * 100).toFixed(2) : '0';
    var c = BU_COLORS[st.b] || '#64748b';
    var res = (d != null && !isNaN(d) && buD != null && !isNaN(buD)) ? (d - buD) : null;
    var gapSplit = (res != null && !isNaN(res) && fc) ? logVarianceCtrCvrPpSplit(fc, res) : null;
    var priLab = '\u2013';
    var priCls = '';
    if (gapSplit) {
      if (gapSplit.driver === 'ctr') { priLab = 'CTR'; priCls = ' sfc-gap-pri-ctr'; }
      else if (gapSplit.driver === 'cvr') { priLab = 'CVR'; priCls = ' sfc-gap-pri-cvr'; }
      else { priLab = 'Tie'; priCls = ' sfc-gap-pri-tie'; }
    }
    body += '<tr><td>' + (start + i + 1) + '</td>';
    body += '<td><span class="bu-badge" style="background:' + c + '22;color:' + c + '">' + escapeHtml(st.b) + '</span></td>';
    body += '<td style="font-family:monospace;font-size:11px">' + escapeHtml(st.s) + '</td>';
    body += '<td>' + escapeHtml(sn(st.s)) + '</td>';
    body += '<td class="text-right">' + share + '%</td>';
    body += '<td class="text-right ' + buDeltaClass(d, 'r0') + '">' + (d == null || isNaN(d) ? '\u2013' : ((d > 0 ? '+' : '') + d.toFixed(2) + ' pp')) + '</td>';
    body += '<td class="text-right ' + buDeltaClass(buD, 'r0') + '">' + (buD == null || isNaN(buD) ? '\u2013' : ((buD > 0 ? '+' : '') + buD.toFixed(2) + ' pp')) + '</td>';
    body += '<td class="text-right ' + buDeltaClass(res, 'r0') + '">' + (res == null || isNaN(res) ? '\u2013' : ((res > 0 ? '+' : '') + res.toFixed(2) + ' pp')) + '</td>';
    body += '<td class="' + gcls + '">' + escapeHtml(gb) + '</td>';
    body += '<td class="text-right ' + (gapSplit ? buDeltaClass(gapSplit.ctrPpImpact, 'r0') : '') + '">' +
      (!gapSplit ? '\u2013' : ((gapSplit.ctrPpImpact > 0 ? '+' : '') + gapSplit.ctrPpImpact.toFixed(2) + ' pp')) + '</td>';
    body += '<td class="text-right ' + (gapSplit ? buDeltaClass(gapSplit.cvrPpImpact, 'r0') : '') + '">' +
      (!gapSplit ? '\u2013' : ((gapSplit.cvrPpImpact > 0 ? '+' : '') + gapSplit.cvrPpImpact.toFixed(2) + ' pp')) + '</td>';
    body += '<td class="text-right' + priCls + '">' + priLab + '</td>';
    segs.forEach(function(sg) {
      var x = fc ? fc[sg.k] : null;
      body += '<td class="text-right ' + r0LevelClass(x && x.r0) + '">' + fmtSegR0(x) + '</td><td class="text-right">' + fmtSegAis(x) + '</td>';
      body += '<td class="text-right">' + fmtPctPlain(x && x.ads_ctr) + '</td>';
      body += '<td class="text-right">' + fmtPctPlain(x && x.ads_cabn_clk) + '</td>';
      if (sfcR0Detail) {
        body += '<td class="text-right">' + fmtPctPlain(x && x.org_ctr) + '</td>';
        body += '<td class="text-right">' + fmtPctPlain(x && x.org_cabn_clk) + '</td>';
      }
      if (sfcAisDetail) {
        body += '<td class="text-right">' + (x ? fmt(x.ai) : '–') + '</td>';
        body += '<td class="text-right">' + (x ? fmt(x.oi) : '–') + '</td>';
      }
    });
    body += '</tr>';
  });
  tbl.innerHTML = '<thead>' + h1 + '</thead><tbody>' + body + '</tbody>';
}

function buFold1SixCells(br) {
  var h = '';
  function pct(v) { return v != null ? Number(v).toFixed(2) + '%' : '\u2013'; }
  function raw(v) { return v != null ? Number(v).toFixed(2) : '\u2013'; }
  var r0 = br ? br.r0_fold1 : null;
  h += '<td class="text-right ' + r0LevelClass(r0) + '">' + pct(r0) + '</td>';
  h += '<td class="text-right">' + pct(br ? br.ais_fold1 : null) + '</td>';
  h += '<td class="text-right">' + pct(br ? br.ads_ctr_fold1 : null) + '</td>';
  h += '<td class="text-right">' + pct(br ? br.org_ctr_fold1 : null) + '</td>';
  h += '<td class="text-right">' + raw(br ? br.ads_cabn_clk_fold1 : null) + '</td>';
  h += '<td class="text-right">' + raw(br ? br.org_cabn_clk_fold1 : null) + '</td>';
  return h;
}

function renderStoreFoldCompareF1Bu(page, globalImp, start) {
  var tbl = document.getElementById('table-store-fold-compare-f1bu');
  if (!tbl) return;
  var segs = [{ k: 'f1', lab: 'Store Fold 1' }, { k: 'buf1', lab: 'BU Fold 1' }];
  var perSeg = 6;
  var h1 = '<tr><th rowspan="2">#</th>';
  h1 += sfcSortThRowspan2('b', 'BU');
  h1 += sfcSortThRowspan2('s', 'Store_id');
  h1 += sfcSortThRowspan2('sname', 'Store_name');
  h1 += sfcSortThRowspan2('fr_jan_pct', 'FR', 'text-right');
  h1 += sfcSortThRowspan2('fr_jan_buck', 'FR Bucket', '');
  h1 += sfcSortThRowspan2('share', 'Impre_share', 'text-right');
  h1 += sfcSortThRowspan2('f1bu_ms', 'R0<br>Gap', 'text-right');
  h1 += sfcSortThRowspan2('f1bu_gapk', 'Gap<br>Bucket');
  h1 += sfcSortThRowspan2('f1bu_ctr', 'Gap Assigned<br>to CTR', 'text-right');
  h1 += sfcSortThRowspan2('f1bu_cvr', 'Gap Assigned<br>to CVR', 'text-right');
  h1 += sfcSortThRowspan2('f1bu_pri', 'Primary<br>Factor', 'text-right');
  segs.forEach(function(sg) {
    h1 += '<th colspan="' + perSeg + '" class="sfc-group">' + escapeHtml(sg.lab) + '</th>';
  });
  h1 += '</tr><tr>';
  segs.forEach(function(sg) {
    var isO = sg.k === 'buf1';
    h1 += sfcSortThRow2(isO ? 'or0' : 'f1r0', 'R0');
    h1 += sfcSortThRow2(isO ? 'oais' : 'f1ais', 'AIS');
    h1 += sfcSortThRow2(isO ? 'oadctr' : 'f1adctr', 'Ads CTR');
    h1 += sfcSortThRow2(isO ? 'oorgctr' : 'f1orgctr', 'Org CTR');
    h1 += sfcSortThRow2(isO ? 'oadscabn' : 'f1adscabn', 'Ads CABN/clk');
    h1 += sfcSortThRow2(isO ? 'oorgcabn' : 'f1orgcabn', 'Org CABN/clk');
  });
  h1 += '</tr>';
  var body = '';
  page.forEach(function(st, i) {
    var fc = getFoldCmpForStore(st);
    var br = getBuFold1CompareRow(st.b);
    var gap = storeFold1R0MinusBuFold1R0Pp(st);
    var share = globalImp ? ((st.ti / globalImp) * 100).toFixed(2) : '0';
    var c = BU_COLORS[st.b] || '#64748b';
    var gapSplit = (gap != null && !isNaN(gap) && fc && br) ? logVarianceCtrCvrPpSplitStoreF1VsBuFold1(fc, br, gap) : null;
    var frRow = getStoreFrJan2531(st);
    var frPct = frRow && frRow.fr != null && !isNaN(frRow.fr) ? frRow.fr : null;
    var frBuck = frRow && frRow.bucket ? frRow.bucket : 'N/A';
    body += '<tr><td>' + (start + i + 1) + '</td>';
    body += '<td><span class="bu-badge" style="background:' + c + '22;color:' + c + '">' + escapeHtml(st.b) + '</span></td>';
    body += '<td style="font-family:monospace;font-size:11px">' + escapeHtml(st.s) + '</td>';
    body += '<td>' + escapeHtml(sn(st.s)) + '</td>';
    body += '<td class="text-right">' + (frPct == null ? '\u2013' : frPct.toFixed(2) + '%') + '</td>';
    body += '<td class="' + frBucketCssClass(frBuck) + '">' + escapeHtml(frBuck) + '</td>';
    body += '<td class="text-right">' + share + '%</td>';
    body += htmlF1BuAttributionCells(gap, gapSplit);
    body += foldCompareSixCellsForSeg(fc, 'f1');
    body += buFold1SixCells(br);
    body += '</tr>';
  });
  tbl.innerHTML = '<thead>' + h1 + '</thead><tbody>' + body + '</tbody>';
}

/* ── Multi-select ── */
function buildMultiSelect(wrapId, items, allLabel, onChange, getLabel, opts) {
  if (!onChange) onChange = function(){ sliPage=0; renderStoreTables(); };
  if (!getLabel) getLabel = function(v){ return v; };
  opts = opts || {};
  var wrap = document.getElementById(wrapId);
  if (!wrap) return;
  wrap.innerHTML = '';
  wrap.dataset.msAllLabel = allLabel;
  var toggle = document.createElement('div');
  toggle.className = 'ms-toggle'; toggle.textContent = allLabel;
  wrap.appendChild(toggle);
  var drop = document.createElement('div');
  drop.className = 'ms-drop';
  var allItem = document.createElement('label');
  allItem.className = 'ms-item ms-all';
  var allCb = document.createElement('input');
  allCb.type = 'checkbox'; allCb.checked = true;
  allItem.appendChild(allCb);
  allItem.appendChild(document.createTextNode(' ' + allLabel));
  drop.appendChild(allItem);
  var searchInp = null;
  if (opts.search) {
    searchInp = document.createElement('input');
    searchInp.type = 'search'; searchInp.className = 'ms-search';
    searchInp.placeholder = opts.searchPlaceholder || 'Search\u2026';
    searchInp.setAttribute('autocomplete','off');
    searchInp.addEventListener('click', function(e){e.stopPropagation();});
    drop.appendChild(searchInp);
  }
  var cbs = [], filterRows = [];
  items.forEach(function(val) {
    var lbl = document.createElement('label');
    lbl.className = 'ms-item';
    var cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = val; cb.checked = true;
    lbl.appendChild(cb);
    var nameSpan = document.createElement('span');
    nameSpan.className = 'ms-name'; nameSpan.textContent = getLabel(val);
    lbl.appendChild(nameSpan);
    var onlyBtn = document.createElement('span');
    onlyBtn.className = 'ms-only'; onlyBtn.textContent = 'only'; onlyBtn.setAttribute('data-val', val);
    lbl.appendChild(onlyBtn);
    drop.appendChild(lbl);
    cbs.push(cb);
    filterRows.push({val:val,el:lbl});
  });
  if (searchInp && filterRows.length) {
    searchInp.addEventListener('input', function(){
      var q = (searchInp.value||'').trim().toLowerCase();
      filterRows.forEach(function(fr){ fr.el.style.display = !q || String(fr.val).toLowerCase().indexOf(q)!==-1 ? '' : 'none'; });
    });
  }
  wrap.appendChild(drop);
  function updateLabel() {
    var checked = cbs.filter(function(c){return c.checked;});
    if (allCb.checked || checked.length === cbs.length) { toggle.textContent = allLabel; allCb.checked = true; cbs.forEach(function(c){c.checked=true;}); }
    else if (checked.length === 0) { toggle.textContent = 'None'; }
    else if (checked.length <= 2) { toggle.textContent = checked.map(function(c){return getLabel(c.value);}).join(', '); }
    else { toggle.textContent = checked.length + ' selected'; }
  }
  allCb.addEventListener('change', function(){ cbs.forEach(function(c){c.checked=allCb.checked;}); updateLabel(); onChange(); });
  cbs.forEach(function(cb){ cb.addEventListener('change', function(){ allCb.checked = cbs.filter(function(c){return c.checked;}).length === cbs.length; updateLabel(); onChange(); }); });
  drop.querySelectorAll('.ms-only').forEach(function(btn){
    btn.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); var tv=btn.getAttribute('data-val'); allCb.checked=false; cbs.forEach(function(c){c.checked=c.value===tv;}); updateLabel(); onChange(); });
  });
  toggle.addEventListener('click', function(e){ e.stopPropagation(); document.querySelectorAll('.ms-drop.open').forEach(function(d){if(d!==drop)d.classList.remove('open');}); var opening=!drop.classList.contains('open'); drop.classList.toggle('open'); if(opening&&searchInp) setTimeout(function(){searchInp.focus();},0); });
  drop.addEventListener('click', function(e){ e.stopPropagation(); });
}

function msRefreshToggleText(wrapId) {
  var wrap = document.getElementById(wrapId);
  if (!wrap) return;
  var toggle = wrap.querySelector('.ms-toggle');
  var allCb = wrap.querySelector('.ms-all input[type=checkbox]');
  var cbs = Array.prototype.slice.call(wrap.querySelectorAll('.ms-item:not(.ms-all) input[type=checkbox]'));
  var allLabel = wrap.dataset.msAllLabel || 'All';
  if (!toggle || !cbs.length) return;
  var checked = cbs.filter(function(c) { return c.checked; });
  if (checked.length === cbs.length) {
    toggle.textContent = allLabel;
    if (allCb) allCb.checked = true;
  } else if (checked.length === 0) {
    toggle.textContent = 'None';
    if (allCb) allCb.checked = false;
  } else if (checked.length <= 2) {
    if (allCb) allCb.checked = false;
    toggle.textContent = checked.map(function(c) {
      var name = c.closest('label').querySelector('.ms-name');
      return name ? name.textContent : c.value;
    }).join(', ');
  } else {
    if (allCb) allCb.checked = false;
    toggle.textContent = checked.length + ' selected';
  }
}

function msCopyChecks(fromId, toId) {
  var fromWrap = document.getElementById(fromId);
  var toWrap = document.getElementById(toId);
  if (!fromWrap || !toWrap) return;
  var fromCbs = fromWrap.querySelectorAll('.ms-item:not(.ms-all) input[type=checkbox]');
  var toCbs = toWrap.querySelectorAll('.ms-item:not(.ms-all) input[type=checkbox]');
  var fromByVal = {};
  Array.prototype.forEach.call(fromCbs, function(cb) { fromByVal[cb.value] = cb.checked; });
  Array.prototype.forEach.call(toCbs, function(cb) {
    if (Object.prototype.hasOwnProperty.call(fromByVal, cb.value)) cb.checked = fromByVal[cb.value];
  });
  var allCb = toWrap.querySelector('.ms-all input[type=checkbox]');
  if (allCb) {
    allCb.checked = toCbs.length > 0 && Array.prototype.every.call(toCbs, function(c) { return c.checked; });
  }
  msRefreshToggleText(toId);
}

function onSliFilterChange() {
  msCopyChecks('sli-bu', 'cmp-f-bu');
  msCopyChecks('sli-sname', 'cmp-f-sname');
  msCopyChecks('sli-r0', 'cmp-f-r0');
  msCopyChecks('sli-ais', 'cmp-f-ais');
  sliPage = 0;
  renderStoreTables();
}

function onCmpFilterChange() {
  msCopyChecks('cmp-f-bu', 'sli-bu');
  msCopyChecks('cmp-f-sname', 'sli-sname');
  msCopyChecks('cmp-f-r0', 'sli-r0');
  msCopyChecks('cmp-f-ais', 'sli-ais');
  sliPage = 0;
  renderStoreTables();
}

function initCmpDuplicateFilters() {
  if (!document.getElementById('cmp-f-bu')) return;
  buildMultiSelect('cmp-f-bu', BU_LIST, 'All BUs', onCmpFilterChange);
  var nameSet = {};
  (PD().ALL_STORES || []).forEach(function(s) { var n = sn(s.s); if (n) nameSet[n] = 1; });
  var names = Object.keys(nameSet).sort();
  buildMultiSelect('cmp-f-sname', names, 'All Stores', onCmpFilterChange, function(v) { return v; }, { search: true, searchPlaceholder: 'Search store name\u2026' });
  buildMultiSelect('cmp-f-r0', PD().r0_order, 'All R0', onCmpFilterChange);
  buildMultiSelect('cmp-f-ais', PD().ais_order, 'All AIS', onCmpFilterChange);
  if (document.getElementById('cmp-f-gap')) {
    buildMultiSelect('cmp-f-gap', SFC_GAP_BUCKETS, 'All gap buckets', onCmpFilterChange, function(v) { return v; });
  }
  if (document.getElementById('cmp-f-gap-f1bu')) {
    buildMultiSelect('cmp-f-gap-f1bu', SFC_GAP_BUCKETS_F1BU, 'All R0 gap buckets (Store to BU)', onCmpFilterChange, function(v) { return v; });
  }
  if (document.getElementById('cmp-f-fr-bucket')) {
    buildMultiSelect('cmp-f-fr-bucket', FR_BUCKET_FILTER_LIST, 'All FR buckets', onCmpFilterChange, function(v) { return v; });
  }
  msCopyChecks('sli-bu', 'cmp-f-bu');
  msCopyChecks('sli-sname', 'cmp-f-sname');
  msCopyChecks('sli-r0', 'cmp-f-r0');
  msCopyChecks('sli-ais', 'cmp-f-ais');
}

function msGetSelected(id) {
  var wrap = document.getElementById(id);
  if (!wrap) return [];
  var cbs = wrap.querySelectorAll('.ms-item:not(.ms-all) input');
  var sel = [];
  cbs.forEach(function(cb){ if(cb.checked) sel.push(cb.value); });
  return sel;
}

document.addEventListener('click', function(){ document.querySelectorAll('.ms-drop.open').forEach(function(d){d.classList.remove('open');}); });

function initSliFilters() {
  if (document.getElementById('sli-bu')) {
    buildMultiSelect('sli-bu', BU_LIST, 'All BUs', onSliFilterChange);
    var nameSet = {};
    (PD().ALL_STORES||[]).forEach(function(s){ var n=sn(s.s); if(n) nameSet[n]=1; });
    var names = Object.keys(nameSet).sort();
    buildMultiSelect('sli-sname', names, 'All Stores', onSliFilterChange, function(v){return v;}, {search:true, searchPlaceholder:'Search store name\u2026'});
    buildMultiSelect('sli-r0', PD().r0_order, 'All R0', onSliFilterChange);
    buildMultiSelect('sli-ais', PD().ais_order, 'All AIS', onSliFilterChange);
    var tn = document.getElementById('sli-topn');
    if (tn) tn.onchange = function(){ sliPage=0; renderStoreTables(); };
  }
  initCmpDuplicateFilters();
}

function downloadTableCSV(tableId, filename) {
  var t = document.getElementById(tableId); if(!t) return;
  var rows = t.querySelectorAll('tr');
  var csv = [];
  rows.forEach(function(row){
    var cols = row.querySelectorAll('th, td');
    var r = [];
    cols.forEach(function(c){ 
      var text = c.textContent.replace(/,/g,'').replace(/"/g,'""').trim();
      // Replace all NA variations with empty string
      if (text === '–' || text === '\u2013' || text === 'N/A' || text === 'NA' || text === '') {
        text = '';
      }
      r.push('"'+text+'"'); 
    });
    csv.push(r.join(','));
  });
  var blob = new Blob([csv.join('\n')], {type:'text/csv;charset=utf-8;'});
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}

/* ── Time Series ── */
var tsMode = 'weekly';
var tsMetric = 'r0ais';

function getSunSatWeek(ds) {
  var d = new Date(ds+'T00:00:00');
  var day = d.getDay();
  var sun = new Date(d); sun.setDate(d.getDate() - day);
  var jan1 = new Date(sun.getFullYear(), 0, 1);
  var dayOfYear = Math.floor((sun - jan1) / 86400000);
  var wk = Math.floor(dayOfYear / 7) + 1;
  return sun.getFullYear() + String(wk).padStart(2, '0');
}

function filterTsByDateRange(daily) {
  var from = document.getElementById('dr-from').value;
  var to = document.getElementById('dr-to').value;
  if (!from || !to) return daily;
  return daily.filter(function(d){ return d.date >= from && d.date <= to; });
}

function filterTsBuByDateRange(dailyBu) {
  var from = document.getElementById('dr-from').value;
  var to = document.getElementById('dr-to').value;
  if (!from || !to) return dailyBu;
  return dailyBu.filter(function(d){ return d.date >= from && d.date <= to; });
}

function aggregateWeekly(daily) {
  var wks = {};
  daily.forEach(function(d){
    var w = getSunSatWeek(d.date);
    if (!wks[w]) wks[w] = {week:w, ai:0, ti:0, rn:0, rd:0, acN:0, acD:0, ocN:0, ocD:0, abnN:0, abnD:0, obnN:0, obnD:0};
    wks[w].ai += d.ads_imp; wks[w].ti += d.all_imp;
    if (d.R0 != null) { wks[w].rn += d.R0 * d.all_imp; wks[w].rd += d.all_imp; }
    if (d.ads_CTR != null) { wks[w].acN += (d.ads_CTR/100)*d.ads_imp; wks[w].acD += d.ads_imp; }
    if (d.org_CTR != null) { var oi = d.all_imp - d.ads_imp; wks[w].ocN += (d.org_CTR/100)*oi; wks[w].ocD += oi; }
    if (d.ads_CABN != null) { var ak = (d.ads_CTR/100)*d.ads_imp; wks[w].abnN += (d.ads_CABN/100)*ak; wks[w].abnD += ak; }
    if (d.org_CABN != null) { var ok = (d.org_CTR/100)*(d.all_imp - d.ads_imp); wks[w].obnN += (d.org_CABN/100)*ok; wks[w].obnD += ok; }
  });
  return Object.values(wks).sort(function(a,b){return a.week<b.week?-1:1;}).map(function(w){
    return {label:w.week, R0:w.rd?Math.round(100*w.rn/w.rd)/100:null, AIS:w.ti?Math.round(10000*w.ai/w.ti)/100:0,
      ads_CTR:w.acD?Math.round(10000*w.acN/w.acD)/100:0, org_CTR:w.ocD?Math.round(10000*w.ocN/w.ocD)/100:0,
      ads_CABN:w.abnD?Math.round(10000*w.abnN/w.abnD)/100:0, org_CABN:w.obnD?Math.round(10000*w.obnN/w.obnD)/100:0};
  });
}

function aggregateWeeklyBU(dailyBu) {
  var m = {};
  dailyBu.forEach(function(d){
    var w = getSunSatWeek(d.date), k = w+'|'+d.bu;
    if (!m[k]) m[k] = {week:w, bu:d.bu, ti:0, ai:0, rn:0, rd:0, acN:0, acD:0, ocN:0, ocD:0, abnN:0, abnD:0, obnN:0, obnD:0};
    m[k].ti += d.all_imp; m[k].ai += (d.AIS/100)*d.all_imp;
    if (d.R0 != null) { m[k].rn += d.R0*d.all_imp; m[k].rd += d.all_imp; }
    var ai = (d.AIS/100)*d.all_imp, oi = d.all_imp - ai;
    if (d.ads_CTR != null) { m[k].acN += (d.ads_CTR/100)*ai; m[k].acD += ai; }
    if (d.org_CTR != null) { m[k].ocN += (d.org_CTR/100)*oi; m[k].ocD += oi; }
    if (d.ads_CABN != null) { var ak = (d.ads_CTR/100)*ai; m[k].abnN += (d.ads_CABN/100)*ak; m[k].abnD += ak; }
    if (d.org_CABN != null) { var ok = (d.org_CTR/100)*oi; m[k].obnN += (d.org_CABN/100)*ok; m[k].obnD += ok; }
  });
  return Object.values(m).map(function(x){return {label:x.week, bu:x.bu,
    R0:x.rd?Math.round(100*x.rn/x.rd)/100:null, AIS:x.ti?Math.round(10000*x.ai/x.ti)/100:0,
    ads_CTR:x.acD?Math.round(10000*x.acN/x.acD)/100:0, org_CTR:x.ocD?Math.round(10000*x.ocN/x.ocD)/100:0,
    ads_CABN:x.abnD?Math.round(10000*x.abnN/x.abnD)/100:0, org_CABN:x.obnD?Math.round(10000*x.obnN/x.obnD)/100:0};});
}

function setTsMode(mode) {
  tsMode = mode;
  document.getElementById('ts-weekly-btn').className = 'ts-btn'+(mode==='weekly'?' active':'');
  document.getElementById('ts-daily-btn').className = 'ts-btn'+(mode==='daily'?' active':'');
  renderTimeSeries();
}
function setTsMetric(m) {
  tsMetric = m;
  ['r0ais','ctr','cabn'].forEach(function(k){ document.getElementById('ts-metric-'+k).className = 'ts-btn'+(k===m?' active':''); });
  renderTimeSeries();
}

function renderTimeSeries() {
  var filteredDaily = filterTsByDateRange(TS_DAILY);
  var filteredBu = filterTsBuByDateRange(TS_DAILY_BU);
  var overallData, buArr;

  var effectiveMode = tsMode;
  if (tsMode === 'weekly' && filteredDaily.length <= 6) effectiveMode = 'daily';
  if (effectiveMode === 'weekly') {
    overallData = aggregateWeekly(filteredDaily);
    buArr = aggregateWeeklyBU(filteredBu);
  } else {
    overallData = filteredDaily.map(function(d){return {label:d.date, R0:d.R0, AIS:d.AIS, ads_CTR:d.ads_CTR, org_CTR:d.org_CTR, ads_CABN:d.ads_CABN, org_CABN:d.org_CABN};});
    buArr = filteredBu.map(function(d){return {label:d.date, bu:d.bu, R0:d.R0, AIS:d.AIS, ads_CTR:d.ads_CTR, org_CTR:d.org_CTR, ads_CABN:d.ads_CABN, org_CABN:d.org_CABN};});
  }
  var isSingle = overallData.length === 1;

  if (tsOverallChartInst) tsOverallChartInst.destroy();

  var mCfg;
  if (tsMetric === 'ctr') {
    mCfg = {title:'Overall CTR — Ads vs Organic', k1:'ads_CTR', k2:'org_CTR', l1:'Ads CTR %', l2:'Organic CTR %', c1:'#f59e0b', c2:'#10b981'};
  } else if (tsMetric === 'cabn') {
    mCfg = {title:'Overall CABN/Click — Ads vs Organic', k1:'ads_CABN', k2:'org_CABN', l1:'Ads CABN/Clk %', l2:'Organic CABN/Clk %', c1:'#f59e0b', c2:'#10b981'};
  } else {
    mCfg = {title:'Overall R0 & AIS', k1:'R0', k2:'AIS', l1:'R0 %', l2:'AIS %', c1:'#3b82f6', c2:'#f472b6'};
  }
  document.getElementById('ts-overall-title').textContent = mCfg.title;

  var labels = overallData.map(function(d){return d.label;});
  var d1 = overallData.map(function(d){return d[mCfg.k1];});
  var d2 = overallData.map(function(d){return d[mCfg.k2];});
  if (isSingle) { labels = ['', labels[0], '']; d1 = [null, d1[0], null]; d2 = [null, d2[0], null]; }

  var pr = 4, phr = 7;
  tsOverallChartInst = new Chart(document.getElementById('tsOverallChart').getContext('2d'), {
    type:'line', plugins:[ChartDataLabels], data:{labels:labels, datasets:[
      {label:mCfg.l1, data:d1, borderColor:mCfg.c1, backgroundColor:mCfg.c1+'14', pointRadius:pr, pointHoverRadius:phr, borderWidth:2.5, tension:0.3, fill:!isSingle, spanGaps:false,
        datalabels:{display:'auto',align:'top',color:mCfg.c1,font:{weight:'bold',size:11},formatter:function(v){return v!=null?Number(v).toFixed(2)+'%':'';}}},
      {label:mCfg.l2, data:d2, borderColor:mCfg.c2, backgroundColor:mCfg.c2+'14', pointRadius:pr, pointHoverRadius:phr, borderWidth:2.5, tension:0.3, fill:!isSingle, spanGaps:false,
        datalabels:{display:'auto',align:'bottom',color:mCfg.c2,font:{weight:'bold',size:11},formatter:function(v){return v!=null?Number(v).toFixed(2)+'%':'';}}}
    ]}, options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:20,bottom:10}},
      plugins:{legend:{position:'bottom'},datalabels:{},tooltip:{mode:'index',intersect:false,callbacks:{label:function(ctx){return ctx.raw!=null?ctx.dataset.label+': '+Number(ctx.raw).toFixed(2)+'%':'';}}}},
      scales:{y:{title:{display:true,text:'Percentage'},grid:{color:'rgba(71,85,105,0.2)'},ticks:{callback:function(v){return v+'%';}}},
        x:{grid:{display:false},ticks:{maxRotation:45,autoSkip:true,maxTicksLimit:15}}}
    }
  });

  // Small multiples: one card per BU
  buSmCharts.forEach(function(c){ c.destroy(); });
  buSmCharts = [];

  var wkLabels = [], seen = {};
  buArr.forEach(function(d){ if(!seen[d.label]){seen[d.label]=1;wkLabels.push(d.label);} });
  wkLabels.sort();

  var smK1 = mCfg.k1, smK2 = mCfg.k2, smL1 = mCfg.l1.replace(' %',''), smL2 = mCfg.l2.replace(' %','');
  var smC1 = mCfg.c1, smC2 = mCfg.c2;
  var smLabels = isSingle ? ['', wkLabels[0] || '', ''] : wkLabels;

  var grid = document.getElementById('bu-sm-grid');
  grid.innerHTML = '';
  BU_LIST.forEach(function(bu) {
    var byL1 = {}, byL2 = {};
    buArr.filter(function(d){return d.bu===bu;}).forEach(function(d){ byL1[d.label]=d[smK1]; byL2[d.label]=d[smK2]; });
    var bd1 = wkLabels.map(function(l){return byL1[l]!=null?byL1[l]:null;});
    var bd2 = wkLabels.map(function(l){return byL2[l]!=null?byL2[l]:null;});
    if (isSingle) { bd1 = [null, bd1[0] != null ? bd1[0] : null, null]; bd2 = [null, bd2[0] != null ? bd2[0] : null, null]; }
    var last1 = bd1.filter(function(v){return v!=null;});
    var last2 = bd2.filter(function(v){return v!=null;});
    var cur1 = last1.length ? last1[last1.length-1] : 0;
    var cur2 = last2.length ? last2[last2.length-1] : 0;

    var card = document.createElement('div');
    card.className = 'bu-sm-card';
    var col = BU_COLORS[bu] || '#64748b';
    card.innerHTML = '<div class="bu-sm-header"><span class="bu-sm-name" style="color:'+col+'">'+bu+'</span><span class="bu-sm-vals">'+smL1+' <span style="color:'+smC1+'">'+cur1.toFixed(1)+'%</span> · '+smL2+' <span style="color:'+smC2+'">'+cur2.toFixed(1)+'%</span></span></div><div class="bu-sm-chart"><canvas></canvas></div>';
    grid.appendChild(card);

    var canvas = card.querySelector('canvas');
    var smPr = 2, smPhr = 5;
    var ch = new Chart(canvas.getContext('2d'), {
      type:'line', data:{labels:smLabels, datasets:[
        {label:smL1, data:bd1, borderColor:smC1, backgroundColor:smC1+'10', borderWidth:2, pointRadius:smPr, pointHoverRadius:smPhr, tension:0.35, fill:!isSingle, spanGaps:false},
        {label:smL2, data:bd2, borderColor:smC2, backgroundColor:smC2+'10', borderWidth:2, pointRadius:smPr, pointHoverRadius:smPhr, tension:0.35, fill:!isSingle, spanGaps:false}
      ]}, options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},datalabels:{display:isSingle?true:false,align:'top',color:'#94a3b8',font:{weight:'bold',size:10},formatter:function(v){return v!=null?Number(v).toFixed(1)+'%':'';}},tooltip:{mode:'index',intersect:false,callbacks:{label:function(ctx){return ctx.raw!=null?ctx.dataset.label+': '+Number(ctx.raw).toFixed(2)+'%':'';}}}},
        scales:{y:{grid:{color:'rgba(71,85,105,0.15)',drawBorder:false},ticks:{font:{size:10},callback:function(v){return v+'%';}}},
          x:{grid:{display:false},ticks:{font:{size:9},maxRotation:0,autoSkip:true,maxTicksLimit:5}}}
      }
    });
    buSmCharts.push(ch);
  });

  /* ── Time Series Insights (metric-aware) ── */
  var tsBox = document.getElementById('ts-overall-insight');
  var tsInsightData = overallData.filter(function(d){ return !/^2025/.test(d.label); });
  if (tsBox && tsInsightData.length >= 2) {
    var first = tsInsightData[0], last = tsInsightData[tsInsightData.length - 1];
    var msgs = [];

    if (tsMetric === 'r0ais') {
      var r0D = last.R0 - first.R0, aisD = last.AIS - first.AIS;
      var r0Dir = r0D > 0.5 ? 'improved' : r0D < -0.5 ? 'declined' : 'remained stable';
      var aisDir = aisD > 0.5 ? 'increased' : aisD < -0.5 ? 'decreased' : 'remained stable';
      msgs.push('R0 <strong>' + r0Dir + '</strong> from <strong>' + first.R0.toFixed(2) + '%</strong> (' + first.label + ') to <strong>' + last.R0.toFixed(2) + '%</strong> (' + last.label + '), shift of <strong>' + (r0D > 0 ? '+' : '') + r0D.toFixed(2) + ' pp</strong>.');
      msgs.push('AIS <strong>' + aisDir + '</strong>: <strong>' + first.AIS.toFixed(2) + '%</strong> → <strong>' + last.AIS.toFixed(2) + '%</strong> (' + (aisD > 0 ? '+' : '') + aisD.toFixed(2) + ' pp).');
      if (r0D < -0.5) {
        var ctrD = (last.ads_CTR||0) - (first.ads_CTR||0);
        var cabnD = (last.ads_CABN||0) - (first.ads_CABN||0);
        var components = [];
        if (ctrD < -0.05) components.push('Ads CTR dropped <strong>' + ctrD.toFixed(2) + ' pp</strong> (' + (first.ads_CTR||0).toFixed(2) + '% → ' + (last.ads_CTR||0).toFixed(2) + '%)');
        if (cabnD < -0.05) components.push('Ads CABN/Click dropped <strong>' + cabnD.toFixed(2) + ' pp</strong> (' + (first.ads_CABN||0).toFixed(2) + '% → ' + (last.ads_CABN||0).toFixed(2) + '%)');
        if (aisD > 0.5) components.push('AIS increased by <strong>' + aisD.toFixed(2) + ' pp</strong> — higher ad density may dilute relevance');
        if (components.length) {
          msgs.push('<span style="color:#ef4444">&#9888; R0 decline root causes: ' + components.join('; ') + '.</span>');
        } else {
          msgs.push('<span style="color:#ef4444">&#9888; R0 is trending down — check fold-level position distribution for top-impression stores.</span>');
        }
      }
      if (aisD > 2) msgs.push('<span style="color:#f59e0b">&#9888; AIS rising significantly — check if ad density is hurting user experience.</span>');
    } else if (tsMetric === 'ctr') {
      var acD = (last.ads_CTR||0) - (first.ads_CTR||0), ocD = (last.org_CTR||0) - (first.org_CTR||0);
      var gapF = (first.org_CTR||0) - (first.ads_CTR||0), gapL = (last.org_CTR||0) - (last.ads_CTR||0);
      msgs.push('Ads CTR moved from <strong>' + (first.ads_CTR||0).toFixed(2) + '%</strong> to <strong>' + (last.ads_CTR||0).toFixed(2) + '%</strong> (' + (acD>0?'+':'') + acD.toFixed(2) + ' pp). Organic CTR: <strong>' + (first.org_CTR||0).toFixed(2) + '%</strong> → <strong>' + (last.org_CTR||0).toFixed(2) + '%</strong> (' + (ocD>0?'+':'') + ocD.toFixed(2) + ' pp).');
      msgs.push('CTR gap (Organic − Ads): <strong>' + (gapF*100).toFixed(0) + ' bps</strong> → <strong>' + (gapL*100).toFixed(0) + ' bps</strong>.');
      if (gapL > gapF + 0.1) msgs.push('<span style="color:#ef4444">&#9888; CTR gap is widening — ad click-through is falling behind organic. Review ad creative quality and ranking relevance.</span>');
      if (gapL < gapF - 0.1) msgs.push('<span style="color:#10b981">&#10003; CTR gap is narrowing — ads are becoming more competitive with organic results.</span>');
      if (acD < -0.1) msgs.push('<span style="color:#ef4444">Action: Ads CTR is declining — investigate if ad creative fatigue or poor targeting is the cause.</span>');
    } else {
      var abD = (last.ads_CABN||0) - (first.ads_CABN||0), obD = (last.org_CABN||0) - (first.org_CABN||0);
      var gapBF = (first.org_CABN||0) - (first.ads_CABN||0), gapBL = (last.org_CABN||0) - (last.ads_CABN||0);
      msgs.push('Ads CABN/Click: <strong>' + (first.ads_CABN||0).toFixed(2) + '%</strong> → <strong>' + (last.ads_CABN||0).toFixed(2) + '%</strong> (' + (abD>0?'+':'') + abD.toFixed(2) + ' pp). Organic: <strong>' + (first.org_CABN||0).toFixed(2) + '%</strong> → <strong>' + (last.org_CABN||0).toFixed(2) + '%</strong> (' + (obD>0?'+':'') + obD.toFixed(2) + ' pp).');
      msgs.push('CABN gap (Organic − Ads): <strong>' + (gapBF*100).toFixed(0) + ' bps</strong> → <strong>' + (gapBL*100).toFixed(0) + ' bps</strong>.');
      if (gapBL > gapBF + 0.1) msgs.push('<span style="color:#ef4444">&#9888; CABN gap is widening — ad clicks are converting to cart-adds at a lower rate. Review product relevance and landing page quality.</span>');
      if (gapBL < gapBF - 0.1) msgs.push('<span style="color:#10b981">&#10003; CABN gap is narrowing — ad post-click experience is improving.</span>');
      if (abD < -0.1) msgs.push('<span style="color:#ef4444">Action: Ads CABN/Click is declining — check if ad-product mismatch or pricing issues are reducing add-to-cart rates.</span>');
    }
    tsBox.innerHTML = msgs.join(' ');
  } else if (tsBox) { tsBox.innerHTML = ''; }

  /* ── BU-Level Trend Insights (metric-aware) ── */
  var buBox = document.getElementById('ts-bu-insight');
  var buInsightLabels = wkLabels.filter(function(l){ return !/^2025/.test(l); });
  if (buBox && buInsightLabels.length >= 2) {
    var buDeltas = [];
    BU_LIST.forEach(function(bu) {
      var bd = buArr.filter(function(d){return d.bu===bu && !/^2025/.test(d.label);}).sort(function(a,b){return a.label<b.label?-1:1;});
      if (bd.length < 2) return;
      var bf = bd[0], bl = bd[bd.length - 1];
      buDeltas.push({bu:bu,
        d1: (bl[smK1]||0) - (bf[smK1]||0), v1f: bf[smK1]||0, v1l: bl[smK1]||0,
        d2: (bl[smK2]||0) - (bf[smK2]||0), v2f: bf[smK2]||0, v2l: bl[smK2]||0,
        acD: (bl.ads_CTR||0)-(bf.ads_CTR||0), abD: (bl.ads_CABN||0)-(bf.ads_CABN||0)
      });
    });
    if (buDeltas.length) {
      var msgs2 = [];
      if (tsMetric === 'r0ais') {
        buDeltas.sort(function(a,b){return a.d1-b.d1;});
        var worst = buDeltas[0], best = buDeltas[buDeltas.length-1];
        msgs2.push('<strong>' + best.bu + '</strong> had the best R0 gain (' + (best.d1>0?'+':'') + best.d1.toFixed(2) + ' pp), <strong>' + worst.bu + '</strong> had the largest R0 drop (' + worst.d1.toFixed(2) + ' pp).');
        if (worst.d1 < -1) {
          var causes = [];
          if (worst.acD < -0.05) causes.push('Ads CTR fell ' + worst.acD.toFixed(2) + ' pp');
          if (worst.abD < -0.05) causes.push('Ads CABN/Click fell ' + worst.abD.toFixed(2) + ' pp');
          if (worst.d2 > 0.5) causes.push('AIS rose ' + worst.d2.toFixed(1) + ' pp');
          if (causes.length) msgs2.push('<span style="color:#ef4444">&#9888; ' + worst.bu + ' R0 decline driven by: ' + causes.join(', ') + '. Switch to CTR/CABN views for details.</span>');
          else msgs2.push('<span style="color:#ef4444">Action: Investigate ' + worst.bu + ' — check fold position and listing quality.</span>');
        }
        var risingAIS = buDeltas.filter(function(d){return d.d2>2;}).map(function(d){return '<strong>'+d.bu+'</strong> (+'+d.d2.toFixed(1)+' pp)';});
        if (risingAIS.length) msgs2.push('BUs with rising AIS: ' + risingAIS.join(', ') + ' — monitor ad load.');
      } else if (tsMetric === 'ctr') {
        buDeltas.sort(function(a,b){return a.d1-b.d1;});
        var worstCtr = buDeltas[0], bestCtr = buDeltas[buDeltas.length-1];
        msgs2.push('<strong>' + bestCtr.bu + '</strong> had the best Ads CTR gain (' + (bestCtr.d1>0?'+':'') + bestCtr.d1.toFixed(2) + ' pp), <strong>' + worstCtr.bu + '</strong> had the largest drop (' + worstCtr.d1.toFixed(2) + ' pp).');
        var wideningGap = buDeltas.filter(function(d){return (d.d2-d.d1)>0.15;}).map(function(d){return '<strong>'+d.bu+'</strong>';});
        if (wideningGap.length) msgs2.push('<span style="color:#ef4444">CTR gap widening in: ' + wideningGap.join(', ') + ' — ads losing ground vs organic.</span>');
      } else {
        buDeltas.sort(function(a,b){return a.d1-b.d1;});
        var worstCabn = buDeltas[0], bestCabn = buDeltas[buDeltas.length-1];
        msgs2.push('<strong>' + bestCabn.bu + '</strong> had the best Ads CABN gain (' + (bestCabn.d1>0?'+':'') + bestCabn.d1.toFixed(2) + ' pp), <strong>' + worstCabn.bu + '</strong> had the largest drop (' + worstCabn.d1.toFixed(2) + ' pp).');
        var wideningCabn = buDeltas.filter(function(d){return (d.d2-d.d1)>0.15;}).map(function(d){return '<strong>'+d.bu+'</strong>';});
        if (wideningCabn.length) msgs2.push('<span style="color:#ef4444">CABN gap widening in: ' + wideningCabn.join(', ') + ' — ad post-click conversion lagging organic.</span>');
      }
      buBox.innerHTML = msgs2.join(' ');
    } else { buBox.innerHTML = ''; }
  } else if (buBox) { buBox.innerHTML = ''; }
}

/* ── Query-Level AIS ── */
var QUERY_ROWS = [];
var qaiAisDistChartInstance = null;
var qaiDistDrillTop30 = null;
var qaiDistDrillBucket = '';
var qaiPage = 0;
var qaiSortCol = null, qaiSortDir = 1;
function qaiSortBy(col) {
  if (qaiSortCol === col) { qaiSortDir *= -1; } else { qaiSortCol = col; qaiSortDir = 1; }
  qaiPage = 0; renderQueryAisTable();
}
var QAI_PAGE_SIZE = 30;

var _storeAisMap = null;
function getStoreAisBucket(storeId) {
  if (!_storeAisMap) {
    _storeAisMap = {};
    (PD().ALL_STORES || []).forEach(function(s) { _storeAisMap[s.s] = s.a; });
  }
  var ais = _storeAisMap[storeId];
  return ais != null ? qaiAisBucketFromPct(ais) : '';
}

function qaiStoreDisplay(row) {
  var nm = row.nm;
  if (nm != null && String(nm).trim() !== '') return String(nm).trim();
  return sn(row.s);
}

function qaiSortAisBuckets(keys) {
  var ord = PD().ais_order || [];
  return keys.sort(function(a,b){
    var ia=ord.indexOf(a), ib=ord.indexOf(b);
    if(ia===-1&&ib===-1) return String(a).localeCompare(String(b));
    if(ia===-1) return 1; if(ib===-1) return -1;
    return ia-ib;
  });
}

function qaiAisBucketFromPct(ais) {
  if(isNaN(ais)) ais=0;
  if(ais<5)return'<5%'; if(ais<15)return'5–15%'; if(ais<25)return'15–25%';
  if(ais<30)return'25–30%'; if(ais<35)return'30–35%'; if(ais<40)return'35–40%';
  if(ais<45)return'40–45%'; if(ais<50)return'45–50%'; if(ais<60)return'50–60%';
  return'>60%';
}

function qaiDistQueryAisBucket(row) {
  var order=PD().ais_order||[];
  var ais=typeof row.a==='number'?row.a:parseFloat(row.a); if(isNaN(ais)) ais=0;
  var abRaw=row.ab!=null&&String(row.ab).trim()!==''?String(row.ab).trim():'';
  if(abRaw&&order.indexOf(abRaw)>=0) return abRaw;
  return qaiAisBucketFromPct(ais);
}

function qaiFilteredRows() {
  var buSel=msGetSelected('qai-bu'), storeSel=msGetSelected('qai-store');
  var storeAisSel=msGetSelected('qai-store-ais-bucket'), queryAisSel=msGetSelected('qai-query-ais-bucket');
  var inp=document.getElementById('qai-query-search');
  var qSearch=(inp&&inp.value||'').trim().toLowerCase();
  return QUERY_ROWS.filter(function(row){
    if(buSel&&buSel.indexOf(row.b)===-1) return false;
    if(storeSel&&storeSel.indexOf(row.s)===-1) return false;
    var sab=getStoreAisBucket(row.s);
    if(storeAisSel&&storeAisSel.indexOf(sab)===-1) return false;
    var ais=typeof row.a==='number'?row.a:parseFloat(row.a); if(isNaN(ais)) ais=0;
    var ab=qaiAisBucketFromPct(ais);
    if(queryAisSel&&queryAisSel.indexOf(ab)===-1) return false;
    if(qSearch&&String(row.q).toLowerCase().indexOf(qSearch)===-1) return false;
    return true;
  });
}

function qaiDistFilteredRows() {
  var buSel=msGetSelected('qai-dist-bu'), storeSel=msGetSelected('qai-dist-store');
  var storeAisSel=msGetSelected('qai-dist-store-ais');
  return QUERY_ROWS.filter(function(row){
    if(buSel&&buSel.indexOf(row.b)===-1) return false;
    if(storeSel&&storeSel.indexOf(row.s)===-1) return false;
    var sab=getStoreAisBucket(row.s);
    if(storeAisSel&&storeAisSel.indexOf(sab)===-1) return false;
    return true;
  });
}

function qaiDistComputeSeries() {
  var order=['<5%','5–15%','15–25%','25–30%','30–35%','35–40%','40–45%','45–50%','50–60%','>60%'];
  var rows=qaiDistFilteredRows();
  var sets={}, impByBucket={};
  order.forEach(function(b){sets[b]=new Set(); impByBucket[b]=0;});
  var totalImp=0;
  rows.forEach(function(row){
    var ab=qaiDistQueryAisBucket(row); if(order.indexOf(ab)===-1) return;
    var imp=row.all|0; totalImp+=imp; sets[ab].add(row.q); impByBucket[ab]+=imp;
  });
  return {labels:order.slice(), counts:order.map(function(b){return sets[b].size;}), imprPct:order.map(function(b){return totalImp>0?(impByBucket[b]/totalImp)*100:0;})};
}

function renderQaiDistChart() {
  var canvas=document.getElementById('qaiAisDistChart');
  if(!canvas) return;
  var series=qaiDistComputeSeries();
  if(qaiAisDistChartInstance){qaiAisDistChartInstance.destroy(); qaiAisDistChartInstance=null;}
  var labels=series.labels;
  qaiAisDistChartInstance=new Chart(canvas.getContext('2d'),{
    type:'bar', plugins:[ChartDataLabels], data:{labels:labels, datasets:[{
      label:'Count of Query', data:series.counts, order:0,
      backgroundColor:BUCKET_COLORS.map(function(c){return c+'99';}), borderColor:BUCKET_COLORS,
      borderWidth:1, borderRadius:6, yAxisID:'y',
      datalabels:{anchor:'end',align:'end',color:'#e2e8f0',font:{weight:'bold',size:12},formatter:function(v){return v;}}
    },{
      label:'Impression Share', data:series.imprPct, type:'line', order:1,
      borderColor:'#f472b6', backgroundColor:'transparent',
      pointRadius:6, pointHoverRadius:8, pointBackgroundColor:'#f472b6',
      pointBorderWidth:2, pointBorderColor:'#0f172a', borderWidth:3, yAxisID:'y1', tension:0.35, fill:false,
      datalabels:{display:false}
    }]}, options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:25}},
      onClick:function(evt,el){if(!el.length||el[0].datasetIndex!==0)return; showQaiDistDrilldown(labels[el[0].index]);},
      plugins:{legend:{position:'bottom'},datalabels:{},tooltip:{callbacks:{label:function(ctx){if(ctx.dataset.yAxisID==='y1')return ctx.dataset.label+': '+Number(ctx.raw).toFixed(2)+'%'; return ctx.dataset.label+': '+ctx.raw;}}}},
      scales:{y:{beginAtZero:true,title:{display:true,text:'Count of Query'},grid:{color:'rgba(71,85,105,0.2)'}},
        y1:{position:'right',beginAtZero:true,title:{display:true,text:'Impression Share'},grid:{drawOnChartArea:false},ticks:{callback:function(v){return Number(v).toFixed(2)+'%';}}},
        x:{grid:{display:false}}}
    }
  });
}

function initQaiDistChartFilters(bus,stores,sabs) {
  var wbu=document.getElementById('qai-dist-bu'),ws=document.getElementById('qai-dist-store'),wstab=document.getElementById('qai-dist-store-ais');
  if(!wbu||!ws||!wstab)return;
  wbu.innerHTML=''; ws.innerHTML=''; wstab.innerHTML='';
  buildMultiSelect('qai-dist-bu',bus,'All BUs',function(){renderQaiDistChart();},function(v){return v;});
  buildMultiSelect('qai-dist-store',stores,'All store IDs',function(){renderQaiDistChart();},function(v){return v;},{search:true,searchPlaceholder:'Search store IDs\u2026'});
  buildMultiSelect('qai-dist-store-ais',sabs,'All store AIS',function(){renderQaiDistChart();},function(v){return v;});
  renderQaiDistChart();
}

function showQaiDistDrilldown(bucket) {
  qaiDistDrillBucket=bucket||'';
  var rows=qaiDistFilteredRows(), byq={};
  rows.forEach(function(row){
    var ab=qaiDistQueryAisBucket(row); if(ab!==bucket) return;
    var qk=row.q; if(!byq[qk]) byq[qk]={q:qk,imp:0,aisW:0};
    var ais=typeof row.a==='number'?row.a:parseFloat(row.a); if(isNaN(ais)) ais=0;
    var w=row.all|0; byq[qk].imp+=w; byq[qk].aisW+=ais*w;
  });
  var arr=Object.keys(byq).map(function(k){var o=byq[k];return{q:o.q,imp:o.imp,avgAis:o.imp>0?o.aisW/o.imp:0};});
  arr.sort(function(a,b){return b.imp-a.imp;});
  var top=arr.slice(0,30); qaiDistDrillTop30=top;

  document.getElementById('ct-modal-title').textContent=top.length?('Top '+Math.min(30,top.length)+' queries — '+bucket):('No queries — '+bucket);
  document.getElementById('ct-modal-subtitle').textContent=top.length?'Ranked by total impressions. Chart filters apply.':'No queries in this bucket for the current chart filters.';
  var html='<thead><tr><th>#</th><th>QUERY</th><th class="text-right">ALL IMPRESSIONS</th><th class="text-right">AVG AIS %</th></tr></thead><tbody>';
  top.forEach(function(r,i){html+='<tr><td>'+(i+1)+'</td><td>'+escapeHtml(r.q)+'</td><td class="text-right">'+fmt(r.imp)+'</td><td class="text-right">'+r.avgAis.toFixed(2)+'%</td></tr>';});
  html+='</tbody>';
  setCtModalTableHtml(html);
  var ex=document.getElementById('ct-modal-extras');
  if(ex){if(top.length){ex.innerHTML='<div style="text-align:center;margin:14px 0 0"><button type="button" class="csv-dl-btn" id="qai-dist-drill-csv">&#11015; Download top 30 (CSV)</button></div>';var btn=document.getElementById('qai-dist-drill-csv');if(btn)btn.onclick=downloadQaiDistDrillCSV;}else{ex.innerHTML='';}}
  document.getElementById('ct-modal-overlay').classList.add('active');
}

function downloadQaiDistDrillCSV() {
  var top=qaiDistDrillTop30; if(!top||!top.length) return;
  function esc(s){s=String(s==null?'':s);if(/[",\n\r]/.test(s))return'"'+s.replace(/"/g,'""')+'"';return s;}
  var lines=[esc('Rank')+','+esc('Query')+','+esc('All impressions')+','+esc('Avg AIS %')];
  top.forEach(function(r,i){lines.push([esc(String(i+1)),esc(r.q),esc(fmt(r.imp)),esc(r.avgAis.toFixed(2)+'%')].join(','));});
  var safe=String(qaiDistDrillBucket||'bucket').replace(/%/g,'pct').replace(/[^\w.-]+/g,'_').replace(/^_|_$/g,'')||'bucket';
  var blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8;'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='query_ais_top30_'+safe+'.csv';a.click();URL.revokeObjectURL(a.href);
}

function updateQaiPager(totalFiltered) {
  var el=document.getElementById('qai-pager'); if(!el)return;
  if(totalFiltered===0){el.style.display='none';el.innerHTML='';return;}
  var pages=Math.max(1,Math.ceil(totalFiltered/QAI_PAGE_SIZE));
  if(qaiPage>=pages) qaiPage=pages-1; if(qaiPage<0) qaiPage=0;
  el.style.display='flex';
  var from=qaiPage*QAI_PAGE_SIZE+1, to=Math.min(totalFiltered,(qaiPage+1)*QAI_PAGE_SIZE);
  el.innerHTML='<button type="button" id="qai-prev"'+(qaiPage<=0?' disabled':'')+'>Previous</button>'
    +'<span>Page '+(qaiPage+1)+' of '+pages+' &middot; rows '+from+'–'+to+' of '+totalFiltered+'</span>'
    +'<button type="button" id="qai-next"'+(qaiPage>=pages-1?' disabled':'')+'>Next</button>';
  var prev=document.getElementById('qai-prev'),next=document.getElementById('qai-next');
  if(prev) prev.onclick=function(){if(qaiPage>0){qaiPage--;renderQueryAisTable(true);}};
  if(next) next.onclick=function(){if(qaiPage<pages-1){qaiPage++;renderQueryAisTable(true);}};
}

function renderQueryAisTable(fromPager) {
  var tbl=document.getElementById('table-query-ais'); if(!tbl) return;
  function qh(key,label,cls){
    var arrow=qaiSortCol===key?(qaiSortDir===1?' &#9650;':' &#9660;'):'';
    return '<th'+(cls?' class="'+cls+'"':'')+' style="cursor:pointer;white-space:nowrap" onclick="qaiSortBy(\''+key+'\')">'+label+arrow+'</th>';
  }
  var th='<th>#</th>'+qh('b','BU')+qh('q','Query')+qh('s','Store ID')+qh('sname','Store Name')+qh('sab','Store AIS bucket')+qh('a','Query AIS %','text-right')+qh('ab','Query AIS bucket')+qh('org','Organic impressions','text-right')+qh('ads','Ads impressions','text-right')+qh('all','All impressions','text-right');
  if(QUERY_ROWS.length===0){tbl.innerHTML='<thead><tr>'+th+'</tr></thead><tbody><tr><td colspan="11" style="color:var(--text2)">No data loaded.</td></tr></tbody>';qaiPage=0;updateQaiPager(0);return;}
  var filtered=qaiFilteredRows();
  if(qaiSortCol){
    var dir=qaiSortDir;
    filtered.sort(function(a,b){
      var va,vb;
      switch(qaiSortCol){
        case 'b': va=a.b;vb=b.b; return String(va).localeCompare(String(vb))*dir;
        case 'q': va=a.q;vb=b.q; return String(va).localeCompare(String(vb))*dir;
        case 's': va=a.s;vb=b.s; return String(va).localeCompare(String(vb))*dir;
        case 'sname': va=qaiStoreDisplay(a);vb=qaiStoreDisplay(b); return String(va).localeCompare(String(vb))*dir;
        case 'sab': va=getStoreAisBucket(a.s);vb=getStoreAisBucket(b.s); return String(va).localeCompare(String(vb))*dir;
        case 'ab': va=qaiAisBucketFromPct(typeof a.a==='number'?a.a:parseFloat(a.a)||0);vb=qaiAisBucketFromPct(typeof b.a==='number'?b.a:parseFloat(b.a)||0); return String(va).localeCompare(String(vb))*dir;
        case 'a': va=typeof a.a==='number'?a.a:parseFloat(a.a)||0;vb=typeof b.a==='number'?b.a:parseFloat(b.a)||0; return (va-vb)*dir;
        case 'org': va=a.org||0;vb=b.org||0; return (va-vb)*dir;
        case 'ads': va=a.ads||0;vb=b.ads||0; return (va-vb)*dir;
        case 'all': va=a.all||0;vb=b.all||0; return (va-vb)*dir;
        default: return 0;
      }
    });
  } else {
    filtered.sort(function(a,b){return(b.all|0)-(a.all|0);});
  }
  if(filtered.length===0){tbl.innerHTML='<thead><tr>'+th+'</tr></thead><tbody><tr><td colspan="11" style="color:var(--text2)">No rows match filters.</td></tr></tbody>';qaiPage=0;updateQaiPager(0);return;}
  var pages=Math.max(1,Math.ceil(filtered.length/QAI_PAGE_SIZE));
  if(fromPager!==true) qaiPage=0;
  if(qaiPage>=pages) qaiPage=pages-1;
  var rowStart=qaiPage*QAI_PAGE_SIZE;
  var slice=filtered.slice(rowStart,rowStart+QAI_PAGE_SIZE);
  var html='<thead><tr>'+th+'</tr></thead><tbody>';
  slice.forEach(function(row,i){
    var bu=row.b, col=BU_COLORS[bu]||'#64748b';
    var ais=typeof row.a==='number'?row.a:parseFloat(row.a); if(isNaN(ais)) ais=0;
    var all=row.all|0, org=row.org!=null?(row.org|0):0, adim=row.ads!=null?(row.ads|0):0;
    var ab=qaiAisBucketFromPct(ais);
    var sab=getStoreAisBucket(row.s);
    html+='<tr><td>'+(rowStart+i+1)+'</td>'
      +'<td><span class="bu-badge" style="background:'+col+'22;color:'+col+'">'+escapeHtml(bu)+'</span></td>'
      +'<td>'+escapeHtml(row.q)+'</td>'
      +'<td style="font-family:monospace;font-size:12px">'+escapeHtml(row.s)+'</td>'
      +'<td>'+escapeHtml(qaiStoreDisplay(row))+'</td>'
      +'<td>'+escapeHtml(sab)+'</td>'
      +'<td class="text-right">'+ais.toFixed(2)+'%</td>'
      +'<td>'+escapeHtml(ab)+'</td>'
      +'<td class="text-right">'+fmt(org)+'</td>'
      +'<td class="text-right">'+fmt(adim)+'</td>'
      +'<td class="text-right">'+fmt(all)+'</td></tr>';
  });
  html+='</tbody>'; tbl.innerHTML=html;
  updateQaiPager(filtered.length);
}

function downloadQueryAisCSV() {
  var rows=qaiFilteredRows();
  function esc(s){s=String(s==null?'':s);if(/[",\n\r]/.test(s))return'"'+s.replace(/"/g,'""')+'"';return s;}
  var lines=['BU,store_id,store_name,store_AIS_bucket,query,AIS_pct,AIS_bucket,all_impressions,ads_impressions,organic_impressions'];
  rows.sort(function(a,b){return(b.all|0)-(a.all|0);});
  rows.forEach(function(row){
    var ais=typeof row.a==='number'?row.a:parseFloat(row.a); if(isNaN(ais)) ais=0;
    var ab=qaiAisBucketFromPct(ais);
    var sab=getStoreAisBucket(row.s);
    lines.push([esc(row.b),esc(row.s),esc(qaiStoreDisplay(row)),esc(sab),esc(row.q),esc(ais.toFixed(4)),esc(ab),esc(String(row.all|0)),esc(String(row.ads!=null?(row.ads|0):0)),esc(String(row.org!=null?(row.org|0):0))].join(','));
  });
  var blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8;'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='query_level_ais_filtered.csv';a.click();URL.revokeObjectURL(a.href);
}

function initQueryAisFilters() {
  if (!document.getElementById('qai-bu')) return;
  var buSet={},storeSet={},sabSet={},abSet={};
  QUERY_ROWS.forEach(function(r){
    buSet[r.b]=1; storeSet[r.s]=1;
    var sabi=getStoreAisBucket(r.s); if(sabi) sabSet[sabi]=1;
    var ais=typeof r.a==='number'?r.a:parseFloat(r.a); if(isNaN(ais)) ais=0;
    var abi=qaiAisBucketFromPct(ais); if(abi) abSet[abi]=1;
  });
  var bus=Object.keys(buSet).sort(), stores=Object.keys(storeSet).sort();
  var sabs=qaiSortAisBuckets(Object.keys(sabSet)), abs=qaiSortAisBuckets(Object.keys(abSet));
  buildMultiSelect('qai-bu',bus,'All BUs',function(){renderQueryAisTable();},function(v){return v;});
  buildMultiSelect('qai-store',stores,'All store IDs',function(){renderQueryAisTable();},function(v){return v;},{search:true,searchPlaceholder:'Search store IDs\u2026'});
  buildMultiSelect('qai-store-ais-bucket',sabs,'All store AIS',function(){renderQueryAisTable();},function(v){return v;});
  buildMultiSelect('qai-query-ais-bucket',abs,'All query AIS',function(){renderQueryAisTable();},function(v){return v;});
  initQaiDistChartFilters(bus,stores,sabs);
  var qs=document.getElementById('qai-query-search');
  if(qs&&!qs._qaiBound){qs._qaiBound=true; qs.addEventListener('input',function(){renderQueryAisTable();});}
  var dl=document.getElementById('qai-download-csv');
  if(dl) dl.onclick=downloadQueryAisCSV;
}

function csvRecordsToQueryRows(records) {
  return(records||[]).map(function(row){
    var a=parseFloat(row.AIS_pct);
    var abRaw=row.AIS_bucket!=null?String(row.AIS_bucket).trim():'';
    var sabRaw=row.store_AIS_bucket!=null?String(row.store_AIS_bucket).trim():'';
    return{b:(row.BU!=null?String(row.BU):'').trim(),s:(row.store_id!=null?String(row.store_id):'').trim(),
      nm:row.store_name!=null?String(row.store_name):'',sab:sabRaw,q:row.query!=null?String(row.query):'',
      a:a,ab:qaiAisBucketFromPct(a),
      org:row.organic_impressions!=null&&row.organic_impressions!==''?(parseInt(row.organic_impressions,10)||0):0,
      ads:row.ads_impressions!=null&&row.ads_impressions!==''?(parseInt(row.ads_impressions,10)||0):0,
      all:parseInt(row.all_impressions,10)||0};
  }).filter(function(r){return r.b&&r.s;});
}

function applyQueryAisRows(rows) {
  var list=rows||[];
  list.sort(function(a,b){return(b.all|0)-(a.all|0);});
  QUERY_ROWS=list;
  initQueryAisFilters();
  renderQueryAisTable();
}

(function loadQueryAisData() {
  var pre=typeof window!=='undefined'&&window.__QUERY_AIS_PRELOAD__;
  if(pre&&pre.length){applyQueryAisRows(pre);return;}
  renderQueryAisTable();
})();

/* ── Init ── */
bindFoldSliceSelect();
renderAll();
maybeRenderTimeSeries();
