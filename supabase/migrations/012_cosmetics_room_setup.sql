alter table public.profiles
  add column if not exists active_name_effect text not null default 'none',
  add column if not exists active_name_color text not null default 'theme';

alter table public.shop_items drop constraint if exists shop_items_item_type_check;
alter table public.shop_items
  add constraint shop_items_item_type_check check (item_type in (
    'username_change',
    'profile_badge',
    'custom_badge',
    'homepage_feature',
    'extra_submission_slot',
    'battle_priority',
    'nameplate_icon',
    'profile_accent',
    'replay_access',
    'name_effect',
    'name_color'
  ));

alter table public.battles
  add column if not exists song_length_seconds int not null default 60,
  add column if not exists ai_instructions text not null default '';

alter table public.rooms
  add column if not exists battle_starts_in_seconds int not null default 30,
  add column if not exists song_length_seconds int not null default 60,
  add column if not exists ai_instructions text not null default '',
  add column if not exists min_rank_tier text not null default 'bronze',
  add column if not exists join_code text,
  add column if not exists code_only boolean not null default false,
  add column if not exists is_public boolean not null default true;

insert into public.shop_items (name, description, cost_tokens, item_type)
values
  ('Pulse Name Effect', 'Animated pulse pass for your producer name.', 90, 'name_effect'),
  ('Glitch Name Effect', 'Broken signal animation for your producer name.', 110, 'name_effect'),
  ('Wave Name Effect', 'Moving wave shimmer for your producer name.', 110, 'name_effect'),
  ('Ember Name Color', 'Orange and red animated name color.', 85, 'name_color'),
  ('Aurora Name Color', 'Green and blue animated name color.', 95, 'name_color'),
  ('Candy Name Color', 'Pink and gold animated name color.', 95, 'name_color')
on conflict do nothing;
