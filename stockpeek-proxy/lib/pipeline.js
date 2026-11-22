// Pure report pipeline. This module runs on a trusted server, never inside Electron.
const MAX_STOCKS = 5
const MAX_EVENTS = 100
const MAX_WINDOW_DAYS = 30
const MAX_SOURCES = 12

const fail = code => {throw new Error(code)}
const safeText=(value,n)=>typeof value==='string' && value.trim().length>0 && value.trim().length<=n
const isIso=s=>typeof s==='string' && Number.isFinite(Date.parse(s))

export function validateAnalysisRequest(request) {
  if(!request || request.schemaVersion!==2 || !Array.isArray(request.stocks) ||
    request.stocks.length<1 || request.stocks.length>MAX_STOCKS) fail('ERR_ANALYSIS_REQUEST')
  if(!request.options || typeof request.options!=='object') fail('ERR_ANALYSIS_OPTIONS')
  const opts=request.options
  for(const key of ['includeHoldings','includeHistory','includeThesis'])
    if(typeof opts[key]!=='boolean') fail('ERR_ANALYSIS_OPTIONS')
  if(!Number.isInteger(opts.lookbackDays) || opts.lookbackDays<1 || opts.lookbackDays>365)
    fail('ERR_ANALYSIS_OPTIONS')
  const seen=new Set()
  for(const stock of request.stocks){
    if(!stock || !['US','KR'].includes(stock.market) ||
      !/^[A-Z0-9.&-]{1,20}$/.test(stock.symbol) ||
      stock.key!==stock.market+':'+stock.symbol || seen.has(stock.key))
      fail('ERR_ANALYSIS_STOCK')
    seen.add(stock.key)
    if(!opts.includeHoldings && stock.holding!=null) fail('ERR_ANALYSIS_CONSENT')
    if(stock.holding!=null && (typeof stock.holding.quantity!=='number' ||
      !Number.isFinite(stock.holding.quantity) || stock.holding.quantity<=0 ||
      typeof stock.holding.avgPrice!=='number' || !Number.isFinite(stock.holding.avgPrice) ||
      stock.holding.avgPrice<=0)) fail('ERR_ANALYSIS_HOLDING')
  }
  if(!opts.includeThesis && request.investmentThesis!==undefined) fail('ERR_ANALYSIS_CONSENT')
  if(request.investmentThesis!==undefined &&
    (!safeText(request.investmentThesis.text,1200) ||
    !['short','medium','long','unspecified'].includes(request.investmentThesis.horizon) ||
    !['balanced','fundamentals','industry','risks'].includes(request.investmentThesis.focus)))
    fail('ERR_ANALYSIS_THESIS')
  if(!opts.includeHistory && request.activity!==undefined) fail('ERR_ANALYSIS_CONSENT')
  if(opts.includeHistory && (!Array.isArray(request.activity) || request.activity.length>MAX_EVENTS))
    fail('ERR_ANALYSIS_HISTORY')
  if(opts.includeHistory) for(const event of request.activity){
    if(!event || !seen.has(event.stock?.market+':'+event.stock?.symbol) ||
      !['watchlist_added','watchlist_removed','holding_edited'].includes(event.type) ||
      !isIso(event.occurredAt)) fail('ERR_ANALYSIS_HISTORY')
    if(event.type==='holding_edited' && !opts.includeHoldings) fail('ERR_ANALYSIS_CONSENT')
  }
  return request
}

function sourceValid(item, stockKeys, now, since) {
  if(!item || item.kind!=='filing' || item.evidenceLevel!=='filing-metadata' ||
    !safeText(item.id,100) || !safeText(item.title,250) ||
    !safeText(item.publisher,80) || !isIso(item.publishedAt) ||
    Date.parse(item.publishedAt)<Date.parse(since) ||
    Date.parse(item.publishedAt)>Date.parse(now) ||
    !Array.isArray(item.stockKeys) ||
    item.stockKeys.length!==1 || !stockKeys.has(item.stockKeys[0])) return false
  let url
  try {url=new URL(item.url)} catch {return false}
  return url.protocol==='https:' && !url.username && !url.password &&
    ((item.publisher==='U.S. SEC EDGAR' && url.hostname==='www.sec.gov') ||
     (item.publisher==='OpenDART' && url.hostname==='dart.fss.or.kr'))
}

function validateGenerated(result, evidence, request) {
  if(!result || result.schemaVersion!==1 || !safeText(result.summary,450) ||
    !Array.isArray(result.highlights) || result.highlights.length>3 ||
    !Array.isArray(result.watchItems) || result.watchItems.length>3) fail('ERR_ANALYSIS_MODEL_OUTPUT')
  const allowed=new Set(evidence.map(x=>x.id))
  if(result.highlights.some(h=>!safeText(h?.text,240) ||
    !Array.isArray(h.sourceIds) || !h.sourceIds.length ||
    h.sourceIds.some(id=>!allowed.has(id)))) fail('ERR_ANALYSIS_CITATIONS')
  if(result.watchItems.some(w=>!safeText(w,180)))fail('ERR_ANALYSIS_MODEL_OUTPUT')
  if(result.portfolioNote!=null && (!request.options.includeHoldings ||
    !safeText(result.portfolioNote,350))) fail('ERR_ANALYSIS_CONSENT')
  return result
}

// Default is deliberately deterministic metadata reporting; no claims about contents
// of unread filings. Optional model uses the same restricted source set.
export function metadataOnlyReport(request,evidence) {
  return {
    schemaVersion:1,
    summary: evidence.length
      ? `Official filing metadata for ${evidence.length} recent filing(s) was found. Filing contents and financial effects have not been checked.`
      : 'No new official filing metadata was verified for this request. This is not a statement about all market news.',
    highlights:evidence.slice(0,3).map(s=>({
      text:`${s.stockKeys[0]}: ${s.publisher} published “${s.title}” (${s.precision==='date'?'filing date':'timestamp'} only; contents not reviewed).`.slice(0,240),
      sourceIds:[s.id]
    })),
    watchItems: evidence.length
      ? ['Open the original filings before drawing conclusions about business performance.']
      : ['Check coverage gaps and try again when official filings are available.'],
    portfolioNote:null
  }
}

export function createAnalysisPipeline({filings, news=null, generate=null, now=()=>new Date().toISOString()}) {
  if(!filings || typeof filings.collect!=='function')fail('ERR_ANALYSIS_PROVIDER')
  return async function analyze(input) {
    if(news)fail('ERR_NEWS_NOT_LICENSED')
    const request=validateAnalysisRequest(input)
    const asOf=now()
    if(!isIso(asOf))fail('ERR_ANALYSIS_CLOCK')
    const since=new Date(Date.parse(asOf)-Math.min(request.options.lookbackDays,MAX_WINDOW_DAYS)*86400000).toISOString()
    const records=[], failures=[],coverage=[]
    for(const stock of request.stocks){
      try {
        const filingsForStock=await filings.collect(stock,{asOf,since})
        if(!Array.isArray(filingsForStock))fail('ERR_ANALYSIS_PROVIDER')
        records.push(...filingsForStock)
        coverage.push({key:stock.key,status:'ok',source:'official_filings'})
      }catch(error){
        const code=error instanceof Error && /^ERR_[A-Z_]+$/.test(error.message)
          ? error.message : 'ERR_ANALYSIS_PROVIDER'
        failures.push({key:stock.key,code})
        coverage.push({key:stock.key,status:'unavailable',source:'official_filings'})
      }
    }
    // A licensed news provider can be added here only after commercial usage rights
    // and verified article-content rules are contractually confirmed.
    const allowed=new Set(request.stocks.map(s=>s.key))
    const seen=new Set()
    const evidence=records.filter(r=>{
      if(!sourceValid(r,allowed,asOf,since) || seen.has(r.id))return false
      seen.add(r.id);return true
    }).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,MAX_SOURCES)
    if(!coverage.some(c=>c.status==='ok'))fail('ERR_ANALYSIS_NO_COVERAGE')
    const draft=generate
      ? await generate({request,evidence,coverage,asOf})
      : metadataOnlyReport(request,evidence)
    const output=validateGenerated(draft,evidence,request)
    return {
      schemaVersion:1,status:'generated_unbilled',asOf,periodStart:since,
      dataLevel:'filing_metadata_only',
      report:{...output,asOf,locale:request.locale,stocks:request.stocks,
        sources:evidence.filter(e=>output.highlights.some(h=>h.sourceIds.includes(e.id))),
        noNewEvents:!evidence.length},
      evidence,coverage,failures,
      warnings:[
        'Filing titles and timestamps do not verify the contents of a filing.',
        'No licensed news source or financial-statement extraction is configured.',
        ...(failures.length?['Some selected stocks had unavailable filing data.']:[])
      ]
    }
  }
}
