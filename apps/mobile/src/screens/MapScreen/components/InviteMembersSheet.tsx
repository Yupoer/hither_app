import React from 'react';
import { ScrollView } from 'react-native';
import OverlaySheet from '../../../components/OverlaySheet';

export type InviteMembersSheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  accent: string;
  doneLabel: string;
  fitContent?: boolean;
  children: React.ReactNode;
};

/** Android/older-runtime invite sheet keeps the existing RN overlay behavior. */
export default function InviteMembersSheet({
  visible,
  onClose,
  title,
  accent,
  doneLabel,
  fitContent = false,
  children,
}: InviteMembersSheetProps) {
  return (
    <OverlaySheet
      visible={visible}
      onClose={onClose}
      title={title}
      accent={accent}
      doneLabel={doneLabel}
      edgeToEdge
    >
      {fitContent ? <ScrollView>{children}</ScrollView> : children}
    </OverlaySheet>
  );
}
