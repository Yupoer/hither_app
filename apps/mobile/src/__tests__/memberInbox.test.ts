import { projectMemberInbox } from '../screens/MapScreen/memberInbox';

it('counts three requests on Members and groups them two and one by sender', () => {
  const result = projectMemberInbox({
    startRequests: [
      { id: '1', senderId: 'a', title: 'Museum' },
      { id: '2', senderId: 'a', title: 'Lunch' },
      { id: '3', senderId: 'b', title: 'Station' },
    ],
    destinationRequests: [],
    notices: [],
    coordination: [],
    memberIds: new Set(['a', 'b', 'c', 'leader']),
    userId: 'leader',
    isLeader: true,
    seen: {},
  });
  expect(result.total).toBe(3);
  expect(result.byMember.get('a')).toMatchObject({ count: 2, entries: [
    { request: { title: 'Museum' } }, { request: { title: 'Lunch' } },
  ] });
  expect(result.byMember.get('b')).toMatchObject({ count: 1, entries: [{ request: { title: 'Station' } }] });
  expect(result.byMember.get('c')).toBeUndefined();
});
