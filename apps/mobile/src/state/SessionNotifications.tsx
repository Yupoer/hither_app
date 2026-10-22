import React from 'react';
import { usePushRegistration } from './usePushRegistration';
import { useGroupNotifications } from './useGroupNotifications';
import { useSubgroupInvites } from './useSubgroupInvites';

export function SessionNotifications() {
  const pushRegistration = usePushRegistration();
  const groupNotifications = useGroupNotifications();
  const invites = useSubgroupInvites();
  return <>
    <React.Fragment key="push-registration">{pushRegistration}</React.Fragment>
    <React.Fragment key="group-notifications">{groupNotifications}</React.Fragment>
    <React.Fragment key="subgroup-invites">{invites.lifecycle}</React.Fragment>
  </>;
}
