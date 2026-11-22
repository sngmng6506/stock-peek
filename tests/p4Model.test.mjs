import assert from 'node:assert/strict'
import test from 'node:test'
import {createOpenAiNarrator} from '../server/p4/openai.js'

const context={
  asOf:'2026-11-22T00:00:00.000Z',
  request:{locale:'ko',stocks:[{market:'US',symbol:'NVDA',key:'US:NVDA'}],
    options:{includeHoldings:false,includeHistory:false,includeThesis:false,lookbackDays:30}},
  evidence:[],coverage:[{key:'US:NVDA',status:'ok',source:'official_filings'}]
}
test('model is backend-only and API key is required',()=>{
  assert.throws(()=>createOpenAiNarrator({fetchImpl:async()=>{},apiKey:''}),/ERR_MODEL_NOT_CONFIGURED/)
})
test('uses stateless structured output with no user-identifiable logging',async()=>{
  let sent
  const fake=async(url,opts)=>{
    sent={url,opts}
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:
      JSON.stringify({schemaVersion:1,summary:'No new filings',highlights:[],watchItems:[],portfolioNote:null})}]}]})}
  }
  const generate=createOpenAiNarrator({fetchImpl:fake,apiKey:'test-only'})
  const output=await generate(context)
  const body=JSON.parse(sent.opts.body)
  assert.equal(output.highlights.length,0)
  assert.equal(body.store,false)
  assert.equal(body.text.format.type,'json_schema')
  assert.equal(body.text.format.strict,true)
  assert.equal(body.model,'gpt-4o-mini')
  assert.equal(sent.opts.headers.Authorization,'Bearer test-only')
})
test('model refusal, failure and invalid JSON fail closed',async()=>{
  for(const response of [
    {ok:false},
    {ok:true,json:async()=>({status:'incomplete'})},
    {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'refusal'}]}]})},
    {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'bad json'}]}]})}
  ]){
    const generate=createOpenAiNarrator({fetchImpl:async()=>response,apiKey:'test-only'})
    await assert.rejects(()=>generate(context),/ERR_MODEL_/)
  }
})
