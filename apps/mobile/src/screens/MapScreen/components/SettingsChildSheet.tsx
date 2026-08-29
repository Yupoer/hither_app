export { default } from './SettingsSheetPanel';
export type { SettingsSheetPanelProps } from './SettingsSheetPanel';
// The platform-specific wrapper consumes this same prop surface, including
// singleStage for the main settings page.
export type SettingsChildSheetProps = import('./SettingsSheetPanel').SettingsSheetPanelProps;
