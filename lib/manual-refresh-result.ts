export type RefreshSource = 'overview' | 'market';
export type RefreshItem = {
 source: 'Huawei' | 'MEMO';
 day: string;
 status: 'updated' | 'cached' | 'pending' | 'busy' | 'error' | 'unconfigured';
 updated: number;
 lastSuccess?: string | null;
};
export type ManualRefreshResult = {source: RefreshSource; items: RefreshItem[]};
