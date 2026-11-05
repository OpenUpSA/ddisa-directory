// Supabase connection for the static DDISA directory.
// Edit the two values below, or set SUPABASE_URL and SUPABASE_ANON_KEY as environment variables (Netlify > Site settings > Environment variables) and rebuild.
// Use the anon/public key from Supabase > Settings > API: it is safe to expose
// in the browser because row-level security only allows reading published
// profiles. Never put the service-role key in this file.
window.DDISA_ENV = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY"
};
