// MooseTown – koppeling met je Supabase-project.
// Vind deze twee waarden in Supabase: Project Settings → API (of: Connect → App Frameworks).
// De anon key is bedoeld om in de browser te staan; de toegang wordt geregeld door de regels in schema.sql.
// Zet hier NOOIT de service_role key neer.
window.MOOSETOWN_CONFIG = {
  supabaseUrl: 'https://spgfpanlnjbsuzgkxxhm.supabase.co',      // bijv. 'https://abcdefghijkl.supabase.co'
  supabaseAnonKey: 'sb_publishable_MxCb45M9Q91zeaRzKdONaQ_MC6lGps4'   // begint meestal met 'eyJ…' of 'sb_publishable_…'
};
