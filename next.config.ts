import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
 serverExternalPackages:['@meri-imperiumi/eccodes-wasm','seek-bzip'],
 outputFileTracingIncludes:{'/api/forecast-trial':['./node_modules/@meri-imperiumi/eccodes-wasm/**/*'],'/api/forecast-sync':['./node_modules/@meri-imperiumi/eccodes-wasm/**/*']},
 poweredByHeader:false,
 async headers(){return [{source:'/:path*',headers:[
  {key:'X-Content-Type-Options',value:'nosniff'},
  {key:'X-Frame-Options',value:'DENY'},
  {key:'Referrer-Policy',value:'same-origin'},
  {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},
  {key:'Strict-Transport-Security',value:'max-age=31536000; includeSubDomains'},
  {key:'X-Robots-Tag',value:'noindex, nofollow, noarchive'},
 ]}];},
};

export default nextConfig;
