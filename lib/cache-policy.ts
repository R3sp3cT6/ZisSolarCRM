export const ACTIVE_GAP_MS=10*60*1000;
export const ARCHIVE_INTERVAL_MS=60*60*1000;
export const LIVE_INTERVAL_MS=310000;
export type Activity={lastActive:number;lastArchived:number};
export function archiveDue(activity:Activity|null,now=Date.now()){
 return !activity||!activity.lastArchived||now-activity.lastArchived>=ARCHIVE_INTERVAL_MS||
  (now-activity.lastActive>=ACTIVE_GAP_MS&&now-activity.lastArchived>=ACTIVE_GAP_MS);
}
