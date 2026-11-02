insert into auth.users(id,email) values ('11111111-1111-4111-8111-111111111111','schedule-upgrade@example.test');
insert into public.groups(id,name,invite_code,created_by) values
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Upgrade','UPGR01','11111111-1111-4111-8111-111111111111');
insert into public.memberships(group_id,user_id,role) values
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111','leader');
insert into public.itinerary_items(id,group_id,title,latitude,longitude,position,day,meet_at,meet_set_by) values
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0001','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Historical',25,121,0,1,now()-interval '1 minute','11111111-1111-4111-8111-111111111111'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeee0002','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Future',25,121,1,1,now()+interval '1 hour','11111111-1111-4111-8111-111111111111');
