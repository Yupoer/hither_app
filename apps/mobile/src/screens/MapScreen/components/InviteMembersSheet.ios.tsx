import React from 'react';
import SettingsChildSheet from './SettingsChildSheet';
import type { InviteMembersSheetProps } from './InviteMembersSheet';

/** iOS invite sheet uses the native SwiftUI detents: 52% initially, 80% expanded. */
export default function InviteMembersSheet({
  visible,
  onClose,
  title,
  doneLabel,
  children,
}: InviteMembersSheetProps) {
  return (
    <SettingsChildSheet
      visible={visible}
      onClose={onClose}
      title={title}
      doneLabel={doneLabel}
      initialStage={0}
      stageTwoRatio={0.8}
      wrapContentInScrollView={false}
    >
      {children}
    </SettingsChildSheet>
  );
}
