# ADR-001: Use Zod for WebSocket Message Validation

## Status
Accepted

## Context
WebSocket messages arrive as raw JSON strings. TypeScript types are erased at runtime, so we need runtime validation. The WebSocket protocol has 15+ message types (7 client→server, 8 server→client).

## Decision
Use Zod schemas as the single source of truth for both runtime validation and TypeScript types.

## Rationale
- Zod provides runtime validation via `.parse()` and TypeScript type inference via `z.infer<>` — one definition, two outputs
- Elysia's `.ws()` natively supports schema validation, which Zod integrates with directly
- Without Zod, we'd need hand-written `if/typeof` guards for every message type, losing the benefit of Elysia's schema validation
- Zod is the de facto standard for TypeScript runtime validation (~25M weekly npm downloads)

## Alternatives Considered
- **Pure TypeScript types + manual validation**: duplicates type definitions, error-prone
- **io-ts / typebox**: viable but less ecosystem support; Elysia has first-class typebox support but Zod is more widely known
