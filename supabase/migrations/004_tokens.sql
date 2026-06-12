create or replace function public.increment_submission_vote(submission_id_input uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.submissions
  set vote_count = vote_count + 1
  where id = submission_id_input;
$$;

create or replace function public.apply_token_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set
    tokens = greatest(tokens + new.amount, 0),
    total_tokens_earned = case
      when new.amount > 0 then total_tokens_earned + new.amount
      else total_tokens_earned
    end
  where id = new.user_id;
  return new;
end;
$$;

create trigger token_transaction_apply
after insert on public.token_transactions
for each row execute function public.apply_token_transaction();

create or replace function public.award_enter_tokens()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_count int;
begin
  select count(*) into previous_count from public.submissions where user_id = new.user_id and id <> new.id;

  insert into public.token_transactions(user_id, amount, reason, battle_id)
  values (new.user_id, 5, 'battle_enter', new.battle_id);

  if previous_count = 0 then
    insert into public.token_transactions(user_id, amount, reason, battle_id)
    values (new.user_id, 20, 'first_battle', new.battle_id);
  end if;

  update public.profiles
  set battles_entered = battles_entered + 1
  where id = new.user_id;

  return new;
end;
$$;

create trigger submission_enter_rewards
after insert on public.submissions
for each row execute function public.award_enter_tokens();

insert into public.shop_items (name, description, cost_tokens, item_type)
values
  ('Username Change', 'Change your public RUNDATBEAT handle.', 50, 'username_change'),
  ('Custom Profile Badge', 'Add a custom title under your name. Max 12 characters.', 80, 'profile_badge'),
  ('Homepage Feature', 'Feature your producer profile on the homepage rotation.', 150, 'homepage_feature'),
  ('Extra Submission Slot', 'Reserve one extra beat submission slot for a battle.', 60, 'extra_submission_slot')
on conflict do nothing;
