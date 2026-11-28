-- Where the burned-in scoreboard sits on a download cut. Same choices as the
-- stream overlay's ?pos= (src/components/overlay/ScorebugBar.tsx).
alter table public.rr_film_exports
  add column overlay_position text not null default 'bottom-left'
    constraint rr_film_exports_overlay_position
    check (overlay_position in ('bottom-left', 'bottom-center', 'top-left', 'top-center'));

grant insert (overlay_position) on public.rr_film_exports to authenticated;
