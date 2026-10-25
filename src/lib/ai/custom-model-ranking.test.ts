import { describe, expect, it } from 'vitest'
import { isExcludedCustomModel, parameterBillions, rankCustomModels } from './custom-model-ranking'

// NVIDIA's public https://integrate.api.nvidia.com/v1/models list as fetched on 25 Oct 2026 (all 85 IDs).
const NVIDIA = ['01-ai/yi-large','adept/fuyu-8b','ai21labs/jamba-1.5-large-instruct','aisingapore/sea-lion-7b-instruct','bigcode/starcoder2-15b','databricks/dbrx-instruct','deepseek-ai/deepseek-coder-6.7b-instruct','deepseek-ai/deepseek-v4.1-flash','google/codegemma-1.1-7b','google/codegemma-7b','google/deplot','google/diffusiongemma-26b-a4b-it','google/gemma-2b','google/gemma-3-12b-it','google/gemma-3-4b-it','google/gemma-4-31b-it','google/recurrentgemma-2b','ibm/granite-3.0-3b-a800m-instruct','ibm/granite-3.0-8b-instruct','ibm/granite-34b-code-instruct','ibm/granite-8b-code-instruct','meta/codellama-70b','meta/llama-3.2-11b-vision-instruct','meta/llama-3.2-90b-vision-instruct','meta/llama-guard-4-12b','meta/llama2-70b','meta/muse-glimmer-30b','microsoft/kosmos-2','microsoft/phi-3-vision-128k-instruct','microsoft/phi-3.5-moe-instruct','minimaxai/minimax-m3.1-flash','mistralai/codestral-22b-instruct-v0.1','mistralai/mistral-7b-instruct-v0.3','mistralai/mistral-large','mistralai/mistral-large-2-instruct','mistralai/mixtral-8x22b-v0.1','moonshotai/kimi-k2.6','nv-mistralai/mistral-nemo-12b-instruct','nvidia/ai-synthetic-video-detector','nvidia/cosmos-reason2-8b','nvidia/embed-qa-4','nvidia/ising-calibration-1.5-31b','nvidia/llama-3.1-nemoguard-8b-content-safety','nvidia/llama-3.1-nemoguard-8b-topic-control','nvidia/llama-3.1-nemotron-51b-instruct','nvidia/llama-3.1-nemotron-70b-instruct','nvidia/llama-3.1-nemotron-safety-guard-8b-v3','nvidia/llama-3.1-nemotron-ultra-253b-v1','nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1','nvidia/llama-3.2-nv-embedqa-1b-v1','nvidia/llama-nemotron-embed-vl-1b-v2','nvidia/llama3-chatqa-1.5-70b','nvidia/mistral-nemo-minitron-8b-8k-instruct','nvidia/nemotron-3-embed-1b','nvidia/nemotron-3-nano-omni-30b-a3b-reasoning','nvidia/nemotron-3-super-120b-a12b','nvidia/nemotron-3-ultra-550b-a55b','nvidia/nemotron-3.5-bolt-e4b','nvidia/nemotron-3.5-content-safety','nvidia/nemotron-3.5-embed-1b','nvidia/nemotron-3.5-embed-8b','nvidia/nemotron-3.5-lightning-30b-a3b','nvidia/nemotron-3.5-super-vl-120b-a12b','nvidia/nemotron-4-340b-instruct','nvidia/nemotron-4-340b-reward','nvidia/nemotron-nano-3-30b-a3b','nvidia/nemotron-parse','nvidia/nemotron-parse-2.0','nvidia/neva-22b','nvidia/nv-embedqa-mistral-7b-v2','nvidia/nvclip','nvidia/riva-translate-4b-instruct','nvidia/riva-translate-4b-instruct-v2','nvidia/vila','openai/gpt-oss-20b','poolside/laguna-xs-2.1','snowflake/arctic-embed-l','stepfun-ai/step-5-preview','writer/palmyra-creative-122b','writer/palmyra-fin-70b-32k','writer/palmyra-med-70b','writer/palmyra-med-70b-32k','z-ai/glm-5.3','z-ai/glm-5.3-flash','zyphra/zamba2-7b-instruct']

describe('custom model ranking', () => {
  it('drops embedding, rerank, guard/safety, reward, vision-only, parser, code-completion and image models', () => {
    for (const id of ['nvidia/embed-qa-4', 'nvidia/nemotron-3.5-rerank-8b', 'meta/llama-guard-4-12b', 'nvidia/llama-3.1-nemoguard-8b-content-safety', 'nvidia/nemotron-4-340b-reward', 'adept/fuyu-8b', 'google/deplot', 'microsoft/kosmos-2', 'nvidia/nvclip', 'nvidia/nemotron-parse', 'bigcode/starcoder2-15b', 'google/codegemma-7b', 'whisper-large-v3', 'tts-1', 'stable-diffusion-xl', 'llama-3-8b-base']) {
      expect(isExcludedCustomModel(id), id).toBe(true)
    }
    expect(isExcludedCustomModel('z-ai/glm-5.3')).toBe(false)
    expect(isExcludedCustomModel('meta/llama-3.2-11b-vision-instruct')).toBe(false)
  })

  it('puts current general chat models first for the NVIDIA list', () => {
    const ranked = rankCustomModels(NVIDIA)
    expect(ranked.slice(0, 5)).toEqual(['z-ai/glm-5.3', 'moonshotai/kimi-k2.6', 'openai/gpt-oss-20b', 'z-ai/glm-5.3-flash', 'deepseek-ai/deepseek-v4.1-flash'])
  })

  it('ranks newer generations and instruct models above legacy, base and specialised ones', () => {
    const ranked = rankCustomModels(NVIDIA)
    const at = (id: string) => ranked.indexOf(id)
    expect(at('nvidia/nemotron-3-ultra-550b-a55b')).toBeLessThan(at('nvidia/nemotron-4-340b-instruct'))
    expect(at('google/gemma-4-31b-it')).toBeLessThan(at('google/gemma-3-12b-it'))
    expect(at('google/gemma-3-12b-it')).toBeLessThan(at('google/gemma-2b'))
    expect(at('mistralai/mistral-large-2-instruct')).toBeLessThan(at('mistralai/mixtral-8x22b-v0.1'))
    expect(at('mistralai/mistral-7b-instruct-v0.3')).toBeLessThan(at('meta/llama2-70b'))
    expect(at('openai/gpt-oss-20b')).toBeLessThan(at('writer/palmyra-med-70b'))
    expect(at('z-ai/glm-5.3')).toBeLessThan(at('z-ai/glm-5.3-flash'))
  })

  it('works for other OpenAI-compatible catalogues and uses real created timestamps as a tie-breaker', () => {
    expect(rankCustomModels(['qwen/qwen2.5-72b-instruct', 'qwen/qwen3-235b-a22b', 'text-embedding-3-small'])[0]).toBe('qwen/qwen3-235b-a22b')
    const ranked = rankCustomModels([{ id: 'acme/chat-model-a-instruct', created: 1_700_000_000 }, { id: 'acme/chat-model-b-instruct', created: 1_790_000_000 }])
    expect(ranked[0]).toBe('acme/chat-model-b-instruct')
    expect(rankCustomModels([])).toEqual([])
  })

  it('reads parameter sizes, including mixture-of-experts totals', () => {
    expect(parameterBillions('nemotron-3-super-120b-a12b')).toBe(120)
    expect(parameterBillions('mixtral-8x22b-v0.1')).toBe(176)
    expect(parameterBillions('kimi-k2.6')).toBeNull()
  })
})
