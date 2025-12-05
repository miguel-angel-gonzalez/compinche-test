import { useState, useEffect, useCallback } from 'react';
import { CognitoUser } from 'amazon-cognito-identity-js';
import {
  signIn as authSignIn,
  signOut as authSignOut,
  getCurrentSession,
  getCurrentUser,
  completeNewPassword,
  AuthUser,
  SignInResult,
} from '../services/auth';

interface UseAuthReturn {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  newPasswordRequired: boolean;
  pendingEmail: string | null;
  submitNewPassword: (newPassword: string) => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newPasswordRequired, setNewPasswordRequired] = useState(false);
  const [pendingCognitoUser, setPendingCognitoUser] = useState<CognitoUser | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  // Check for existing session on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const session = await getCurrentSession();
        if (session) {
          const currentUser = await getCurrentUser();
          setUser(currentUser);
        }
      } catch (err) {
        console.error('Session check failed:', err);
      } finally {
        setIsLoading(false);
      }
    };

    checkSession();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);
    setNewPasswordRequired(false);
    setPendingCognitoUser(null);
    setPendingEmail(null);

    try {
      const result: SignInResult = await authSignIn(email, password);

      if (result.type === 'SUCCESS') {
        const currentUser = await getCurrentUser();
        setUser(currentUser);
      } else if (result.type === 'NEW_PASSWORD_REQUIRED') {
        setNewPasswordRequired(true);
        setPendingCognitoUser(result.cognitoUser);
        setPendingEmail(email);
        setError('You must set a new password to continue.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const signOut = useCallback(() => {
    authSignOut();
    setUser(null);
    setError(null);
    setNewPasswordRequired(false);
    setPendingCognitoUser(null);
    setPendingEmail(null);
  }, []);

  const submitNewPassword = useCallback(async (newPassword: string) => {
    if (!pendingCognitoUser) {
      setError('No pending user for password change.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await completeNewPassword(pendingCognitoUser, newPassword);
      const currentUser = await getCurrentUser();
      setUser(currentUser);
      setNewPasswordRequired(false);
      setPendingCognitoUser(null);
      setPendingEmail(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to set new password';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [pendingCognitoUser]);

  return {
    user,
    isAuthenticated: !!user,
    isLoading,
    error,
    signIn,
    signOut,
    newPasswordRequired,
    pendingEmail,
    submitNewPassword,
  };
}
