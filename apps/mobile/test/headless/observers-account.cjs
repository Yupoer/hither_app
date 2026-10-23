const React = require('react');
const { View } = require('react-native');
const AppErrorBoundary = require('../../src/components/AppErrorBoundary').default;
const GroupLoadError = require('../../src/components/GroupLoadError').default;
const { classifyOperationError } = require('../../src/utils/operationError');

function RenderFault({ crash }) {
  if (crash) throw new Error('Injected external render failure');
  return React.createElement(View, { testID: 'boundary-content' });
}

exports.default = function ErrorBoundaryObserver({ crash = false }) {
  return React.createElement(AppErrorBoundary, null, React.createElement(RenderFault, { crash }));
};

exports.GroupLoadObserver = function GroupLoadObserver({ loading = false, onRetry, colors }) {
  return React.createElement(GroupLoadError, { error: classifyOperationError(new Error('Network request failed')),
    loading, retry: onRetry, color: colors.accent });
};
