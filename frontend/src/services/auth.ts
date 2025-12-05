import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { config } from '../config';

const userPool = new CognitoUserPool({
  UserPoolId: config.cognito.userPoolId,
  ClientId: config.cognito.userPoolClientId,
});

export interface AuthUser {
  username: string;
  email?: string;
  sub: string;
}

/**
 * Sign in user with email and password
 */
export type SignInResult =
  | { type: 'SUCCESS'; session: CognitoUserSession }
  | { type: 'NEW_PASSWORD_REQUIRED'; cognitoUser: CognitoUser; userAttributes: Record<string, unknown> };

export const signIn = (email: string, password: string): Promise<SignInResult> => {
  return new Promise((resolve, reject) => {
    const cognitoUser = new CognitoUser({
      Username: email,
      Pool: userPool,
    });

    const authDetails = new AuthenticationDetails({
      Username: email,
      Password: password,
    });

    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => {
        resolve({ type: 'SUCCESS', session });
      },
      onFailure: (err) => {
        reject(err);
      },
      newPasswordRequired: (userAttributes) => {
        // Return challenge info so UI can ask for a new password
        resolve({
          type: 'NEW_PASSWORD_REQUIRED',
          cognitoUser,
          userAttributes,
        });
      },
    });
  });
};

/**
 * Complete NEW_PASSWORD_REQUIRED challenge with a new password
 */
export const completeNewPassword = (
  cognitoUser: CognitoUser,
  newPassword: string,
): Promise<CognitoUserSession> => {
  return new Promise((resolve, reject) => {
    cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
      onSuccess: (session) => {
        resolve(session as CognitoUserSession);
      },
      onFailure: (err) => {
        reject(err);
      },
    });
  });
};

/**
 * Sign out current user
 */
export const signOut = (): void => {
  const cognitoUser = userPool.getCurrentUser();
  if (cognitoUser) {
    cognitoUser.signOut();
  }
};

/**
 * Get current authenticated user session
 */
export const getCurrentSession = (): Promise<CognitoUserSession | null> => {
  return new Promise((resolve) => {
    const cognitoUser = userPool.getCurrentUser();
    
    if (!cognitoUser) {
      resolve(null);
      return;
    }

    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        resolve(null);
        return;
      }
      resolve(session);
    });
  });
};

/**
 * Get JWT token for API calls
 */
export const getIdToken = async (): Promise<string | null> => {
  const session = await getCurrentSession();
  if (!session) return null;
  return session.getIdToken().getJwtToken();
};

/**
 * Get access token for API calls (often required by API Gateway authorizers)
 */
export const getAccessToken = async (): Promise<string | null> => {
  const session = await getCurrentSession();
  if (!session) return null;
  return session.getAccessToken().getJwtToken();
};

/**
 * Get current user info from token
 */
export const getCurrentUser = async (): Promise<AuthUser | null> => {
  const session = await getCurrentSession();
  if (!session) return null;
  
  const idToken = session.getIdToken();
  const payload = idToken.decodePayload();
  
  return {
    username: payload['cognito:username'] || payload.email,
    email: payload.email,
    sub: payload.sub,
  };
};

/**
 * Sign up new user
 */
export const signUp = (email: string, password: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    userPool.signUp(
      email,
      password,
      [],
      [],
      (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      }
    );
  });
};

/**
 * Confirm sign up with verification code
 */
export const confirmSignUp = (email: string, code: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const cognitoUser = new CognitoUser({
      Username: email,
      Pool: userPool,
    });

    cognitoUser.confirmRegistration(code, true, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
};
