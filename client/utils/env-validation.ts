export function validateEnvKey(key: string): string | null {
  if (key === "") {
    return "Key cannot be empty";
  }
  if (/\s/.test(key)) {
    return "Key cannot contain whitespace";
  }
  return null;
}
