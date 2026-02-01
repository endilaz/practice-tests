await supabase.auth.signUp({
  email,
  password,
  options: {
    emailRedirectTo: window.location.origin
  }
})