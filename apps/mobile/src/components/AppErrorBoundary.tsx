import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { logError, logEvent } from '../utils/activityLog';
import { getLastRoute, getLastScreenName } from '../state/performance';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  /** Bumped only on user Retry to remount children. */
  remountKey: number;
  /** True when a Retry remount still failed — no further Retry. */
  terminal: boolean;
}

/**
 * Root React Error Boundary. Coexists with ErrorUtils global handler —
 * does not replace it. Records a sanitized react_render error and shows retry.
 * Does not catch event-handler throws, native crash, or ANR.
 * Retry only remounts children under this boundary — does not clear
 * session, membership, or active group state.
 */
export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, remountKey: 0, terminal: false };

  /**
   * True only between user Retry and either: (a) children successfully commit
   * after remount, or (b) remount throws again → terminal. Cleared on success
   * so a later unrelated error still gets its own Retry.
   */
  private pendingRetryEpisode = false;

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const route = getLastRoute();
    const lastScreen = getLastScreenName();
    // Only treat as "still failing after Retry" when a Retry remount has not
    // successfully committed children yet (pendingRetryEpisode).
    const afterRetry = this.pendingRetryEpisode;
    const terminal = afterRetry || this.state.terminal;

    if (terminal && !this.state.terminal) {
      this.setState({ terminal: true });
      this.pendingRetryEpisode = false;
    }

    logError('react_render', error, {
      lastScreen,
      routeName: route.routeName,
      routeKey: route.routeKey || null,
      screen: lastScreen,
      componentStack: info.componentStack,
      isFatal: false,
      retryCount: this.state.remountKey,
      subsystem: 'react_render',
      source: 'AppErrorBoundary',
    });
    logEvent('react_render_boundary', {
      lastScreen,
      routeName: route.routeName,
      retryCount: this.state.remountKey,
      terminal,
    });
    if (terminal) {
      logEvent('react_render_terminal', {
        lastScreen,
        routeName: route.routeName,
        retryCount: this.state.remountKey,
      });
    }
  }

  componentDidUpdate(_prevProps: Props, prevState: State): void {
    // Successful remount after Retry — end the episode so a later unrelated
    // error still gets its own Retry (not immediate terminal).
    if (prevState.hasError && !this.state.hasError && !this.state.terminal) {
      this.pendingRetryEpisode = false;
    }
  }

  private handleRetry = (): void => {
    if (this.state.terminal) return;
    this.pendingRetryEpisode = true;
    // Controlled remount of the React tree under this boundary — not infinite.
    this.setState((prev) => ({
      hasError: false,
      remountKey: prev.remountKey + 1,
      terminal: false,
    }));
    logEvent('react_render_retry', {
      lastScreen: getLastScreenName(),
      routeName: getLastRoute().routeName,
      retryCount: this.state.remountKey + 1,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.state.terminal) {
        // After Retry still fails, stop offering Retry. Do not clear app state.
        return (
          <View style={styles.container} accessibilityRole="alert">
            <Text style={styles.title}>Still not working</Text>
            <Text style={styles.body}>
              The screen failed again after retry. Close and reopen the app, or
              return later. Your group and session data were not cleared.
            </Text>
          </View>
        );
      }
      return (
        <View style={styles.container} accessibilityRole="alert">
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            The screen hit an unexpected error. You can try again.
          </Text>
          <Pressable
            onPress={this.handleRetry}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Retry"
          >
            <Text style={styles.buttonText}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    // remountKey in key forces a clean remount of children after Retry.
    return (
      <React.Fragment key={`app-boundary-${this.state.remountKey}`}>
        {this.props.children}
      </React.Fragment>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: '#0E1320',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F5F7FB',
    marginBottom: 10,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: '#9AA6BF',
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    minWidth: 140,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: '#F5B142',
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1206',
  },
});
