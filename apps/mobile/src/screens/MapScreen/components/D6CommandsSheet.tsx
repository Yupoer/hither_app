import React from 'react';
import { StyleSheet, View } from 'react-native';
import SheetPresentation, { type SheetDetent } from '../../../components/SheetPresentation';
import { SHEET_CORNER_ACTION_INSET } from '../../../components/mapSheetChrome';
import { HITHER_ACCENT } from '../../../theme/brand';
import { QuickCommandGrid } from './QuickCommandGrid';

const COMMAND_DETENTS = [{ height: 346 }] satisfies readonly SheetDetent[];

type D6CommandsSheetProps = Pick<React.ComponentProps<typeof QuickCommandGrid>,
  'groupId' | 'isLeader' | 'requestStartDestinationId' | 'onCommandSent' | 'onClose'> & {
  open: boolean;
  onDismiss: () => void;
};

export function D6CommandsSheet({ open, onDismiss, ...commands }: D6CommandsSheetProps) {
  return (
    <SheetPresentation visible={open} detents={COMMAND_DETENTS} onClose={commands.onClose} onDismiss={onDismiss}>
      <View testID="d6-command-card" style={styles.content}>
        <QuickCommandGrid {...commands} accent={HITHER_ACCENT} onAccent="#fff" />
      </View>
    </SheetPresentation>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, minHeight: 0, padding: SHEET_CORNER_ACTION_INSET },
});
