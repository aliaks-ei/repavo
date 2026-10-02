import OpenAI from 'openai'
import type { H3Event } from 'h3'
import type { ResponseInput } from 'openai/resources/responses/responses'

type Schema = Record<string, unknown>

// Strict structured outputs need every property required and no extra keys.
export const obj = (properties: Record<string, Schema>): Schema => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false
})
export const str = { type: 'string' }
export const num = { type: 'number' }
export const int = { type: 'integer' }
export const nullable = (s: Schema): Schema => ({ ...s, type: [s.type as string, 'null'] })
export const arr = (items: Schema): Schema => ({ type: 'array', items })
export const oneOf = (values: string[]): Schema => ({ type: 'string', enum: values })

export function openai(event: H3Event) {
  const config = useRuntimeConfig(event)
  if (!config.openaiApiKey) throw createError({ statusCode: 503, statusMessage: 'The assistant is not set up. Add NUXT_OPENAI_API_KEY on the server.' })
  return { client: new OpenAI({ apiKey: config.openaiApiKey }), config }
}

export function openaiError(e: unknown) {
  if ((e as { statusCode?: number }).statusCode) return e
  const message = e instanceof OpenAI.APIError ? `OpenAI error ${e.status ?? ''}: ${e.message}` : (e as Error).message
  return createError({ statusCode: 502, statusMessage: message.slice(0, 300) })
}

export async function structured<T>(event: H3Event, opts: { model: 'main' | 'chat', name: string, schema: Schema, input: ResponseInput }): Promise<T> {
  const { client, config } = openai(event)
  try {
    const res = await client.responses.create({
      model: opts.model === 'chat' ? config.openaiChatModel : config.openaiModel,
      reasoning: { effort: 'medium' },
      input: opts.input,
      text: { format: { type: 'json_schema', name: opts.name, schema: opts.schema, strict: true } }
    })
    if (res.status === 'incomplete') throw new Error(`The model stopped early (${res.incomplete_details?.reason ?? 'unknown reason'}).`)
    return JSON.parse(res.output_text) as T
  } catch (e) {
    throw openaiError(e)
  }
}

export function errorMessage(e: unknown): string {
  const err = e as { statusMessage?: string, message?: string }
  return err.statusMessage || err.message || 'Unknown error'
}
