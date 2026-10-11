import {registerHooks} from 'node:module';
import {extname} from 'node:path';
registerHooks({resolve(specifier,context,next){
 if(specifier==='next/headers')return next('next/headers.js',context);
 if(specifier.startsWith('.')&&!extname(specifier)&&!context.parentURL?.includes('/node_modules/'))return next(specifier+'.ts',context);
 return next(specifier,context);
}});
