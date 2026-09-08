self.addEventListener('push', event => {
 let data;try{data=event.data.json();}catch{data={};}
 event.waitUntil(self.registration.showNotification(data.title || 'ZIS Solar', {
  body:data.body || 'Your solar report is ready.', tag:data.tag || 'zis-solar',
  icon:'/zis-solar-logo-transparent.png', data:{url:'/'},
 }));
});
self.addEventListener('notificationclick', event => {
 event.notification.close();
 event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
  const existing=windows.find(w=>new URL(w.url).origin===self.location.origin);
  return existing?existing.focus():clients.openWindow('/');
 }));
});
