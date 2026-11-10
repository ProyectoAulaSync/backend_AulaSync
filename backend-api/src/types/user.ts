export type AuthProvider = 'password' | 'google';

export interface UserProfile {
  uid: string;
  email: string;
  nombres: string;
  apellidos: string;
  username: string | null;
  avatar: string | null;
  provider: AuthProvider;
  profileComplete: boolean;
}
