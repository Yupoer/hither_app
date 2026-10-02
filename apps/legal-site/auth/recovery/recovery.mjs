const authUrl = 'https://htqrucnjafhhvxdqslbv.supabase.co/auth/v1/user';
const publicKey = 'sb_publishable_7PqrbJu51feyW6CbKOcYhg_tXuU9K0c';

export function recoveryToken(fragment) {
  const params = new URLSearchParams(fragment.replace(/^#/, ''));
  const tokens = params.getAll('access_token');
  if (params.getAll('type').length !== 1 || params.get('type') !== 'recovery' ||
      params.has('error') || params.has('error_code') || tokens.length !== 1 ||
      !tokens[0] || tokens[0].length > 8192 || /\s/.test(tokens[0])) return null;
  return tokens[0];
}

export async function updatePassword(token, password, confirmation, fetcher = fetch) {
  if (!token || password.length < 8 || password !== confirmation) {
    throw new Error('validation');
  }
  const response = await fetcher(authUrl, {
    method: 'PUT',
    headers: { apikey: publicKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error('rejected');
}

if (typeof document !== 'undefined') {
  const params = new URLSearchParams(location.hash.slice(1));
  const confirmed = params.get('type') === 'signup' && params.has('access_token') && !params.has('error');
  let token = recoveryToken(location.hash);
  history.replaceState(null, '', location.pathname);
  const form = document.getElementById('recovery');
  const status = document.getElementById('status');
  const password = document.getElementById('password');
  const confirmation = document.getElementById('confirm');
  const button = form.querySelector('button');
  if (token) {
    form.hidden = false;
    status.textContent = '請設定至少 8 個字元的新密碼。 / Choose a new password with at least 8 characters.';
  } else if (confirmed) {
    status.textContent = '電子信箱已驗證，請回 Hither 登入。 / Email verified. Return to Hither and sign in.';
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!token || button.disabled) return;
    button.disabled = true;
    try {
      await updatePassword(token, password.value, confirmation.value);
      token = null;
      form.reset();
      form.hidden = true;
      status.textContent = '密碼已更新，請回 Hither 重新登入。 / Password updated. Return to Hither and sign in again.';
    } catch (error) {
      status.textContent = error.message === 'validation'
        ? '密碼須至少 8 個字元，兩次輸入須相同。 / Use at least 8 characters and enter the same password twice.'
        : '連結可能已過期或網路暫時無法連線，請重試或從 Hither 重新提出要求。 / Retry, or request a new reset link from Hither.';
    } finally {
      button.disabled = false;
    }
  });
}
