// Usage: SEC_USER_AGENT='Stock Peek Research contact@example.com' node scripts/p4-analyze.mjs ./private-request.json ./private-report.json
// Optional: DART_API_KEY, DART_CORP_MAP_JSON='{"005930":"<8-digit corp code>"}'
// Optional: OPENROUTER_API_KEY + P4_ENABLE_MODEL=1 (server-side ONLY).
import { readFile, writeFile } from 'node:fs/promises'
import { createOfficialFilingProvider } from '../server/p4/filings.js'
import { createAnalysisPipeline } from '../server/p4/pipeline.js'
import { createOpenRouterNarrator } from '../server/p4/openrouter.js'

const [inputPath,outputPath]=process.argv.slice(2)
if(!inputPath || !outputPath || inputPath===outputPath){
  process.stderr.write('Usage: node scripts/p4-analyze.mjs <input.json> <output.json>\n')
  process.exitCode=2
}else{
  try{
    const input=JSON.parse(await readFile(inputPath,'utf8'))
    const map=process.env.DART_CORP_MAP_JSON ? JSON.parse(process.env.DART_CORP_MAP_JSON) : {}
    // fixed external API destinations are built inside the provider.
    const fetchJson=async (url,opts={})=>{
      const res=await fetch(url,{...opts,signal:AbortSignal.timeout(12_000)})
      if(!res.ok)throw new Error('ERR_SOURCE_HTTP')
      const length=Number(res.headers.get('content-length')||0)
      if(length>5_000_000)throw new Error('ERR_SOURCE_SIZE')
      const body=await res.text()
      if(body.length>5_000_000)throw new Error('ERR_SOURCE_SIZE')
      try{return JSON.parse(body)}catch{throw new Error('ERR_SOURCE_JSON')}
    }
    const provider=createOfficialFilingProvider({
      fetchJson,
      secUserAgent:process.env.SEC_USER_AGENT,
      dartApiKey:process.env.DART_API_KEY,
      dartCorpMap:map
    })
    const useModel=process.env.P4_ENABLE_MODEL==='1'
    const generate=useModel?createOpenAiNarrator({
      fetchImpl:fetch,apiKey:process.env.OPENAI_API_KEY,
      model:process.env.P4_MODEL||'anthropic/claude-sonnet-5.5'
    }):null
    const run=createAnalysisPipeline({filings:provider,generate})
    const result=await run(input)
    // Restrictive file mode on POSIX. Protect this file: it can contain personal holdings.
    await writeFile(outputPath,JSON.stringify(result,null,2)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'})
    process.stdout.write('Report metadata written. Status: '+result.status+
      ', sources: '+result.evidence.length+', unavailable stocks: '+result.failures.length+'\n')
  }catch(err){
    // Do not log URL/headers (DART key is in a query parameter), holdings or model body.
    const code=err?.message && /^ERR_[A-Z_]+$/.test(err.message)?err.message:'ERR_P4_RUN'
    process.stderr.write(code+'\n')
    process.exitCode=1
  }
}
