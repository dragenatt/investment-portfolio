-- ─────────────────────────────────────────────────────────────────────────────
-- 025 · The funnel's first step is recorded where the account is created
--
-- funnel_events held three rows in production: two "primera_simulacion_montecarlo"
-- and one "portafolio_creado". Not one "cuenta_creada", the step every other
-- number is a fraction of.
--
-- The reason is in the register page, which said so itself: the browser posts
-- the step to /api/analytics/event right after signUp, that endpoint takes the
-- identity from the session — never from the body, so a client cannot claim a
-- step for someone else — and with email confirmation on there is no session
-- yet. The early return meant the step was simply never counted.
--
-- So it is recorded where the account actually comes into existence: the trigger
-- that already creates the profile. The insert cannot fail a signup — it is
-- wrapped, and a failure is a warning in the logs — and the partial unique index
-- from 012 keeps it once per user.
--
-- The profile insert is unchanged, kept exactly as production has it (with the
-- full_name fallback and ON CONFLICT from the 2026-03-20 fix).
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
      NEW.raw_user_meta_data->>'display_name',
      NEW.raw_user_meta_data->>'full_name',
      NEW.email
    )
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- The funnel's first step. No personal data: the internal id and the event.
  BEGIN
    INSERT INTO public.funnel_events (user_id, event)
    VALUES (NEW.id, 'cuenta_creada')
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- A funnel row is never worth failing a signup for.
    RAISE WARNING 'funnel_events: no se pudo registrar cuenta_creada (%)', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;
