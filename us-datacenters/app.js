/* Mines & Megawatts — US data centers mockup. No secrets. */
'use strict';
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const CONUS = [[-124.9, 24.4], [-66.7, 49.5]];
const EXCL = new Set(['withdrawn', 'rejected']);
const STATUS_LABEL = {
  operating: 'Operating',
  under_construction: 'Under construction',
  permitted: 'Permitted',
  proposed: 'Proposed',
  unknown: 'Not stated',
  withdrawn: 'Withdrawn',
  rejected: 'Rejected'
};
const STATUS_ORDER = ['operating','under_construction','permitted','proposed','unknown','withdrawn','rejected'];
const A = (href, t) => `<a href="${href}" target="_blank" rel="noopener">${t}</a>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (n, d=0) => n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('en-US', {maximumFractionDigits:d, minimumFractionDigits:d});
const money = (usd) => {
  if (usd == null || Number.isNaN(usd)) return '—';
  const a = Math.abs(usd);
  if (a >= 1e12) return '$' + fmt(usd/1e12, 2) + '<small>T</small>';
  if (a >= 1e9) return '$' + fmt(usd/1e9, 1) + '<small>B</small>';
  if (a >= 1e6) return '$' + fmt(usd/1e6, 0) + '<small>M</small>';
  return '$' + fmt(usd, 0);
};
const fmtMw = (mw) => mw >= 1000 ? fmt(mw/1000, 1) + '<small> GW</small>' : fmt(mw, mw >= 100 ? 0 : 1) + '<small> MW</small>';
const phone = () => matchMedia('(max-width:760px)').matches;

let STATS, STATES, DCS, map, popup;
let selState = null;
let statusOn = {operating:true, under_construction:true, permitted:true, proposed:true, unknown:true, withdrawn:false, rejected:false};

function isOn(status){ return !!statusOn[status || 'unknown']; }

function agg(abbr){
  const rows = STATS.roster.filter(r => isOn(r.status) && (!abbr || r.state === abbr));
  const n = rows.length, n_pin = rows.reduce((a,r)=>a+(r.pin?1:0),0);
  const withMw = rows.filter(r => r.mw);
  const mw = withMw.reduce((a,r)=>a+r.mw, 0);
  let cost = 0;
  if (abbr){
    const st = STATS.states[abbr];
    if (st) cost = mw * 1000 * 8760 * 0.5 * st.rate_usd_kwh;
  } else {
    const by = {};
    for (const r of withMw){ if(!r.state) continue; by[r.state]=(by[r.state]||0)+r.mw; }
    for (const [st, smw] of Object.entries(by)){
      const s = STATS.states[st];
      if (s) cost += smw * 1000 * 8760 * 0.5 * s.rate_usd_kwh;
    }
  }
  return {n, n_pin, n_mw: withMw.length, mw, cost};
}

function stateMwMap(){
  const m = {};
  for (const abbr of Object.keys(STATS.states)) m[abbr] = {n:0, mw:0, n_mw:0};
  for (const r of STATS.roster){
    if (!isOn(r.status) || !r.state || !m[r.state]) continue;
    m[r.state].n++;
    if (r.mw){ m[r.state].mw += r.mw; m[r.state].n_mw++; }
  }
  return m;
}

function top5from(mapMw){
  return Object.entries(mapMw)
    .map(([abbr, v]) => ({abbr, name: STATS.states[abbr]?.name || abbr, ...v}))
    .sort((a,b) => b.mw - a.mw || b.n - a.n)
    .slice(0, 5);
}

function paintStates(){
  if (!map || !map.getSource('states')) return;
  const m = stateMwMap();
  for (const [abbr, v] of Object.entries(m)){
    map.setFeatureState({source:'states', id:abbr}, {mw: v.mw, n: v.n, sel: abbr === selState ? 1 : 0});
  }
}

function filteredDc(){
  return {type:'FeatureCollection', features: DCS.features.filter(f => isOn(f.properties.status) && (!selState || f.properties.state === selState))};
}

function applyDcData(){
  const src = map.getSource('dc');
  if (src) src.setData(filteredDc());
}

function fillColorExpr(){
  const breaks = STATS.breaks, ramp = STATS.colors.ramp;
  const step = ['step', ['coalesce', ['feature-state','mw'], -1], STATS.colors.zero];
  // -1 (unset) and 0 both go to zero-color; 'none' (n=0) handled separately
  const expr = ['case',
    ['==', ['coalesce', ['feature-state','n'], 0], 0], STATS.colors.none,
    ['==', ['coalesce', ['feature-state','mw'], 0], 0], STATS.colors.zero
  ];
  const stepExpr = ['step', ['feature-state','mw'], ramp[0]];
  for (let i=0;i<breaks.length;i++) stepExpr.push(breaks[i], ramp[i+1] || ramp[ramp.length-1]);
  expr.push(stepExpr);
  return expr;
}

function renderCards(){
  const a = agg(selState);
  const place = selState ? (STATS.states[selState]?.name || selState) : 'United States';
  const rateNote = selState
    ? `${fmt(STATS.states[selState].rate_cents, 2)}¢/kWh ${STATS.states[selState].rate_sector} · ${A(STATS.method.rate_url, 'EIA')}`
    : `sum of state estimates · ${A(STATS.method.rate_url, 'EIA')}`;
  const C = (c,l,v,s) => `<div class="card" style="--c:${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  $('#cards').innerHTML =
    C('var(--dc)', 'Data centers', fmt(a.n), `${place} · ${fmt(a.n_pin)} on the map`) +
    C('#e07b39', 'Stated capacity', fmtMw(a.mw), `${fmt(a.n_mw)} of ${fmt(a.n)} have a stated MW ⚠`) +
    C('var(--warn)', 'Est. annual power cost<span class="est">estimate</span>', money(a.cost), `50% load · ${rateNote}`);
  const scope = $('#scope');
  if (selState){
    scope.classList.add('on');
    scope.innerHTML = `<button type="button" id="btn-us">← United States</button>`;
    $('#btn-us').onclick = () => selectState(null);
  } else {
    scope.classList.remove('on');
    scope.innerHTML = '';
  }
  document.title = selState
    ? `${STATS.states[selState].name} data centers · Mines & Megawatts (Mockup)`
    : 'Mines & Megawatts · US data centers (Mockup)';
}

function renderTop5(){
  const rows = top5from(stateMwMap());
  const max = rows[0]?.mw || 1;
  const html = rows.map((s,i) => `<li><button type="button" data-st="${s.abbr}" class="${s.abbr===selState?'on':''}">
    <span class="rk">${i+1}</span><span class="nm">${esc(s.name)}</span>
    <span class="mw">${s.mw>=1000?fmt(s.mw/1000,1)+' GW':fmt(s.mw,0)+' MW'}</span>
    <small>${fmt(s.n)} campuses · ${fmt(s.n_mw)} with stated MW</small>
    <span class="barrow"><i style="width:${Math.max(4, s.mw/max*100)}%"></i></span>
  </button></li>`).join('');
  $('#top5-list').innerHTML = html;
  const mob = $('#top5-mobile');
  if (mob) mob.innerHTML = `<h3 style="margin:8px 0 6px;font-size:13px">Top 5 states <small style="color:var(--tx2);font-weight:400">by stated MW</small></h3><ol>${html}</ol>`;
  $$('#top5-list button, #top5-mobile button').forEach(b => b.onclick = () => selectState(b.dataset.st));
}

function renderFilters(){
  const counts = {};
  for (const r of STATS.roster) counts[r.status] = (counts[r.status]||0)+1;
  $('#status-filters').innerHTML = STATUS_ORDER.map(s =>
    `<button type="button" class="chip ${statusOn[s]?'on':''}" data-st="${s}">${STATUS_LABEL[s]}<span class="n">${fmt(counts[s]||0)}</span></button>`
  ).join('');
  $$('#status-filters .chip').forEach(b => b.onclick = () => {
    statusOn[b.dataset.st] = !statusOn[b.dataset.st];
    b.classList.toggle('on', statusOn[b.dataset.st]);
    refresh();
  });
  const breaks = STATS.breaks, ramp = STATS.colors.ramp;
  const labels = ['1', ...breaks.map(b => b >= 1000 ? (b/1000)+'k' : String(b)), (breaks[breaks.length-1]/1000)+'k+'];
  $('#legend-ramp').innerHTML = `<div class="ramp">
    <div class="cap">Stated MW by state</div>
    <div class="bar">${ramp.map(c=>`<i style="background:${c}"></i>`).join('')}</div>
    <div class="lbl"><span>${labels[0]} MW</span><span>higher</span></div>
    <div class="swatch"><i style="background:${STATS.colors.zero}"></i>Campuses, no stated MW</div>
    <div class="swatch"><i style="background:${STATS.colors.none}"></i>No campuses in the current filter</div>
  </div>`;
}

function refresh(){
  paintStates();
  applyDcData();
  renderCards();
  renderTop5();
}

function fitPlace(abbr){
  if (!abbr){
    map.fitBounds(CONUS, {padding: phone() ? {top:110,left:12,right:12,bottom:190} : {top:24,left:290,right:320,bottom:40}, duration: 700});
    return;
  }
  const b = STATS.states[abbr]?.bbox;
  if (!b) return;
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], {
    padding: phone() ? {top:110,left:20,right:20,bottom:200} : {top:40,left:300,right:330,bottom:50},
    duration: 800, maxZoom: abbr === 'AK' ? 4.2 : 7.5
  });
}

function selectState(abbr){
  selState = abbr || null;
  closeDetail();
  refresh();
  fitPlace(selState);
}

function closeDetail(){
  const el = $('#detail');
  el.hidden = true; el.innerHTML = '';
  document.body.classList.remove('detail-open');
}

function openDetail(p, lngLat){
  const st = STATS.states[p.state];
  const rate = st ? st.rate_usd_kwh : null;
  const cost = (p.mw && rate) ? p.mw * 1000 * 8760 * 0.5 * rate : null;
  const kwh = p.mw ? p.mw * 1000 * 8760 * 0.5 : null;
  document.body.classList.add('detail-open');
  const el = $('#detail');
  el.hidden = false;
  el.innerHTML = `
    <button type="button" class="iconbtn x" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    <div class="kicker">${esc(st?.name || p.state || '')} · data center</div>
    <h2>${esc(p.name)}</h2>
    <div><span class="pill ${esc(p.status)}">${esc(STATUS_LABEL[p.status] || p.status)}</span></div>
    <dl class="kv">
      <dt>Operator</dt><dd>${p.operator ? esc(p.operator) + (p.operatorHow === 'as-listed' || p.operatorHow === 'applicant' ? ' <span class="note" style="display:inline">as listed ⚠</span>' : '') : 'Not stated'}</dd>
      <dt>Stated MW</dt><dd>${p.mw != null ? fmt(p.mw, p.mw>=100?0:1) + ' MW <span class="note" style="display:inline">(source-reported' + (p.mwKind ? ', ' + esc(p.mwKind) : '') + ') ⚠</span>' : 'Not stated'}</dd>
      <dt>County</dt><dd>${p.county ? esc(p.county) : '—'}${p.city ? ' · ' + esc(p.city) : ''}</dd>
      <dt>Location</dt><dd>${esc(p.loc || 'unspecified')} precision</dd>
    </dl>
    ${cost != null ? `<div class="estbox"><div class="h">Estimated annual power cost</div>
      <div class="big">${money(cost)}</div>
      <div class="m">${fmt(kwh/1e9, 2)} TWh/yr at 50% load × ${fmt(st.rate_cents, 2)}¢/kWh (${st.rate_sector} avg, ${esc(st.name)}, EIA Aug 2026). This is an estimate, not a filed cost. Large customers often have their own contracts.</div></div>` : `<p class="note">No stated MW, so no cost estimate is shown.</p>`}
    <p class="note">Source: ${A(p.srcUrl, 'DataCentersNearMe')} (${esc(p.license || 'ODbL 1.0')}${p.srcDate ? ', ' + esc(p.srcDate) : ''}).</p>`;
  $('.x', el).onclick = closeDetail;
  if (lngLat && map){
    if (popup) popup.remove();
    popup = new maplibregl.Popup({closeButton:false, offset:8}).setLngLat(lngLat).setHTML(`<b>${esc(p.name)}</b>`).addTo(map);
  }
}

function showAbout(){
  const u = STATS.us, m = STATS.method, s = STATS.sources;
  $('#about').hidden = false;
  $('#about').innerHTML = `<div class="in"><button class="iconbtn x" style="position:absolute;right:8px;top:8px" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    <h2 style="margin-top:0">Sources, licenses and method</h2>
    <p>This is a <b>mockup</b> of a nationwide data-center map in the Mines &amp; Megawatts style. It is not the West Virginia app and is not linked from that menu. For information only. Not for engineering, legal, or investment decisions.</p>
    <table><thead><tr><th>Layer</th><th>Source</th><th>License</th></tr></thead><tbody>
      <tr><td>Data center campuses</td><td>${A(s.campuses.url, 'DataCentersNearMe')} redistributable download (${s.campuses.records} campuses, generated ${(s.campuses.generatedAt||'').slice(0,10)}; ${s.campuses.withheld} withheld)</td><td>ODbL 1.0</td></tr>
      <tr><td>State electricity rates</td><td>${A(s.rates.url, 'EIA Electric Power Monthly Table 5.6.A')}, ${s.rates.month} (${s.rates.status})</td><td>US public domain</td></tr>
      <tr><td>State boundaries</td><td>${A(s.states.url, 'U.S. Census Bureau')} cartographic boundary, 2024, 1:20,000,000</td><td>US public domain</td></tr>
      <tr><td>Basemap</td><td>${A('https://openfreemap.org','OpenFreeMap')} / OpenMapTiles, © OpenStreetMap contributors</td><td>ODbL / free</td></tr>
    </tbody></table>
    <p>The campus file is a derived ODbL database and is published next to this page as ${A('data/datacenters_odbl.geojson','datacenters_odbl.geojson')} with ${A('data/ATTRIBUTION.txt','ATTRIBUTION.txt')}. © OpenStreetMap contributors (${A('https://www.openstreetmap.org/copyright','copyright')}). If you republish a database built from it, share it under the ${A('https://opendatacommons.org/licenses/odbl/1-0/','ODbL')} too.</p>
    <h3>How the estimate is built</h3>
    <p>${esc(m.formula)}. The 50% load factor follows the ${A(m.lbnl_url, 'LBNL 2024 US data center energy usage report')}. Rates are each state's EIA industrial average; the national total is the sum of those state estimates, not one US rate.</p>
    <h3>Caveats ⚠</h3>
    <ul>${STATS.caveats.map(c=>`<li>${esc(c)}</li>`).join('')}</ul>
    <p class="note">Default view (Nov 16, 2026): ${fmt(u.n_active)} campuses (${fmt(u.n_pin_active)} pinned), ${fmt(u.n_mw_active)} with stated MW totaling ${fmt(u.mw_active)} MW. Withdrawn and rejected are off until you turn them on. West Virginia map: ${A('https://minesandmegawatts.com/','minesandmegawatts.com')}.</p>
  </div>`;
  $('.x', $('#about')).onclick = () => { $('#about').hidden = true; };
  $('#about').onclick = (e) => { if (e.target.id === 'about') $('#about').hidden = true; };
}

function statusFilters(){
  // used by tests
  return {...statusOn};
}

async function boot(){
  const [stats, states, dcs] = await Promise.all([
    fetch('data/stats.json').then(r => r.json()),
    fetch('data/states.geojson').then(r => r.json()),
    fetch('data/datacenters_odbl.geojson').then(r => r.json())
  ]);
  STATS = stats; STATES = states; DCS = dcs;

  renderFilters();
  renderCards();
  renderTop5();

  map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/dark',
    bounds: CONUS,
    fitBoundsOptions: {padding: phone() ? {top:110,left:12,right:12,bottom:190} : {top:24,left:290,right:320,bottom:40}},
    minZoom: 2.5,
    maxZoom: 14,
    attributionControl: false,
    hash: false
  });
  map.addControl(new maplibregl.NavigationControl({showCompass:false}), 'top-right');
  map.addControl(new maplibregl.AttributionControl({compact: true, customAttribution:
    'Campuses: <a href="https://datacentersnearme.org/data">DataCentersNearMe</a> (ODbL) · Rates: <a href="https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_6_a">EIA</a> · Boundaries: U.S. Census · © OpenStreetMap contributors · OpenFreeMap'
  }), 'bottom-right');
  const home = document.createElement('div');
  home.className = 'maplibregl-ctrl maplibregl-ctrl-group';
  home.innerHTML = `<button class="home-btn" type="button" aria-label="Reset to United States"><svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v9H4z"/></svg></button>`;
  home.querySelector('button').onclick = () => selectState(null);
  map.addControl({onAdd:()=>home, onRemove(){}}, 'top-right');

  map.on('load', () => {
    map.addSource('states', {type:'geojson', data: STATES, promoteId:'abbr'});
    map.addLayer({
      id:'states-fill', type:'fill', source:'states',
      paint:{
        'fill-color': fillColorExpr(),
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.78, 6.5, 0.62, 8, 0.2, 10, 0.07]
      }
    }, findFirstSymbol());
    map.addLayer({
      id:'states-line', type:'line', source:'states',
      paint:{
        'line-color': ['case', ['==', ['feature-state','sel'], 1], '#ffffff', '#000000'],
        'line-width': ['case', ['==', ['feature-state','sel'], 1], 2.2, 0.6],
        'line-opacity': 0.85
      }
    }, findFirstSymbol());

    map.addSource('dc', {type:'geojson', data: filteredDc(), cluster:true, clusterMaxZoom:8, clusterRadius:42,
      clusterProperties:{ mwSum:['+', ['coalesce',['get','mw'],0]] }
    });
    map.addLayer({id:'dc-cl', type:'circle', source:'dc', filter:['has','point_count'],
      paint:{
        'circle-color':'#ff6b5a',
        'circle-opacity':0.85,
        'circle-stroke-color':'#2a1010',
        'circle-stroke-width':1,
        'circle-radius':['step',['get','point_count'],12, 10,16, 30,20, 80,26]
      }});
    map.addLayer({id:'dc-cl-count', type:'symbol', source:'dc', filter:['has','point_count'],
      layout:{'text-field':['get','point_count_abbreviated'],'text-font':['Noto Sans Regular'],'text-size':11},
      paint:{'text-color':'#fff'}});
    map.addLayer({id:'dc-halo', type:'circle', source:'dc', filter:['!',['has','point_count']],
      paint:{
        'circle-radius':['interpolate',['linear'],['coalesce',['get','mw'],0], 0,7, 200,10, 2000,16],
        'circle-color':'#ff6b5a','circle-opacity':0.16
      }});
    map.addLayer({id:'dc-pt', type:'circle', source:'dc', filter:['!',['has','point_count']],
      paint:{
        'circle-radius':['interpolate',['linear'],['coalesce',['get','mw'],0], 0,4, 200,6, 2000,11],
        'circle-color':['match',['get','status'],
          'operating','#4cc38a','under_construction','#ffd34d','permitted','#c08cff','proposed','#ff6b5a',
          'withdrawn','#887070','rejected','#887070','#9aa0a6'],
        'circle-opacity':0.95,
        'circle-stroke-color':'#111','circle-stroke-width':1
      }});

    paintStates();

    map.on('mouseenter','states-fill',()=> map.getCanvas().style.cursor='pointer');
    map.on('mouseleave','states-fill',()=> map.getCanvas().style.cursor='');
    map.on('mouseenter','dc-pt',()=> map.getCanvas().style.cursor='pointer');
    map.on('mouseleave','dc-pt',()=> map.getCanvas().style.cursor='');
    map.on('mouseenter','dc-cl',()=> map.getCanvas().style.cursor='pointer');

    map.on('click','dc-pt', (e) => {
      const f = e.features[0]; if (!f) return;
      e.originalEvent.stopPropagation();
      openDetail(f.properties, f.geometry.coordinates);
    });
    map.on('click','dc-cl', (e) => {
      const f = e.features[0]; if (!f) return;
      e.originalEvent.stopPropagation();
      map.getSource('dc').getClusterExpansionZoom(f.properties.cluster_id, (err, z) => {
        if (err) return;
        map.easeTo({center: f.geometry.coordinates, zoom: z});
      });
    });
    map.on('click', (e) => {
      const pts = map.queryRenderedFeatures(e.point, {layers:['dc-pt','dc-cl']});
      if (pts.length) return;
      const st = map.queryRenderedFeatures(e.point, {layers:['states-fill']});
      if (st[0]?.properties?.abbr) selectState(st[0].properties.abbr);
    });

    window.__ready = true;
  });

  $('#btn-about').onclick = showAbout;
  $('#btn-panel').onclick = () => {
    document.body.classList.toggle('nopanel');
    $('#btn-panel').setAttribute('aria-expanded', document.body.classList.contains('nopanel') ? 'false' : 'true');
    map.resize();
  };
  $('#panel-handle').onclick = () => { $('#panel').classList.toggle('full'); sheetVar(); };
  $$('.tab').forEach(t => t.onclick = () => {
    $$('.tab').forEach(x => { x.classList.toggle('on', x===t); x.setAttribute('aria-selected', x===t); });
    $$('.tabpane').forEach(p => p.classList.toggle('on', p.dataset.pane === (t.dataset.tab === 'top' ? 'top' : 'filters')));
    $('#panel').classList.add('full'); sheetVar();
  });
  function sheetVar(){ document.documentElement.style.setProperty('--sheet', $('#panel').classList.contains('full') ? '68vh' : '168px'); }

  // Public test hooks
  window.__mmudc = {
    selectState, openDetail, closeDetail, agg, refresh,
    get selState(){ return selState; },
    get map(){ return map; },
    get stats(){ return STATS; },
    statusOn, STATUS_LABEL,
    firstPin(){ return DCS.features.find(f => f.properties.mw) || DCS.features[0]; },
    openById(id){
      const f = DCS.features.find(x => x.properties.id === id);
      if (!f) return false;
      openDetail(f.properties, f.geometry.coordinates);
      return true;
    },
    clickFirstVisible(){
      const feats = map.queryRenderedFeatures({layers:['dc-pt']}).sort((a,b)=>(b.properties.mw||0)-(a.properties.mw||0));
      if (!feats.length) return false;
      openDetail(feats[0].properties, feats[0].geometry.coordinates);
      return true;
    }
  };
}

function findFirstSymbol(){
  const layers = map.getStyle().layers || [];
  const s = layers.find(l => l.type === 'symbol');
  return s ? s.id : undefined;
}

boot().catch((e) => {
  console.error(e);
  $('#cards').innerHTML = `<div class="card" style="--c:var(--warn)"><div class="l">Error</div><div class="v">Load failed</div><div class="s">${esc(e.message)}</div></div>`;
});
