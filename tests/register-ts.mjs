import {registerHooks} from 'node:module';
import {extname} from 'node:path';
registerHooks({resolve(specifier,context,next){
 if(specifier.startsWith('.')&&!extname(specifier))return next(specifier+'.ts',context);
 return next(specifier,context);
}});
