// The floorplan server settings. Expo inlines EXPO_PUBLIC_ variables at build time, so each is read by its full name.
// Values live in an ignored apps/mobile/.env.local, never in source.
import { floorplanEndpoint } from './client.ts';

export const FLOORPLAN_ENDPOINT: string | null = floorplanEndpoint({
  floorplanUrl: process.env.EXPO_PUBLIC_FLOORPLAN_URL,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
});

export const FLOORPLAN_ANON_KEY: string | undefined = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
