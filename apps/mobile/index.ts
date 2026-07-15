import { registerRootComponent } from 'expo';
import './src/state/backgroundJourney';
import './src/state/backgroundLocationRefresh';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and ensures the environment is set up appropriately for Expo (and bare RN).
registerRootComponent(App);
