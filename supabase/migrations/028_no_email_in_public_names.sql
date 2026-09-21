-- ─────────────────────────────────────────────────────────────────────────────
-- 028 · A public name is never made out of an email address
--
-- Found in the 2026-09-21 re-audit, on Discover and the leaderboard: a
-- portfolio's author was shown as "<localpart><provider>com" — an email address
-- with the punctuation stripped, which anyone can read back.
--
-- Two functions, each reasonable on its own, compose into that:
--
--   handle_new_user   display_name := metadata name, else full_name, else EMAIL
--   generate_username username     := lowercase alphanumerics of display_name
--
-- The application already refuses to SHOW an email-shaped display name
-- (publicDisplayName in services/discover.ts: "the username stands in"). But
-- the username it stands in with was generated from that same email, so the
-- guard hid the address in one field and published it in the next.
--
-- The register form requires a name, so this only happens when an account is
-- created without one — OAuth, the admin API, an older signup path. That is
-- rare, and the consequence is publishing someone's email to every signed-in
-- user the moment they make a portfolio public, without telling them.
--
-- Both functions now refuse the email:
--   - handle_new_user falls back to 'Inversor', not to NEW.email.
--   - generate_username ignores a display name that looks like an email and
--     starts from 'investor', as it already did for names too short to use.
--
-- Existing rows are NOT rewritten. A username is also a URL (/profile/<name>)
-- and changing one breaks every link to it; that is the account holder's call,
-- made in Settings → Perfil, not a migration's.
--
-- handle_new_user is reproduced exactly as 025 left it, apart from the fallback.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'display_name'), ''),
      NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
      -- Not NEW.email: whatever lands here becomes the seed of a public
      -- username. The account holder can name themselves in Settings.
      'Inversor'
    )
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- The funnel's first step. No personal data: the internal id and the event.
  BEGIN
    INSERT INTO public.funnel_events (user_id, event)
    VALUES (NEW.id, 'cuenta_creada')
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'funnel_events: no se pudo registrar cuenta_creada (%)', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_username()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  base_name TEXT;
  final_name TEXT;
  counter INTEGER := 0;
BEGIN
  -- A display name with an @ in it is an email address. Stripping its
  -- punctuation does not anonymise it — "anagmailcom" reads straight back.
  IF NEW.display_name IS NULL OR POSITION('@' IN NEW.display_name) > 0 THEN
    base_name := 'investor';
  ELSE
    base_name := LOWER(REGEXP_REPLACE(NEW.display_name, '[^a-zA-Z0-9]', '', 'g'));
  END IF;

  IF LENGTH(base_name) < 3 THEN
    base_name := 'investor';
  END IF;

  final_name := base_name;
  WHILE EXISTS(
    SELECT 1 FROM profiles WHERE username = final_name AND user_id != NEW.user_id
  ) LOOP
    counter := counter + 1;
    final_name := base_name || counter::TEXT;
  END LOOP;

  NEW.username := final_name;
  RETURN NEW;
END;
$$;
