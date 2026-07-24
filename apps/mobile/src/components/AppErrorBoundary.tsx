import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { logError, logEvent } from '../utils/activityLog';
import { getLastScreenName } from '../state/performance';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  retryCount: number;
}

/**
 * Root React Error Boundary. Coexists with ErrorUtils global handler —
 * does not replace it. Records a sanitized react_render error and shows retry.
 * Does not catch event-handler throws, native crash, or ANR.
 */
export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, retryCount: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    logError('react_render', error, {
      lastScreen: getLastScreenName(),
      isFatal: false,
      retryCount: this.state.retryCount,
    });
    logEvent('react_render_boundary', {
      lastScreen: getLastScreenName(),
      retryCount: this.state.retryCount,
    });
  }

  private handleRetry = (): void => {
    // Controlled remount of the React tree under this boundary — not infinite.
    this.setState((prev) => ({
      hasError: false,
      retryCount: prev.retryCount + 1,
    }));
    logEvent('react_render_retry', {
      lastScreen: getLastScreenName(),
      retryCount: this.state.retryCount + 1,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
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
    // retryCount in key forces a clean remount of children after Retry.
    return (
      <React.Fragment key={`app-boundary-${this.state.retryCount}`}>
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
