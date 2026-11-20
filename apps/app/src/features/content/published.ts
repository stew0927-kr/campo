import type { ContentData } from './types.ts';
export function publishedContent(data: ContentData): ContentData {
  const festivals = data.festivals.filter((row) => row.isPublished);
  const days = data.days.filter((row) => festivals.some((parent) => parent.id === row.festivalId));
  return { essays: data.essays.filter((row) => row.isPublished), festivals, days,
    stalls: data.stalls.filter((row) => row.isPublished && days.some((day) => day.id === row.dayId)),
    performances: data.performances.filter((row) => row.isPublished && days.some((day) => day.id === row.dayId)),
    events: data.events.filter((row) => row.isPublished) };
}
