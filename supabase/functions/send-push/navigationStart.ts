export function navigationStartRecipients({
  origin, senderId, userIds, usersWithHandle, usersWithStartToken,
}: {
  origin: 'manual' | 'scheduled';
  senderId: string;
  userIds: string[];
  usersWithHandle: ReadonlySet<string>;
  usersWithStartToken: ReadonlySet<string>;
}) {
  const remoteUserIds = navigationRemoteRecipients({ origin, senderId, userIds });
  return {
    existingUserIds: remoteUserIds.filter(userId => usersWithHandle.has(userId)),
    startUserIds: remoteUserIds.filter(userId => !usersWithHandle.has(userId) && usersWithStartToken.has(userId)),
    alertUserIds: remoteUserIds.filter(userId => origin === 'scheduled' || !usersWithStartToken.has(userId) || usersWithHandle.has(userId)),
  };
}
export function navigationRemoteRecipients({ origin, senderId, userIds }: {
  origin: 'manual' | 'scheduled';
  senderId: string;
  userIds: string[];
}) {
  return userIds.filter(userId => origin === 'scheduled' || userId !== senderId);
}
