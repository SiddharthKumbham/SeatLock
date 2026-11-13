export type Credentials = { email: string; password: string };
export type Registration = Credentials & { name: string };

export function parseCredentials(value: unknown): Credentials | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.email !== "string" || typeof input.password !== "string") return null;
  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (!input.password || input.password.length > 128) return null;
  return { email, password: input.password };
}
export function parseRegistration(value: unknown): Registration | null {
  const credentials = parseCredentials(value);
  if (!credentials || !value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.name !== "string") return null;
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 100 || credentials.password.length < 12) return null;
  return { ...credentials, name };
}
