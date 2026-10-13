export type RefreshSource = 'overview' | 'market';
export type RefreshItem = {
 source: 'Huawei' | 'MEMO';
 day: string;
 status: 'updated' | 'cached' | 'pending' | 'busy' | 'error' | 'unconfigured' | 'partial';
 updated: number;
 lastSuccess?: string | null;
 productionThrough?: string | null;
};
export type ManualRefreshResult = {source: RefreshSource; items: RefreshItem[]};
