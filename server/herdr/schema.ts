import { z } from "zod";

// ---------------------------------------------------------------------------
// Response envelope
//
// herdr's wire protocol is NOT JSON-RPC 2.0: one newline-terminated JSON line
// per response, `{id, result}` on success, `{id, error}` on failure.
// Correlation is per-connection (one request per connection); protocol errors
// reply with an empty `id`.
// ---------------------------------------------------------------------------

export const RpcErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
  })
  .passthrough();
export type RpcError = z.infer<typeof RpcErrorSchema>;

export const ErrorEnvelopeSchema = z
  .object({
    id: z.string(),
    error: RpcErrorSchema,
  })
  .passthrough();

export const ResultEnvelopeSchema = z
  .object({
    id: z.string(),
    result: z.record(z.unknown()),
  })
  .passthrough();

export const ResponseEnvelopeSchema = z.union([ErrorEnvelopeSchema, ResultEnvelopeSchema]);
export type ResponseEnvelope = z.infer<typeof ResponseEnvelopeSchema>;
