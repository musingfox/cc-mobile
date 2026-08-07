export type PushKind = "turn" | "permission";

export interface PushPayload {
  kind: PushKind;
  title: string;
  body: string;
  tag: string;
}

export function buildPayload(kind: PushKind): PushPayload {
  if (kind === "permission") {
    return {
      kind,
      title: "CCMobile",
      body: "Permission needed",
      tag: "cc-mobile-push-permission",
    };
  }
  return {
    kind,
    title: "CCMobile",
    body: "A turn finished",
    tag: "cc-mobile-push-turn",
  };
}
