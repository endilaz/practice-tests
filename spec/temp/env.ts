// Reads required environment variables at module load time.
// Throws immediately with a clear message if any are missing.
// This surfaces configuration errors at startup rather than
// letting them propagate as opaque network failures later.

function requireEnv(name: string): string {
  const value = import.meta.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `Add it to .env.local in your project root.`
    )
  }
  return value
}

export const env = {
  VITE_SUPABASE_URL: requireEnv('VITE_SUPABASE_URL'),
  VITE_SUPABASE_ANON_KEY: requireEnv('VITE_SUPABASE_ANON_KEY'),
}
