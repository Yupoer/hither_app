import React from 'react';
import SettingsChildSheet from './SettingsChildSheet';
import type { InviteMembersSheetProps } from './InviteMembersSheet';

export default function InviteMembersSheet({
  visible,
  onClose,
  title,
  doneLabel,
  fitContent = false,
  children,
}: InviteMembersSheetProps) {
  return (
    <SettingsChildSheet
      visible={visible}
      onClose={onClose}
      title={title}
      titleFontSize={25}
      darkMaterial
      doneLabel={doneLabel}
      fitContent={fitContent}
      stageOneRatio={fitContent ? 0.36 : undefined}
      wrapContentInScrollView={fitContent}
    >
      {children}
    </SettingsChildSheet>
  );
}
