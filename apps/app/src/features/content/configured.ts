import { connectionFromValues } from './connection.ts';
// Expo statically reads EXPO_PUBLIC variables. Values live in ignored apps/app/.env.local, never in source.
export const APP_CONNECTION = connectionFromValues(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
);
