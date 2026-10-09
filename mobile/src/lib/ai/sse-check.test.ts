import { Utf8StreamDecoder, parseSseBlock } from './transport'

describe('AI stream helpers', () => {
  it('reassembles multi-byte characters split across network chunks', () => {
    const text = 'Ψ ∑ 𝜋 — ok'
    const bytes = new TextEncoder().encode(text)
    const decoder = new Utf8StreamDecoder()
    let out = ''
    for (let index = 0; index < bytes.length; index += 1) out += decoder.decode(bytes.slice(index, index + 1))
    out += decoder.flush()
    expect(out).toBe(text)
  })

  it('parses named SSE events and ignores malformed payloads', () => {
    expect(parseSseBlock('event: delta\ndata: {"text":"Hi"}')).toEqual({ name: 'delta', data: { text: 'Hi' } })
    expect(parseSseBlock('event: delta\ndata: {not json')).toBeNull()
    expect(parseSseBlock('event: ping')).toBeNull()
  })
})
