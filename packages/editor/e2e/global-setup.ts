import { CAMPUS_IDS, seedCampus } from './seed.ts';

export default function globalSetup(): void {
  for (const id of CAMPUS_IDS) seedCampus(id);
}
