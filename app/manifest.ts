import type {MetadataRoute} from 'next';
export default function manifest():MetadataRoute.Manifest{return {id:'/',name:'ZIS Solar',short_name:'ZIS Solar',start_url:'/',display:'standalone',background_color:'#172234',theme_color:'#172234',icons:[{src:'/zis-solar-icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}]};}
