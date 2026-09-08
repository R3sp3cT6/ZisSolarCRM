// Supplied by the plant owner. This is a portal identifier, not an API credential.
export const FUSIONSOLAR_PLANT = {
  name: 'ZIS Solar',
  portalId: 'NE=252974614',
  portalUrl: 'https://uni004eu5.fusionsolar.huawei.com/uniportal/pvmswebsite/assets/build/cloud.html?app-id=smartpvms&instance-id=smartpvms&zone-id=region-4-f2451562-c228-436d-8b77-9eb00b0dbe9f#/view/station/NE=252974614/overview',
  // The supplied portal redirected to this regional login. Verify the API
  // region and stationCode with the authorized Northbound account before use.
  loginOrigin: 'https://eu5.fusionsolar.huawei.com',
  apiState: 'awaiting_authorized_access',
} as const;
