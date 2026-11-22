import assert from 'node:assert/strict'
import test from 'node:test'
import {createOpenRouterNarrator} from '../server/p4/openrouter.js'

const context={
  asOf:'2026-11-22T00:00:00.000Z',
  request:{locale:'ko',stocks:[{market:'US',symbol:'NVDA',key:'US:NVDA'}],
    options:{includeHoldings:false,includeHistory:false,includeThesis:false,lookbackDays:30}},
  evidence:[],coverage:[{key:'US:NVDA',status:'ok',source:'official_filings'}]
}
test('model is backend-only and API key is required',()=>{
  assert.throws(()=>createOpenRouterNarrator({fetchImpl:async()=>{},apiKey:''}),/ERR_MODEL_NOT_CONFIGURED/)
})
test('uses stateless structured output with no user-identifiable logging',async()=>{
  let sent
  const fake=async(url,opts)=>{
    sent={url,opts}
    return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:
      JSON.stringify({schemaVersion:1,summary:'No new filings',highlights:[],watchItems:[],portfolioNote:null})}}]})}
  }
  const generate=createOpenRouterNarrator({fetchImpl:fake,apiKey:'test-only'})
  const output=await generate(context)
  const body=JSON.parse(sent.opts.body)
  assert.equal(output.highlights.length,0)
  assert.equal(body.stream,false)
  assert.equal(body.response_format.type,'json_schema')
  assert.equal(body.response_format.json_schema.strict,true)
  assert.equal(body.provider.require_parameters,true)
  assert.equal(body.model,'openai/gpt-4o-mini')
  assert.equal(sent.url,'https://openrouter.ai/api/v1/chat/completions')
  assert.equal(body.messages[0].role,'system')
  assert.equal(body.messages[1].role,'user')
  assert.equal(sent.opts.headers.Authorization,'Bearer test-only')
})
test('model refusal, failure and invalid JSON fail closed',async()=>{
  for(const response of [
    {ok:false},
    {ok:true,json:async()=>({choices:[]})},
    {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{refusal:'no'}}]})},
    {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'bad json'}}]})}
  ]){
    const generate=createOpenRouterNarrator({fetchImpl:async()=>response,apiKey:'test-only'})
    await assert.rejects(()=>generate(context),/ERR_MODEL_/)
  }
})

test('metadata-only structured body rejects unfinished generation',async()=>{
  const narrator=createOpenRouterNarrator({
    fetchImpl:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'{}'}}]})}),
    apiKey:'test-only'
  })
  await assert.rejects(()=>narrator(context),/ERR_MODEL_INCOMPLETE/)
})
