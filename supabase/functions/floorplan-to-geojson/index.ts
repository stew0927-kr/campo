// Supabase Edge Function: a photo of a floor guide → a GeoJSON draft of corridors, doors, stairs, elevators and
// restrooms. Only this file uses Deno globals; everything else is in src/ and runs in Node too (the app's tests).
import { fail, handleRequest } from './src/handler.ts';

Deno.serve(async (req: Request) => {
  try {
    return await handleRequest(req, { env: (name) => Deno.env.get(name) });
  } catch (err) {
    console.error('floorplan-to-geojson', err);
    return fail('provider_error', '안내도를 처리하다 서버에서 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.');
  }
});
