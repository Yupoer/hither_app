/**
 * KML/KMZ filesystem I/O boundary.
 *
 * UI components must not import `expo-file-system` or branch on `Platform.OS`.
 * Pure load pipeline (`utils/kmlLoad.ts`) receives this facade as `KmlLoadIo`.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type { KmlLoadIo } from '../utils/kmlLoad';

/** Default production I/O for DocumentPicker assets → cache → read. */
export function createDefaultKmlLoadIo(): KmlLoadIo {
  return {
    platform: Platform.OS,
    materializeToCache: async (uri, suggestedName) => {
      const cacheRoot = FileSystem.cacheDirectory;
      if (!cacheRoot) {
        // No cache dir (web/tests) — return original URI.
        return uri;
      }
      const safe = suggestedName.replace(/[^\w.\-]+/g, '_') || 'import.bin';
      const target = `${cacheRoot}kml-import-${Date.now()}-${safe}`;
      // copyToCacheDirectory may already have given us a file:// URI; still
      // re-copy so content:// and cloud provider URIs become stable.
      try {
        await FileSystem.copyAsync({ from: uri, to: target });
        return target;
      } catch {
        // If already in app sandbox, reading the original may still work.
        return uri;
      }
    },
    readText: async (fileUri) => FileSystem.readAsStringAsync(fileUri),
    readBinary: async (fileUri) => {
      const b64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      // Decode base64 → ArrayBuffer without Buffer (Hermes-friendly).
      const binary = globalThis.atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    },
    getSize: async (fileUri) => {
      try {
        const info = await FileSystem.getInfoAsync(fileUri);
        if (info.exists && 'size' in info && typeof info.size === 'number') {
          return info.size;
        }
      } catch {
        // ignore
      }
      return null;
    },
  };
}
