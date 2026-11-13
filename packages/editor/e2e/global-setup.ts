import { CAMPUS_IDS, seedCampus, seedReports } from './seed.ts';

export default function globalSetup(): void {
  for (const id of CAMPUS_IDS) seedCampus(id);
  seedReports();
}
