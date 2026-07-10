-- Hither Pro entitlement. Client-trusted for now; server-side receipt
-- validation is a known follow-up before real payments ship.
alter table public.profiles add column pro boolean not null default false;
