'use strict';
/* Almoxarifado — pedidos aprovados (twbsistemas), recebido da OS, movimentação SIGMA, cruzamento e estoque.
   Dados no Supabase do portal (tabela registros, coleções almox_*); fotos no bucket anexos/almoxarifado/. */
/* ===================== DADOS ===================== */
const KEY='almox_upa_rocinha_v1';
let DB={pedidos:[],receb:[],sigma:[],inv:[],vinculos:{}};
/* ---------- Banco (Supabase do portal: tabela "registros", arquivos no bucket "anexos") ---------- */
const COL={pedidos:'almox_pedidos',receb:'almox_receb',sigma:'almox_sigma',inv:'almox_inv',vinculos:'almox_vinc'};
const SERVER={};           // ids gravados no banco por coleção
const FOTO_URL={};         // cache de links assinados das fotos
const uid=()=>crypto.randomUUID();
const slug=s=>norm(s).replace(/[^A-Z0-9]+/g,'-').slice(0,80);
function statusTxt(t){const e=document.getElementById('status');if(e)e.textContent=t;}
function ocupado(on){document.getElementById('carregando').style.display=on?'flex':'none';}
function docs(tipo){
  if(tipo==='pedidos'){const g={};DB.pedidos.forEach(p=>{(g[p.pedido]=g[p.pedido]||{pedido:p.pedido,mesano:p.mesano,data:p.data,itens:[]}).itens.push({seg:p.seg,ins:p.ins,un:p.un,qtd:p.qtd});});return Object.values(g).map(d=>['almox-ped-'+slug(d.pedido),d]);}
  if(tipo==='receb')return DB.receb.map(r=>['almox-rec-'+r.id,r]);
  if(tipo==='sigma'){const g={};DB.sigma.forEach(s=>{const{arq,...l}=s;(g[arq]=g[arq]||{arq,linhas:[]}).linhas.push(l);});return Object.values(g).map(d=>['almox-sig-'+slug(d.arq),d]);}
  if(tipo==='inv')return DB.inv.length?[['almox-inv',{data:DB.inv[0].data||'',itens:DB.inv.map(i=>({ins:i.ins,qtd:i.qtd}))}]]:[];
  if(tipo==='vinculos')return[['almox-vinc',{mapa:DB.vinculos}]];
}
async function subirFotos(){
  for(const r of DB.receb){
    for(let i=0;i<(r.fotos||[]).length;i++){const f=r.fotos[i];if(typeof f==='string'&&f.startsWith('data:')){
      const p=`almoxarifado/${r.id}/${uid()}.jpg`;await UPA.files.upload(p,UPA.dataUrlToBlob(f),'image/jpeg');FOTO_URL[p]=f;r.fotos[i]=p;}}
  }
}
async function salvar(...tipos){
  ocupado(true);statusTxt('Salvando…');
  try{
    if(tipos.includes('receb'))await subirFotos();
    const quem=(UPA.user()&&UPA.user().email)||null,agora=new Date().toISOString();
    for(const t of tipos){
      const col=COL[t],lista=docs(t),ids=new Set(lista.map(x=>x[0]));
      const rows=lista.map(([id,dados])=>({id,colecao:col,dados,atualizado_por:quem,updated_at:agora}));
      for(let i=0;i<rows.length;i+=400){const r=await UPA.client().from('registros').upsert(rows.slice(i,i+400));if(r.error)throw r.error;}
      const sobra=[...(SERVER[col]||[])].filter(id=>!ids.has(id));
      for(let i=0;i<sobra.length;i+=200){const r=await UPA.client().from('registros').delete().in('id',sobra.slice(i,i+200));if(r.error)throw r.error;}
      SERVER[col]=ids;
    }
    statusTxt('✓ Salvo no banco '+new Date().toLocaleTimeString('pt-BR').slice(0,5));
  }catch(e){statusTxt('⚠ Erro ao salvar');alert('Não foi possível salvar no banco: '+UPA.msg(e)+'\nRecarregue a página e tente de novo.');}
  finally{ocupado(false);}
}
async function carregar(){
  statusTxt('Carregando…');
  const ler=async c=>{const l=await UPA.db.list(c);SERVER[c]=new Set(l.map(r=>r.id));return l.map(r=>r.dados);};
  const [ped,rec,sig,inv,vin]=await Promise.all([ler(COL.pedidos),ler(COL.receb),ler(COL.sigma),ler(COL.inv),ler(COL.vinculos)]);
  DB.pedidos=ped.flatMap(d=>(d.itens||[]).map(i=>({pedido:d.pedido,mesano:d.mesano,data:d.data,...i})));
  DB.receb=rec.map(r=>({fotos:[],...r}));
  DB.sigma=sig.flatMap(d=>(d.linhas||[]).map(l=>({arq:d.arq,...l})));
  DB.inv=inv[0]?(inv[0].itens||[]).map(i=>({...i,data:inv[0].data})):[];
  DB.vinculos=(vin[0]&&vin[0].mapa)||{};
  statusTxt('✓ Conectado · '+((UPA.user()&&UPA.user().email)||''));
}
async function fotosNaTela(){
  const imgs=[...document.querySelectorAll('img[data-p]')];const falta=[...new Set(imgs.map(i=>i.dataset.p).filter(p=>!FOTO_URL[p]))];
  if(falta.length){try{Object.assign(FOTO_URL,await UPA.files.urls(falta));}catch(e){}}
  imgs.forEach(i=>{if(FOTO_URL[i.dataset.p])i.src=FOTO_URL[i.dataset.p];});
}

const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9%,./ -]/g,' ').replace(/\s+/g,' ').trim();
const num=v=>{if(typeof v==='number')return v;const s=String(v??'').trim();if(!s)return 0;return Number(s.replace(/\./g,'').replace(',','.'))||0;};
const fmt=n=>(Math.round(n*100)/100).toLocaleString('pt-BR');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.style.display='block';clearTimeout(t._t);t._t=setTimeout(()=>t.style.display='none',3500);}
const chave=ins=>{const k=norm(ins);return DB.vinculos[k]||k;}; // SIGMA/recebido -> nome do catálogo

function dataBR(v){
  if(v instanceof Date&&!isNaN(v))return v.toLocaleDateString('pt-BR');
  if(typeof v==='number'){const d=new Date(Math.round((v-25569)*864e5));return d.toLocaleDateString('pt-BR',{timeZone:'UTC'});}
  const s=String(v??'').trim();const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return `${m[3]}/${m[2]}/${m[1]}`;return s.slice(0,10);
}
const mesAno=d=>{const m=String(d).match(/(\d{2})\/(\d{4})/);return m?`${m[1]}/${m[2]}`:'';};
const ordData=d=>{const m=String(d).match(/(\d{2})\/(\d{2})\/(\d{4})/);return m?m[3]+m[2]+m[1]:String(d);};

/* ===================== IMPORTAÇÃO ===================== */
const COLS={
  pedido:['PEDIDO','N PEDIDO','NO PEDIDO','NUMERO PEDIDO','NUM PEDIDO'],
  mesano:['MES/ANO','MES ANO','MES','COMPETENCIA'],
  data:['DATA','DATA PEDIDO','DATA RECEBIMENTO','DATA MOVIMENTO','DATA MOV','DT'],
  seg:['SEGMENTO','SEGUIMENTO','GRUPO','CATEGORIA'],
  ins:['INSUMO','DESCRICAO','ITEM','MATERIAL','PRODUTO','DESCRICAO DO MATERIAL'],
  un:['UNIDADE','UN','UND','UNID'],
  qtdAp:['QTD APROVADA','QUANTIDADE APROVADA','QTD','QUANTIDADE'],
  qtdRec:['QTD RECEBIDA','QUANTIDADE RECEBIDA','RECEBIDO','QTD','QUANTIDADE'],
  qtd:['QUANTIDADE','QTD','QTDE','QUANT'],
  tipo:['TIPO','TIPO MOVIMENTO','MOVIMENTO','OPERACAO','E/S'],
  ent:['ENTRADA','ENTRADAS','QTD ENTRADA'],
  sai:['SAIDA','SAIDAS','QTD SAIDA','CONSUMO'],
  setor:['SETOR','DESTINO','CENTRO DE CUSTO','SOLICITANTE'],
  doc:['NOTA','NF','NOTA FISCAL','DOCUMENTO','DOC','GUIA'],
};
function achaCol(headers,lista){const H=headers.map(h=>norm(h));for(const c of lista){const i=H.indexOf(c);if(i>=0)return headers[i];}for(const c of lista){const i=H.findIndex(h=>h.startsWith(c));if(i>=0)return headers[i];}return null;}

async function lerArquivo(file){
  const buf=await file.arrayBuffer();const wb=XLSX.read(buf,{type:'array',cellDates:true});
  // prioriza aba com "Itens"/"Pedidos_Itens"; senão a primeira com dados
  let nome=wb.SheetNames.find(n=>/itens/i.test(n))||wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[nome],{defval:''});
}

async function importar(tipo,inputId){
  const f=document.getElementById(inputId).files[0];if(!f)return toast('Escolha um arquivo.');
  let linhas;try{linhas=await lerArquivo(f);}catch(e){return toast('Não consegui ler o arquivo.');}
  if(!linhas.length)return toast('Arquivo vazio.');
  const H=Object.keys(linhas[0]);const c=k=>achaCol(H,COLS[k]);
  const cIns=c('ins');if(!cIns)return toast('Não achei a coluna de Insumo/Descrição.');
  let n=0;
  if(tipo==='pedidos'){
    const cP=c('pedido'),cQ=c('qtdAp');if(!cP||!cQ)return toast('Preciso das colunas Pedido e Qtd Aprovada.');
    const cM=c('mesano'),cD=c('data'),cS=c('seg'),cU=c('un');
    const novos=linhas.filter(l=>l[cIns]&&String(l[cP]).trim()).map(l=>{const d=cD?dataBR(l[cD]):'';return{pedido:String(l[cP]).trim(),data:d,mesano:cM?String(l[cM]).trim():mesAno(d),seg:cS?String(l[cS]).trim():'',ins:String(l[cIns]).trim(),un:cU?String(l[cU]).trim():'',qtd:num(l[cQ])};});
    const ids=new Set(novos.map(x=>x.pedido));DB.pedidos=DB.pedidos.filter(x=>!ids.has(x.pedido)).concat(novos);n=novos.length;
    toast(`${n} itens de ${ids.size} pedido(s) importados.`);
  }
  if(tipo==='receb'){
    const cP=c('pedido'),cQ=c('qtdRec'),cD=c('data'),cDoc=c('doc');if(!cQ)return toast('Preciso da coluna Qtd Recebida.');
    const pedSel=document.getElementById('rcPedImp').value;
    if(!cP&&!pedSel)return toast('A planilha não tem coluna Pedido: escolha o pedido para vincular.');
    const novos=linhas.filter(l=>l[cIns]&&num(l[cQ])).map(l=>({id:uid(),pedido:cP&&String(l[cP]).trim()?String(l[cP]).trim():pedSel,data:cD?dataBR(l[cD]):'',ins:String(l[cIns]).trim(),qtd:num(l[cQ]),doc:cDoc?String(l[cDoc]).trim():'',fotos:[],origem:f.name}));
    DB.receb=DB.receb.concat(novos);n=novos.length;toast(`${n} recebimentos importados.`);
  }
  if(tipo==='sigma'){
    const cD=c('data'),cT=c('tipo'),cQ=c('qtd'),cE=c('ent'),cSa=c('sai'),cSe=c('setor'),cDoc=c('doc');
    if(!(cT&&cQ)&&!(cE||cSa))return toast('Preciso de Tipo + Quantidade, ou colunas Entrada/Saída.');
    const novos=[];
    linhas.forEach(l=>{if(!l[cIns])return;const base={arq:f.name,data:cD?dataBR(l[cD]):'',ins:String(l[cIns]).trim(),setor:cSe?String(l[cSe]).trim():'',doc:cDoc?String(l[cDoc]).trim():''};
      if(cE||cSa){const e=cE?num(l[cE]):0,s=cSa?num(l[cSa]):0;if(e)novos.push({...base,tipo:'ENTRADA',qtd:Math.abs(e)});if(s)novos.push({...base,tipo:'SAÍDA',qtd:Math.abs(s)});}
      else{const t=norm(l[cT]);const q=num(l[cQ]);if(!q)return;const sai=/^S|SAI|CONSUMO|DISPENS|BAIXA|REQUISI/.test(t)||q<0;novos.push({...base,tipo:sai?'SAÍDA':'ENTRADA',qtd:Math.abs(q)});}});
    DB.sigma=DB.sigma.filter(x=>x.arq!==f.name).concat(novos);n=novos.length;toast(`${n} movimentações do SIGMA importadas.`);
  }
  if(tipo==='inv'){
    const cQ=c('qtd');if(!cQ)return toast('Preciso da coluna Quantidade.');
    const d=document.getElementById('invData').value;
    DB.inv=linhas.filter(l=>l[cIns]).map(l=>({ins:String(l[cIns]).trim(),qtd:num(l[cQ]),data:d?dataBR(d):''}));n=DB.inv.length;toast(`Inventário com ${n} itens importado.`);
  }
  document.getElementById(inputId).value='';render();await salvar(tipo);
}

function modelo(tipo){
  const M={
    pedidos:[['Pedido','Mês/Ano','Data Pedido','Segmento','Insumo','Unidade','Qtd Aprovada'],['921','10/2026','02/10/2026','MEDICO CIRÚRGICO','SERINGA DESCARTAVEL 05ML BICO LUER LOCK','UN',6000]],
    receb:[['Pedido','Data','Insumo','Qtd Recebida','Nota'],['921','20/10/2026','SERINGA DESCARTAVEL 05ML BICO LUER LOCK',5000,'NF 12345']],
    sigma:[['Data','Insumo','Tipo','Quantidade','Setor'],['21/10/2026','SERINGA DESCARTAVEL 05ML BICO LUER LOCK','Saída',300,'SALA AMARELA']],
    inv:[['Insumo','Quantidade'],['SERINGA DESCARTAVEL 05ML BICO LUER LOCK',1200]],
  };
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(M[tipo]),'Modelo');XLSX.writeFile(wb,`modelo_${tipo}.xlsx`);
}
function limpar(tipo){if(!confirm('Apagar todos os dados desta aba? (faça um backup antes)'))return;DB[tipo]=[];render();salvar(tipo);}

/* ===================== RECEBIMENTO MANUAL ===================== */
function comprimir(file){return new Promise(r=>{const fr=new FileReader();fr.onload=()=>{const im=new Image();im.onload=()=>{const k=Math.min(1,900/Math.max(im.width,im.height));const cv=document.createElement('canvas');cv.width=im.width*k;cv.height=im.height*k;cv.getContext('2d').drawImage(im,0,0,cv.width,cv.height);r(cv.toDataURL('image/jpeg',0.6));};im.src=fr.result;};fr.readAsDataURL(file);});}
function preencherInsumosRec(){
  const p=document.getElementById('rcPed').value;
  const itens=DB.pedidos.filter(x=>x.pedido===p).sort((a,b)=>a.ins.localeCompare(b.ins));
  document.getElementById('rcIns').innerHTML=itens.map(x=>`<option value="${esc(x.ins)}">${esc(x.ins)} (aprov. ${fmt(x.qtd)})</option>`).join('')||'<option value="">— importe os pedidos —</option>';
}
async function lancarRec(){
  const p=rcPed.value,ins=rcIns.value,q=num(rcQtd.value);if(!p||!ins||!q)return toast('Preencha pedido, insumo e quantidade.');
  const fotos=[];for(const f of rcFoto.files)fotos.push(await comprimir(f));
  DB.receb.push({id:uid(),pedido:p,data:rcData.value?dataBR(rcData.value):new Date().toLocaleDateString('pt-BR'),ins,qtd:q,doc:rcDoc.value,fotos,origem:'manual'});
  rcQtd.value='';rcDoc.value='';rcFoto.value='';await salvar('receb');render();toast('Recebimento lançado.');
}
async function excluirRec(id){if(!confirm('Excluir este recebimento?'))return;const r=DB.receb.find(x=>x.id===id);const ps=(r.fotos||[]).filter(f=>!String(f).startsWith('data:'));if(ps.length){try{await UPA.files.remove(ps);}catch(e){}}DB.receb=DB.receb.filter(x=>x.id!==id);render();await salvar('receb');}
async function addFoto(id,inp){const r=DB.receb.find(x=>x.id===id);for(const f of inp.files)r.fotos.push(await comprimir(f));await salvar('receb');render();}
function verFoto(src){imgFoto.src=src;modalFoto.style.display='flex';}

/* ===================== CÁLCULOS ===================== */
function catalogo(){const m=new Map();DB.pedidos.forEach(p=>{const k=norm(p.ins);if(!m.has(k))m.set(k,{ins:p.ins,seg:p.seg,un:p.un});});return m;}
function cruzamento(){
  const ap=new Map();DB.pedidos.forEach(p=>{const k=p.pedido+'|'+norm(p.ins);const o=ap.get(k)||{pedido:p.pedido,mesano:p.mesano,data:p.data,seg:p.seg,ins:p.ins,un:p.un,ap:0,rec:0,docs:new Set()};o.ap+=p.qtd;ap.set(k,o);});
  const semPedido=[];const pedOK=new Set(DB.pedidos.map(p=>p.pedido));
  DB.receb.forEach(r=>{const k=r.pedido+'|'+chave(r.ins);const o=ap.get(k);if(o){o.rec+=r.qtd;if(r.doc)o.docs.add(r.doc);}else if(pedOK.has(r.pedido))semPedido.push(r);});
  const linhas=[...ap.values()].map(o=>({...o,dif:o.ap-o.rec,docs:[...o.docs].join(', ')}));
  return{linhas,semPedido};
}
function estoque(){
  const cat=catalogo();const m=new Map();
  const get=k=>{if(!m.has(k)){const c=cat.get(k);m.set(k,{ins:c?c.ins:k,seg:c?c.seg:'(fora do catálogo)',un:c?c.un:'',ini:0,rec:0,ent:0,sai:0});}return m.get(k);};
  cat.forEach((v,k)=>get(k));
  DB.inv.forEach(i=>get(chave(i.ins)).ini+=i.qtd);
  // movimentos até a data do inventário (inclusive) já estão no saldo inicial
  const corte=DB.inv.length&&DB.inv[0].data?ordData(DB.inv[0].data):'';
  const depois=d=>!corte||!d||ordData(d)>corte;
  DB.receb.forEach(r=>{if(depois(r.data))get(chave(r.ins)).rec+=r.qtd;});
  DB.sigma.forEach(s=>{if(!depois(s.data))return;const o=get(chave(s.ins));if(s.tipo==='SAÍDA')o.sai+=s.qtd;else o.ent+=s.qtd;});
  return[...m.values()].map(o=>({...o,saldo:o.ini+o.rec-o.sai,difEnt:o.rec-o.ent}));
}

/* ===================== RENDER ===================== */
function opcoesPedidos(sel,todos=true){
  const ped=[...new Map(DB.pedidos.map(p=>[p.pedido,p])).values()].sort((a,b)=>ordData(b.data).localeCompare(ordData(a.data)));
  const el=document.getElementById(sel);const v=el.value;
  el.innerHTML=(todos?'<option value="">Todos</option>':'<option value="">— escolha —</option>')+ped.map(p=>`<option value="${esc(p.pedido)}">#${esc(p.pedido)} – ${esc(p.mesano)}</option>`).join('');
  if([...el.options].some(o=>o.value===v))el.value=v;
}
const filtroBusca=(id,txt)=>{const b=norm(document.getElementById(id).value);return!b||norm(txt).includes(b);};
const LIM=1500;

function render(){
  ['fPedPed','fRecPed','fCzPed'].forEach(s=>opcoesPedidos(s));opcoesPedidos('rcPedImp',false);
  const rp=document.getElementById('rcPed');const vrp=rp.value;opcoesPedidos('rcPed',false);if(!vrp&&rp.options.length>1){rp.selectedIndex=1;}preencherInsumosRec();
  const segs=[...new Set(DB.pedidos.map(p=>p.seg))].sort();const fs=document.getElementById('fEstSeg');const vs=fs.value;fs.innerHTML='<option value="">Todos</option>'+segs.map(s=>`<option>${esc(s)}</option>`).join('')+'<option>(fora do catálogo)</option>';fs.value=vs;

  // Pedidos
  let fp=fPedPed.value,ped=DB.pedidos.filter(p=>(!fp||p.pedido===fp)&&filtroBusca('fPedBusca',p.ins));
  tbPedidos.innerHTML=ped.length?`<table><tr><th>Pedido</th><th>Mês/Ano</th><th>Data</th><th>Segmento</th><th>Insumo</th><th>Un</th><th class="n">Qtd aprovada</th></tr>${ped.slice(0,LIM).map(p=>`<tr><td>${esc(p.pedido)}</td><td>${esc(p.mesano)}</td><td>${esc(p.data)}</td><td>${esc(p.seg)}</td><td>${esc(p.ins)}</td><td>${esc(p.un)}</td><td class="n">${fmt(p.qtd)}</td></tr>`).join('')}</table>${ped.length>LIM?`<div class="vazio">Mostrando ${LIM} de ${ped.length}. Use os filtros.</div>`:''}`:'<div class="vazio">Nenhum pedido importado.</div>';

  // Recebidos
  let fr=fRecPed.value,rec=DB.receb.filter(r=>(!fr||r.pedido===fr)&&filtroBusca('fRecBusca',r.ins)).sort((a,b)=>ordData(b.data).localeCompare(ordData(a.data)));
  tbReceb.innerHTML=rec.length?`<table><tr><th>Pedido</th><th>Data</th><th>Insumo</th><th class="n">Qtd recebida</th><th>Nota/Doc</th><th>Fotos</th><th class="np"></th></tr>${rec.slice(0,LIM).map(r=>`<tr><td>${/^EMERG/.test(r.pedido)?'<span class="tag y">Emergencial</span>':esc(r.pedido)}</td><td>${esc(r.data)}</td><td>${esc(r.ins)}</td><td class="n">${fmt(r.qtd)}</td><td>${esc(r.doc)}</td><td><div class="fotos">${(r.fotos||[]).map(f=>String(f).startsWith('data:')?`<img src="${f}" onclick="verFoto(this.src)">`:`<img data-p="${esc(f)}" alt="foto" onclick="verFoto(this.src)">`).join('')}<label class="btn sec peq np" style="cursor:pointer">📷<input type="file" accept="image/*" multiple hidden onchange="addFoto('${r.id}',this)"></label></div></td><td class="np"><button class="btn perigo peq" onclick="excluirRec('${r.id}')">✕</button></td></tr>`).join('')}</table>`:'<div class="vazio">Nenhum recebimento lançado.</div>';

  // SIGMA
  let ft=fSigTipo.value,sg=DB.sigma.filter(s=>(!ft||s.tipo===ft)&&filtroBusca('fSigBusca',s.ins));
  tbSigma.innerHTML=sg.length?`<table><tr><th>Data</th><th>Insumo</th><th>Tipo</th><th class="n">Qtd</th><th>Setor</th><th>Doc</th><th>Arquivo</th></tr>${sg.slice(0,LIM).map(s=>`<tr><td>${esc(s.data)}</td><td>${esc(s.ins)}</td><td><span class="tag ${s.tipo==='SAÍDA'?'r':'g'}">${s.tipo}</span></td><td class="n">${fmt(s.qtd)}</td><td>${esc(s.setor)}</td><td>${esc(s.doc)}</td><td>${esc(s.arq)}</td></tr>`).join('')}</table>${sg.length>LIM?`<div class="vazio">Mostrando ${LIM} de ${sg.length}.</div>`:''}`:'<div class="vazio">Nenhuma movimentação importada.</div>';

  // Cruzamento
  const {linhas,semPedido}=cruzamento();
  let fc=fCzPed.value,soDif=fCzMostra.value==='dif';
  const cz=linhas.filter(l=>(!fc||l.pedido===fc)&&(!soDif||l.dif!==0)&&filtroBusca('fCzBusca',l.ins)).sort((a,b)=>ordData(b.data).localeCompare(ordData(a.data))||a.ins.localeCompare(b.ins));
  const totFalta=cz.filter(l=>l.dif>0).reduce((s,l)=>s+l.dif,0);
  tbCruz.innerHTML=(cz.length?`<table><tr><th>Pedido</th><th>Mês/Ano</th><th>Segmento</th><th>Insumo</th><th>Un</th><th class="n">Aprovado</th><th class="n">Recebido</th><th class="n">Diferença</th><th>Situação</th><th>Notas</th></tr>${cz.slice(0,LIM).map(l=>{const cls=l.dif>0?'dif':l.dif<0?'mais':'ok';const sit=l.dif>0?(l.rec?'<span class="tag r">Parcial</span>':'<span class="tag r">Não entregue</span>'):l.dif<0?'<span class="tag y">A mais</span>':'<span class="tag g">OK</span>';return`<tr><td>${esc(l.pedido)}</td><td>${esc(l.mesano)}</td><td>${esc(l.seg)}</td><td>${esc(l.ins)}</td><td>${esc(l.un)}</td><td class="n">${fmt(l.ap)}</td><td class="n">${fmt(l.rec)}</td><td class="n ${cls}">${fmt(l.dif)}</td><td>${sit}</td><td>${esc(l.docs)}</td></tr>`}).join('')}<tr><th colspan="7" class="n">Total a cobrar (unidades faltantes no filtro)</th><th class="n" style="color:var(--vermTx)">${fmt(totFalta)}</th><th colspan="2"></th></tr></table>`:'<div class="vazio">Nada a mostrar com esse filtro.</div>')
   +(semPedido.length?`<div class="vazio" style="text-align:left"><b>⚠ ${semPedido.length} recebimento(s) sem item correspondente no pedido</b> (nome diferente ou pedido errado): ${semPedido.slice(0,10).map(r=>`#${esc(r.pedido)} – ${esc(r.ins)}`).join('; ')}${semPedido.length>10?'…':''}. Corrija em "Vínculos de nomes" na aba Estoque.</div>`:'');

  // Estoque
  const est=estoque();const fseg=fEstSeg.value;
  notaCorte.innerHTML=DB.inv.length&&DB.inv[0].data?`<b>Saldo inicial = inventário de ${esc(DB.inv[0].data)}.</b> Recebimentos e movimentações até essa data (inclusive) já estão no inventário e não são somados de novo.`:'';
  const ev=est.filter(e=>(!fseg||e.seg===fseg)&&filtroBusca('fEstBusca',e.ins)).sort((a,b)=>a.seg.localeCompare(b.seg)||a.ins.localeCompare(b.ins));
  tbEstoque.innerHTML=ev.length?`<table><tr><th>Segmento</th><th>Insumo</th><th>Un</th><th class="n">Saldo inicial</th><th class="n">Recebido (OS)</th><th class="n">Entradas SIGMA</th><th class="n">Rec. − Ent. SIGMA</th><th class="n">Saídas SIGMA</th><th class="n">Estoque</th></tr>${ev.map(e=>`<tr><td>${esc(e.seg)}</td><td>${esc(e.ins)}</td><td>${esc(e.un)}</td><td class="n">${fmt(e.ini)}</td><td class="n">${fmt(e.rec)}</td><td class="n">${fmt(e.ent)}</td><td class="n ${e.difEnt&&DB.sigma.length?'mais':''}">${fmt(e.difEnt)}</td><td class="n">${fmt(e.sai)}</td><td class="n ${e.saldo<0?'neg':''}"><b>${fmt(e.saldo)}</b></td></tr>`).join('')}</table>`:'<div class="vazio">Sem dados.</div>';

  // Vínculos
  const cat=catalogo();const orf=[...new Set([...DB.sigma,...DB.receb,...DB.inv].map(x=>norm(x.ins)).filter(k=>!cat.has(DB.vinculos[k]||k)))].sort();
  const vincs=Object.entries(DB.vinculos);
  const opts='<option value="">— vincular a —</option>'+[...cat.entries()].sort((a,b)=>a[1].ins.localeCompare(b[1].ins)).map(([k,v])=>`<option value="${esc(k)}">${esc(v.ins)}</option>`).join('');
  cardVinc.innerHTML=`<h2>Vínculos de nomes</h2><p class="d">Itens do SIGMA, do recebido ou do inventário com nome diferente do pedido. Vincule cada um ao insumo do catálogo para entrar no cálculo certo.</p>`+
   (orf.length?`<div class="tw" style="max-height:340px"><table><tr><th>Nome vindo do SIGMA / recebido</th><th>Insumo do pedido</th></tr>${orf.map(k=>`<tr><td>${esc(k)}</td><td><select data-k="${esc(k)}" onchange="vincular(this)" style="max-width:520px">${opts}</select></td></tr>`).join('')}</table></div>`:'<div class="vazio">✅ Todos os nomes batem com o catálogo de pedidos.</div>')+
   (vincs.length?`<p class="d" style="margin-top:12px"><b>Vínculos salvos:</b></p><div class="tw" style="max-height:240px"><table>${vincs.map(([a,b])=>`<tr><td>${esc(a)}</td><td>→ ${esc(cat.get(b)?.ins||b)}</td><td class="np"><button class="btn sec peq" onclick="desvincular('${esc(a).replace(/'/g,"\\'")}')">desfazer</button></td></tr>`).join('')}</table></div>`:'');

  // Painel
  const nPed=new Set(DB.pedidos.map(p=>p.pedido)).size;
  const comRec=new Set(DB.receb.map(r=>r.pedido));
  const faltaTot=linhas.filter(l=>l.dif>0&&comRec.has(l.pedido)); // só pedidos que já têm recebimento lançado
  kpis.innerHTML=[[nPed,'Pedidos aprovados'],[DB.receb.length,'Lançamentos de recebido'],[fmt(DB.receb.filter(r=>/^EMERG/.test(r.pedido)).reduce((s,r)=>s+r.qtd,0)),'Unid. recebidas emergencial'],[DB.sigma.length,'Movimentações SIGMA'],[faltaTot.length,'Itens com falta de entrega','alerta'],[fmt(faltaTot.reduce((s,l)=>s+l.dif,0)),'Unidades a cobrar da OS','alerta'],[est.filter(e=>e.saldo<0).length,'Itens com estoque negativo','alerta']].map(([n,l,c])=>`<div class="kpi ${c||''}"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');
  const porPed={};linhas.filter(l=>l.dif>0).forEach(l=>{const o=porPed[l.pedido]||(porPed[l.pedido]={mesano:l.mesano,data:l.data,itens:0,un:0,rec:0});o.itens++;o.un+=l.dif;});
  linhas.forEach(l=>{if(porPed[l.pedido]&&l.rec)porPed[l.pedido].rec=1;});
  const pp=Object.entries(porPed).sort((a,b)=>ordData(b[1].data).localeCompare(ordData(a[1].data)));
  painelDif.innerHTML=`<h2>Pendências de entrega por pedido</h2><p class="d">Pedidos sem nenhum recebimento lançado aparecem como pendência total.</p>`+(pp.length?`<div class="tw"><table><tr><th>Pedido</th><th>Mês/Ano</th><th class="n">Itens com falta</th><th class="n">Unidades faltantes</th><th>Status</th></tr>${pp.map(([p,o])=>`<tr><td><a href="#" onclick="irCruz('${p}');return false">#${esc(p)}</a></td><td>${esc(o.mesano)}</td><td class="n">${o.itens}</td><td class="n dif">${fmt(o.un)}</td><td>${o.rec?'<span class="tag r">Entrega parcial</span>':'<span class="tag y">Sem recebido lançado</span>'}</td></tr>`).join('')}</table></div>`:'<div class="vazio">Sem pendências.</div>');
  fotosNaTela();
}
function vincular(sel){if(!sel.value)return;DB.vinculos[sel.dataset.k]=sel.value;render();salvar('vinculos');toast('Vínculo salvo.');}
function desvincular(k){delete DB.vinculos[k];render();salvar('vinculos');}
function irCruz(p){aba('cruz');fCzPed.value=p;render();}

/* ===================== EXPORTAÇÃO ===================== */
async function baixarWB(wb,nome){const b=await wb.xlsx.writeBuffer();const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([b]));a.download=nome;a.click();}
function cabec(ws){ws.getRow(1).eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1F4E78'}};});ws.views=[{state:'frozen',ySplit:1}];}
async function exportarCruz(){
  const {linhas}=cruzamento();let fc=fCzPed.value,soDif=fCzMostra.value==='dif';
  const cz=linhas.filter(l=>(!fc||l.pedido===fc)&&(!soDif||l.dif!==0)&&filtroBusca('fCzBusca',l.ins)).sort((a,b)=>ordData(b.data).localeCompare(ordData(a.data))||a.ins.localeCompare(b.ins));
  const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Pedido x Recebido');
  ws.columns=[{header:'Pedido',width:9},{header:'Mês/Ano',width:10},{header:'Segmento',width:18},{header:'Insumo',width:70},{header:'Un',width:6},{header:'Aprovado',width:11},{header:'Recebido',width:11},{header:'Diferença',width:11},{header:'Situação',width:14},{header:'Notas',width:20}];
  cabec(ws);
  cz.forEach(l=>{const r=ws.addRow([l.pedido,l.mesano,l.seg,l.ins,l.un,l.ap,l.rec,l.dif,l.dif>0?(l.rec?'Parcial':'Não entregue'):l.dif<0?'A mais':'OK',l.docs]);
    const c=r.getCell(8);if(l.dif>0){c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFD6D6'}};c.font={bold:true,color:{argb:'FFA40000'}};}else if(l.dif<0){c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF4CC'}};}});
  const t=ws.addRow(['','','','TOTAL A COBRAR','','','',cz.filter(l=>l.dif>0).reduce((s,l)=>s+l.dif,0)]);t.font={bold:true};
  ws.autoFilter={from:'A1',to:'J1'};
  await baixarWB(wb,`Pedido_x_Recebido_${fc||'todos'}.xlsx`);
}
async function exportarEstoque(){
  const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Estoque');
  ws.columns=[{header:'Segmento',width:18},{header:'Insumo',width:70},{header:'Un',width:6},{header:'Saldo inicial',width:12},{header:'Recebido (OS)',width:13},{header:'Entradas SIGMA',width:14},{header:'Saídas SIGMA',width:13},{header:'Estoque',width:11}];
  cabec(ws);estoque().sort((a,b)=>a.seg.localeCompare(b.seg)||a.ins.localeCompare(b.ins)).forEach(e=>{const r=ws.addRow([e.seg,e.ins,e.un,e.ini,e.rec,e.ent,e.sai,e.saldo]);if(e.saldo<0)r.getCell(8).font={bold:true,color:{argb:'FFA40000'}};});
  await baixarWB(wb,`Estoque_Almoxarifado_${new Date().toISOString().slice(0,10)}.xlsx`);
}
function exportarBackup(){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(DB)],{type:'application/json'}));a.download=`backup_almoxarifado_${new Date().toISOString().slice(0,10)}.json`;a.click();}
function restaurarBackup(inp){const f=inp.files[0];if(!f)return;f.text().then(t=>{try{const d=JSON.parse(t);if(!confirm('Substituir todos os dados atuais pelo backup?'))return;DB=Object.assign({pedidos:[],receb:[],sigma:[],inv:[],vinculos:{}},d);DB.receb.forEach(r=>{r.id=r.id||uid();r.fotos=r.fotos||[];});render();salvar('pedidos','receb','sigma','inv','vinculos').then(()=>{render();toast('Backup gravado no banco.');});}catch(e){toast('Arquivo de backup inválido.');}});inp.value='';}

/* ===================== ABAS ===================== */
function aba(t){document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));document.querySelectorAll('.sec-t').forEach(s=>s.classList.toggle('on',s.id==='t-'+t));}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>aba(b.dataset.t));
document.getElementById('rcData').value=new Date().toISOString().slice(0,10);
(async function(){try{await UPA.ready();}catch(e){statusTxt('⚠ '+UPA.msg(e));return;}
  try{await carregar();}catch(e){statusTxt('⚠ Erro ao carregar');alert('Não foi possível ler o banco: '+UPA.msg(e));}
  render();
  // dados antigos deste navegador (versão de teste) → oferecer envio ao banco
  try{const s=localStorage.getItem(KEY);if(s&&!DB.pedidos.length&&!DB.receb.length&&confirm('Encontrei dados do Almoxarifado salvos neste navegador. Enviar para o banco?')){
    DB=Object.assign({pedidos:[],receb:[],sigma:[],inv:[],vinculos:{}},JSON.parse(s));DB.receb.forEach(r=>{r.id=r.id||uid();r.fotos=r.fotos||[];});
    render();await salvar('pedidos','receb','sigma','inv','vinculos');localStorage.removeItem(KEY);render();}}catch(e){}
})();
