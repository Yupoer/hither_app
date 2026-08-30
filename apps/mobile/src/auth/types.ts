import type { User } from '../types';

export type EmailSignUpResult =
  | { status: 'signed_in'; user: User }
  | { status: 'verification_required'; email: string };

export type AuthFieldErrors = Partial<
  Record<'nickname' | 'email' | 'password' | 'confirmPassword' | 'form', string>
>;

export type AuthBusyAction =
  | 'email_sign_in'
  | 'email_sign_up'
  | 'google'
  | 'apple'
  | 'guest'
  | 'password_reset'
  | 'resend_confirmation'
  | 'complete_recovery'
  | null;

export class AuthFlowError extends Error {
  readonly code?: string;
  readonly status?: number;

  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = 'AuthFlowError';
    this.code = code;
    this.status = status;
  }
}

export function toAuthFlowError(error: unknown, fallback: string): AuthFlowError {
  if (error instanceof AuthFlowError) return error;
  const candidate = error as { message?: unknown; code?: unknown; status?: unknown } | null;
  return new AuthFlowError(
    typeof candidate?.message === 'string' && candidate.message ? candidate.message : fallback,
    typeof candidate?.code === 'string' ? candidate.code : undefined,
    typeof candidate?.status === 'number' ? candidate.status : undefined,
  );
}

