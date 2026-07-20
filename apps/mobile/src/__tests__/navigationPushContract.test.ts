import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const sendPushDir = join(__dirname, '../../../../supabase/functions/send-push');
const apns = readFileSync(join(sendPushDir, 'apns.ts'), 'utf8');
const messages = readFileSync(join(sendPushDir, 'messages.ts'), 'utf8');
const handler = readFileSync(join(sendPushDir, 'index.ts'), 'utf8');
const fcmPath = join(sendPushDir, 'fcm.ts');
const fcm = existsSync(fcmPath) ? readFileSync(fcmPath, 'utf8') : '';

describe('navigation ActivityKit push orchestration', () => {
  it('builds an ActivityKit start request with the production liveactivity topic', () => {
    expect(apns).toContain('buildLiveActivityStartRequest');
    expect(apns).toContain('event: "start"');
    expect(apns).toContain('"attributes-type": payload.attributesType');
    expect(apns).toContain('attributes: payload.attributes');
    expect(apns).toContain('"content-state": payload.contentState');
    expect(apns).toContain('`${cfg.bundleId}.push-type.liveactivity`');
    expect(apns).toContain('"apns-push-type": "liveactivity"');
    expect(apns).toContain('api.push.apple.com');
  });

  it('routes navigation start to push-to-start tokens and update/end to activity tokens', () => {
    expect(messages).toContain('"navigation_session"');
    expect(handler).toContain('device_live_activity_tokens');
    expect(handler).toContain('push_to_start_token');
    expect(handler).toContain('sendLiveActivityStartApns');
    expect(handler).toContain('payload.version === 1');
    expect(handler).toContain('live_activity_sessions');
    expect(handler).toMatch(
      /payload\.category === "navigation_session"[\s\S]*payload\.status === "active" \? "update"[\s\S]*: "end"/,
    );
  });

  it('falls back to normal alert only for users without a usable start token', () => {
    expect(handler).toContain('fallbackUserIds');
    expect(handler).toContain('usersWithStartToken');
    expect(handler).toContain('filterNotificationPreferences');
  });

  it('prunes only the exact dead push-to-start or update token', () => {
    expect(handler).toMatch(/device_live_activity_tokens[\s\S]*\.in\("push_to_start_token", deadStartTokens\)/);
    expect(handler).toMatch(/live_activity_sessions[\s\S]*\.in\("push_token", deadActivityTokens\)/);
  });

  it('includes the session identity in start content state', () => {
    expect(handler).toContain('navigationSessionId: payload.session_id');
    expect(handler).toContain('status: "starting"');
    expect(handler).toContain('attributesType: "HitherGroupAttributes"');
  });

  it('fans out device alerts through APNs and FCM by platform', () => {
    expect(existsSync(fcmPath)).toBe(true);
    expect(fcm).toContain('buildFcmMessage');
    expect(fcm).toContain('FIREBASE_SERVICE_ACCOUNT_JSON');
    expect(fcm).toContain('isFcmDeadToken');
    expect(handler).toContain('select("user_id, token, platform")');
    expect(handler).toContain('platform === "android"');
    expect(handler).toContain('sendFcm');
    expect(handler).toContain('apnsSent');
    expect(handler).toContain('fcmSent');
    expect(handler).toContain('location_refresh');
    expect(handler).toContain('sendFcmData');
  });
});
