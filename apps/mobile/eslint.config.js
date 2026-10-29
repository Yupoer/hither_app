const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const noReactEffects = {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { allowMountEffect: { type: 'boolean' } }, additionalProperties: false }],
    messages: { forbidden: 'React {{name}} is forbidden here. Use a domain resource with useMountEffect.' },
  },
  create(context) {
    const source = context.sourceCode;
    const forbidden = (name) => name === 'useLayoutEffect' ||
      (name === 'useEffect' && !context.options[0]?.allowMountEffect);
    const key = (node) => node?.type === 'Identifier' ? node.name :
      node?.type === 'Literal' ? node.value :
        node?.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0].value.cooked : undefined;
    const staticKey = (node, computed) => !computed || node.type !== 'Identifier' ? key(node) : undefined;
    const report = (node, name) => {
      if (forbidden(name)) context.report({ node, messageId: 'forbidden', data: { name } });
    };
    const select = (root, name) => root === 'react' ?
      (name === 'default' ? 'react' : name) : undefined;
    const patternPath = (pattern, name, path = []) => {
      if (pattern.type === 'AssignmentPattern') return patternPath(pattern.left, name, path);
      if (pattern.type === 'Identifier') return pattern.name === name ? path : undefined;
      if (pattern.type !== 'ObjectPattern') return undefined;
      for (const property of pattern.properties) {
        if (property.type !== 'Property') continue;
        const nameKey = staticKey(property.key, property.computed);
        if (nameKey === undefined) continue;
        const found = patternPath(property.value, name, [...path, nameKey]);
        if (found) return found;
      }
      return undefined;
    };
    const resolve = (node, seen = new Set()) => {
      if (!node) return undefined;
      if (['ChainExpression', 'TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression',
        'TSTypeAssertion'].includes(node.type)) return resolve(node.expression, seen);
      if (node.type === 'TSExternalModuleReference') return node.expression.value === 'react' ? 'react' : undefined;
      if (node.type === 'TSQualifiedName') return select(resolve(node.left, seen), key(node.right));
      if (node.type === 'MemberExpression') return select(resolve(node.object, seen), staticKey(node.property, node.computed));
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier' &&
          node.callee.name === 'require' && node.arguments[0]?.value === 'react') {
        let scope = source.getScope(node);
        while (scope) {
          const variable = scope.set.get('require');
          if (variable?.defs.length) return undefined;
          scope = scope.upper;
        }
        return 'react';
      }
      if (node.type !== 'Identifier') return undefined;
      let scope = source.getScope(node);
      while (scope && !scope.set.has(node.name)) scope = scope.upper;
      const variable = scope?.set.get(node.name);
      if (!variable || seen.has(variable)) return undefined;
      const nextSeen = new Set([...seen, variable]);
      for (const def of variable.defs) {
        if (def.type === 'ImportBinding' &&
            def.parent.importKind !== 'type' && def.node.importKind !== 'type') {
          if (def.parent.type === 'TSImportEqualsDeclaration') {
            return resolve(def.parent.moduleReference, nextSeen);
          }
          if (def.parent.type === 'ImportDeclaration' && def.parent.source.value === 'react') {
            return def.node.type === 'ImportSpecifier' ? select('react', key(def.node.imported)) : 'react';
          }
        }
        if (def.type === 'Variable') {
          const path = patternPath(def.node.id, node.name);
          if (path) return path.reduce(select, resolve(def.node.init, nextSeen));
        }
      }
      return undefined;
    };
    const checkPattern = (node, root) => {
      if (node.type === 'AssignmentPattern') return checkPattern(node.left, root);
      if (node.type !== 'ObjectPattern') return;
      for (const property of node.properties) {
        if (property.type !== 'Property') continue;
        const value = select(root, staticKey(property.key, property.computed));
        report(property, value);
        checkPattern(property.value, value);
      }
    };
    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'react' || node.importKind === 'type') return;
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier' && specifier.importKind !== 'type') report(specifier, key(specifier.imported));
        }
      },
      TSImportEqualsDeclaration(node) {
        if (node.importKind !== 'type') report(node, resolve(node.moduleReference));
      },
      MemberExpression(node) { report(node, resolve(node)); },
      VariableDeclarator(node) { checkPattern(node.id, resolve(node.init)); },
      ExportNamedDeclaration(node) {
        if (node.source?.value !== 'react' || node.exportKind === 'type') return;
        for (const specifier of node.specifiers) {
          if (specifier.exportKind !== 'type') {
            const name = key(specifier.local);
            report(specifier, name === 'default' ? 'useLayoutEffect' : name);
          }
        }
      },
      ExportAllDeclaration(node) {
        if (node.source.value === 'react' && node.exportKind !== 'type') report(node, 'useLayoutEffect');
      },
    };
  },
};

const LEGACY_REACT_COMPILER_EXCEPTIONS = {
  'react-hooks/refs': [
    'src/components/AmicroButton.tsx',
    'src/components/BottomSheet.tsx',
    'src/components/DestinationReorderList.tsx',
    'src/components/DestinationSearch.tsx',
    'src/components/GroupMap.tsx',
    'src/components/OtaUpdateToast.tsx',
    'src/components/OverlaySheet.tsx',
    'src/components/useMemberMarkerMotion.ts',
    'src/screens/MapScreen.tsx',
    'src/screens/MapScreen/components/AddPlaceConfirmCard.tsx',
    'src/screens/MapScreen/components/SettingsChildSheet.ios.tsx',
    'src/screens/MapScreen/components/SettingsSheetPanel.tsx',
    'src/screens/MapScreen/components/StorePane.tsx',
    'src/screens/MapScreen/hooks/useCarouselSelection.ts',
    'src/screens/MapScreen/hooks/useCoordinationRequests.ts',
    'src/screens/MapScreen/hooks/useDeviceLocation.ts',
    'src/screens/MapScreen/hooks/useGatherCardExpansion.ts',
    'src/screens/MapScreen/hooks/useGatheringCompletion.ts',
    'src/screens/MapScreen/hooks/useGatheringWorkflow.ts',
    'src/screens/MapScreen/hooks/useGroupRole.ts',
    'src/screens/MapScreen/hooks/useJourneyNavigation.ts',
    'src/screens/MapScreen/hooks/usePendingPlaceEntrance.ts',
    'src/screens/MapScreen/hooks/usePersonalProgressSurfaces.ts',
    'src/screens/MapScreen/hooks/useRouteDraft.ts',
    'src/screens/MapScreen/hooks/useStoreEntitlements.ts',
    'src/screens/MapScreen/hooks/useStragglerReporting.ts',
    'src/screens/MapScreen/hooks/useVisitHistory.ts',
    'src/state/SessionContext.tsx',
    'src/state/useForegroundReconcile.ts',
    'src/state/useGroupNotifications.ts',
    'src/state/useGroupState.ts',
    'src/state/useJoinedGroups.ts',
    'src/state/useLiveActivity.ts',
    'src/state/useNavigationSession.ts',
    'src/state/useOrganizerExceptions.ts',
    'src/state/useStragglerAlerts.ts',
    'src/state/useSubgroupInvites.ts',
  ],
  'react-hooks/set-state-in-effect': [
    'App.tsx',
  ],
  'react-hooks/immutability': [
    'src/components/AmicroButton.tsx',
    'src/components/BottomSheet.tsx',
    'src/components/DestinationReorderList.tsx',
    'src/components/DestinationSearch.tsx',
    'src/components/GroupMap.tsx',
    'src/components/MetalforgeBackground.tsx',
    'src/components/MetalforgeStarfield.tsx',
    'src/components/OverflowMarquee.tsx',
    'src/components/OverlaySheet.tsx',
    'src/components/useMemberMarkerMotion.ts',
    'src/components/WaveLoading.tsx',
    'src/onboarding/steps/CelebrationStep.tsx',
    'src/onboarding/steps/IntroStep.tsx',
    'src/onboarding/steps/MascotStep.tsx',
    'src/onboarding/steps/PrimaryButton.tsx',
    'src/onboarding/steps/StepShell.tsx',
    'src/onboarding/steps/ThemeStep.tsx',
    'src/screens/MapScreen.tsx',
    'src/screens/MapScreen/components/Segmented.tsx',
    'src/screens/MapScreen/components/SettingsSheetPanel.tsx',
    'src/screens/MapScreen/hooks/useDeviceLocation.ts',
    'src/screens/MapScreen/hooks/useMapKitRoutes.ts',
    'src/screens/MapScreen/hooks/useMemberPresence.ts',
    'src/screens/MapScreen/hooks/usePendingPlaceEntrance.ts',
    'src/screens/MapScreen/MapScreenChromeResources.tsx',
    'src/screens/RoleSelectScreen.tsx',
    'src/state/useForegroundReconcile.ts',
    'src/state/useGroupState.ts',
    'src/state/useJoinedGroups.ts',
    'src/state/useNavigationSession.ts',
  ],
  'react-hooks/purity': [
    'src/components/AccountSheet.tsx',
    'src/components/GroupMap.tsx',
    'src/screens/LoginScreen.tsx',
    'src/screens/MapScreen.tsx',
    'src/screens/MapScreen/hooks/useMeetTimeEditor.ts',
    'src/screens/MapScreen/hooks/usePersonalProgressSurfaces.ts',
    'src/state/useLiveActivity.ts',
  ],
  'react-hooks/preserve-manual-memoization': [
    'src/screens/MapScreen.tsx',
    'src/state/useOrganizerExceptions.ts',
  ],
  'react-hooks/static-components': [
    'src/components/NativeGlassButton.tsx',
    'src/components/ReactNativeSheetHeaderAction.tsx',
  ],
  'expo/no-dynamic-env-var': [
    'src/premiumCatalog.ts',
  ],
};

module.exports = defineConfig([
  expoConfig,
  {
    files: ['**/*.cjs'],
    languageOptions: { globals: { __dirname: 'readonly' } },
  },
  {
    ignores: ['ios/**', 'android/**', 'coverage/**', '**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  ...Object.entries(LEGACY_REACT_COMPILER_EXCEPTIONS).map(([rule, files]) => ({
    files,
    rules: { [rule]: 'off' },
  })),
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    plugins: { hither: { rules: { 'no-react-effects': noReactEffects } } },
    rules: { 'hither/no-react-effects': 'error' },
  },
  {
    files: ['src/hooks/useMountEffect.ts'],
    rules: { 'hither/no-react-effects': ['error', { allowMountEffect: true }] },
  },
]);
